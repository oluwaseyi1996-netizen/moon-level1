#!/usr/bin/env bash
# Poll the Preview indexer for the deployer wallet's unshielded NIGHT UTXOs.
# Unshielded NIGHT is public ledger data, so this needs no wallet sync.
#
#   scripts/watch-funding.sh [polls] [interval-seconds]
#
# The address is derived from the git-ignored .env.preview seed via
# scripts/derive-address.ts; the secret itself is never printed.
set -uo pipefail

POLLS="${1:-1}"
INTERVAL="${2:-45}"
URL="https://indexer.preview.midnight.network/api/v4/graphql"

ADDRESS="$(MIDNIGHT_NETWORK=preview npx vite-node scripts/derive-address.ts 2>/dev/null \
  | grep -oE 'mn_addr_preview1[a-z0-9]+' | head -1)"

if [ -z "$ADDRESS" ]; then
  echo "Could not derive the Preview address (is .env.preview present?)." >&2
  echo "Set FAUCET_ADDRESS explicitly to override." >&2
  ADDRESS="${FAUCET_ADDRESS:-}"
  [ -z "$ADDRESS" ] && exit 1
fi
echo "Watching for unshielded NIGHT at: $ADDRESS"

for i in $(seq 1 "$POLLS"); do
  RESULT="$(curl -s --max-time 15 "$URL" -X POST -H 'Content-Type: application/json' \
    -d '{"query":"{ block { height transactions { hash unshieldedCreatedOutputs { owner value tokenType } } } }"}' \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
b=d.get('data',{}).get('block') or {}
total=0
for t in b.get('transactions',[]):
    for o in t.get('unshieldedCreatedOutputs',[]):
        if o.get('owner')==sys.argv[1] and o.get('tokenType')=='0'*64:
            total+=int(o.get('value') or 0)
print((b.get('height') or '?'), total)
" "$ADDRESS" 2>/dev/null)"
  HEIGHT="${RESULT% *}"
  NIGHT="${RESULT#* }"
  echo "$(date -u +%H:%M:%S) height=$HEIGHT unshielded_night=$NIGHT"
  if [ -n "$NIGHT" ] && [ "$NIGHT" != "0" ]; then
    echo "FUNDING DETECTED"
    exit 0
  fi
  [ "$i" -lt "$POLLS" ] && sleep "$INTERVAL"
done
exit 1
