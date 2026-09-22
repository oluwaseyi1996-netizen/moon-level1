#!/usr/bin/env bash
# Watch the Preview indexer for unshielded NIGHT reaching the deployer wallet.
#
#   scripts/watch-funding.sh [polls] [interval-seconds] [blocks-back]
#
# Each poll scans the last `blocks-back` blocks (default 120) with aliased
# batch queries, so a drip that landed between polls is still seen (naive tip
# sampling misses it). Unshielded NIGHT is public ledger data: no wallet sync,
# no secret. The address is derived at run time from the git-ignored
# .env.preview via scripts/derive-address.ts and is never echoed with its
# secret.
set -uo pipefail

POLL="${1:-12}"
INTERVAL="${2:-55}"
BACK="${3:-120}"
URL="https://indexer.preview.midnight.network/api/v4/graphql"

ADDRESS="$(MIDNIGHT_NETWORK=preview npx vite-node scripts/derive-address.ts 2>/dev/null \
  | grep -oE 'mn_addr_preview1[a-z0-9]+' | head -1)"
if [ -z "$ADDRESS" ]; then
  echo "Could not derive the Preview address (is .env.preview present?)." >&2
  exit 1
fi
echo "Watching for unshielded NIGHT at: $ADDRESS"

scan_window() { # <start> <end>
  python3 - "$ADDRESS" "$1" "$2" <<'PYEOF'
import json, sys, urllib.request

URL = 'https://indexer.preview.midnight.network/api/v4/graphql'
addr, start, end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
BATCH = 20

def gql(query):
    req = urllib.request.Request(URL, data=json.dumps({'query': query}).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

found = 0
h = start
while h <= end:
    top = min(h + BATCH - 1, end)
    aliases = ' '.join(
        f'b{i}: block(offset: {{height: {i}}}) {{ height transactions {{ hash '
        f'unshieldedCreatedOutputs {{ owner value tokenType }} }} }}'
        for i in range(h, top + 1))
    try:
        d = gql('{' + aliases + '}')
    except Exception as e:
        print(f'warn: request failed at {h}: {e}', file=sys.stderr)
        h = top + 1
        continue
    for i in range(h, top + 1):
        b = (d.get('data') or {}).get(f'b{i}')
        if not b:
            continue
        for t in b.get('transactions') or []:
            for o in t.get('unshieldedCreatedOutputs') or []:
                if o.get('owner') == addr and o.get('tokenType') == '0' * 64:
                    found += int(o.get('value') or 0)
                    print(f'  DRIP height={b["height"]} tx={t["hash"]} value={o["value"]}')
    h = top + 1
print(found)
PYEOF
}

TIP="$(curl -s --max-time 15 "$URL" -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ block { height } }"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["block"]["height"])')"
echo "chain tip: $TIP"

for i in $(seq 1 "$POLL"); do
  START=$((TIP - BACK + 1))
  RESULT="$(scan_window "$START" "$TIP" | tail -1)"
  echo "$(date -u +%H:%M:%S) scanned ${START}..${TIP}: unshielded_night_total=${RESULT:-scan_error}"
  if [ -n "$RESULT" ] && [ "$RESULT" -gt 0 ] 2>/dev/null; then
    echo "FUNDING DETECTED"
    exit 0
  fi
  TIP=$((TIP + BACK))
  [ "$i" -lt "$POLL" ] && sleep "$INTERVAL"
done
echo "No funding detected after $POLL poll(s)."
exit 1
