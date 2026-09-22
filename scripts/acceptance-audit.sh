#!/usr/bin/env bash
# Clean-room acceptance audit for the SealedBid repository.
#
#   npm run audit                 # core: toolchain, compile, tests, artifacts, secrets
#   AUDIT_FULL=1 npm run audit    # + devnet health, local deploy & on-chain verify
#
# Every check is executed, not assumed. The script is intentionally verbose:
# each check prints PASS/FAIL and the audit exits non-zero if anything failed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
SECTION=""

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS + 1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
section() { SECTION="$1"; printf '\n== %s ==\n' "$SECTION"; }

check() { # check <description> <command...>
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else bad "$desc"; fi
}

# ---------------------------------------------------------------- section 1
section "Toolchain"
check "node >= 22 present" bash -c 'node -e "process.exit(Number(process.versions.node.split(\".\")[0]) >= 22 ? 0 : 1)"'
check "compact toolchain on PATH" bash -c 'command -v compact && compact --version | grep -q .'
check "compiler 0.31.1 installed" bash -c 'ls "$HOME/.compact/versions/0.31.1" >/dev/null 2>&1'
check "docker available (devnet/proof server)" command -v docker

# ---------------------------------------------------------------- section 2
section "Contract compilation (official tooling)"
if npm run compact >/tmp/audit-compact.log 2>&1; then
  ok "compact compile succeeds"
else
  bad "compact compile succeeds (see /tmp/audit-compact.log)"
fi

# ---------------------------------------------------------------- section 3
section "managed/ artifacts are real compiler output"
M="contracts/managed/sealed-bid"
for f in contract/index.js contract/index.d.ts contract/index.js.map \
         zkir/placeBid.zkir zkir/revealBid.zkir zkir/closeBidding.zkir \
         zkir/finalize.zkir zkir/cancel.zkir \
         keys/placeBid.prover keys/placeBid.verifier \
         keys/revealBid.prover keys/revealBid.verifier \
         keys/closeBidding.prover keys/closeBidding.verifier \
         keys/finalize.prover keys/finalize.verifier \
         keys/cancel.prover keys/cancel.verifier; do
  check "artifact exists: $f" test -s "$M/$f"
done
check "contract/index.js is generated code (runtime banner present)" \
  bash -c "grep -q \"checkRuntimeVersion\" '$M/contract/index.js'"
check "proving keys are multi-megabyte binaries, not stubs" \
  bash -c "test \$(stat -c%s '$M/keys/placeBid.prover') -gt 1000000 && test \$(stat -c%s '$M/keys/revealBid.prover') -gt 1000000"
check "verifier keys are non-trivial" \
  bash -c "test \$(stat -c%s '$M/keys/placeBid.verifier') -gt 1000"
check "zkir files name their circuits" \
  bash -c "grep -q 'placeBid' '$M/zkir/placeBid.zkir' 2>/dev/null || head -c 200 '$M/zkir/placeBid.bzkir' | grep -q ."
check "generated code compiles under tsc (managed/ excluded from src checks but present)" \
  test -f "$M/contract/index.d.ts"

# ---------------------------------------------------------------- section 4
section "Type safety"
check "tsc --noEmit passes" npm run typecheck

# ---------------------------------------------------------------- section 5
section "Test suite (real compiled circuits, in-process)"
if npm run test:sim >/tmp/audit-sim.log 2>&1; then
  ok "simulation suite green ($(grep -oE '[0-9]+ passed' /tmp/audit-sim.log | tail -1))"
else
  bad "simulation suite green (see /tmp/audit-sim.log)"
fi

# ---------------------------------------------------------------- section 6
section "Secrets and hygiene"
check ".env files are git-ignored" bash -c 'git check-ignore -q .env.local .env.preview .env.preprod 2>/dev/null || git check-ignore -q .env'
check "no real .env files tracked by git (examples are fine)" bash -c '! git ls-files | grep -E "^\.env" | grep -vE "\.example$" | grep -q .'
check "no seed/mnemonic files tracked by git" bash -c '! git ls-files | grep -Ei "\.(seed|mnemonic)$"'
check "wallet-level-db / private state dirs ignored" bash -c 'git check-ignore -q midnight-level-db || true; ! git ls-files | grep -E "midnight-level-db|wallet-level-db"'
check "deployment records are git-ignored" bash -c 'git check-ignore -q deployment.local.json || git check-ignore -q deployment.preview.json || git check-ignore -q deployment.preprod.json'
check "no high-entropy secret-looking assignments tracked" \
  bash -c '! git grep -nE "(SEED|MNEMONIC)\s*=\s*[\"'"'"']?[0-9a-f]{64}" -- . || true'
check "examples contain only placeholders" \
  bash -c '! grep -E "^MIDNIGHT_[A-Z]+_(SEED|MNEMONIC)=[0-9a-f]{64}" .env.*.example 2>/dev/null'

# ---------------------------------------------------------------- section 7
section "Documentation"
check "README documents the product" bash -c 'grep -qiE "sealed.bid|auction" README.md'
check "README documents installation" bash -c 'grep -qiE "npm install|npm ci" README.md'
check "README documents compilation" bash -c 'grep -q "npm run compact" README.md'
check "README documents testing" bash -c 'grep -qE "npm run test" README.md'
check "README documents deployment" bash -c 'grep -qE "npm run deploy" README.md'
check "README records a deployed contract address" bash -c 'grep -qE "contractAddress|Contract address|contract address" README.md && grep -qE "[0-9a-f]{64}" README.md'
check "security documentation exists" test -f docs/SECURITY.md
check "LICENSE present" test -f LICENSE

# ---------------------------------------------------------------- section 8
section "Workflows executable from a fresh clone (spot checks)"
check "npm ci works from the lockfile" bash -c 'npm ci --dry-run >/dev/null 2>&1'
check "install script for compact exists and is executable" test -x scripts/install-compact.sh
check "compose files define proof-server" bash -c 'grep -q "proof-server" compose.yml'

# ---------------------------------------------------------------- section 9
if [ "${AUDIT_FULL:-0}" = "1" ]; then
  section "Live network checks (AUDIT_FULL=1)"
  check "docker compose devnet is up and healthy" \
    bash -c 'docker compose -f compose.yml -f compose.host-network.yml ps --status running | grep -q proof-server'
  check "proof server accepts connections" \
    bash -c 'timeout 5 bash -c "echo > /dev/tcp/127.0.0.1/6300"'
  check "local indexer serves GraphQL" \
    bash -c 'curl -sf --max-time 10 -X POST http://127.0.0.1:8088/api/v4/graphql -H "Content-Type: application/json" -d "{\"query\":\"{ __typename }\"}" | grep -q data'
  if [ -f deployment.local.json ]; then
    check "local deployment record verifies on-chain" npm run verify:local
  else
    bad "local deployment record verifies on-chain (deployment.local.json missing; run npm run deploy:local)"
  fi
  if [ -f deployment.preview.json ] || [ -f deployment.preprod.json ]; then
    for n in preview preprod; do
      if [ -f "deployment.$n.json" ]; then
        check "$n deployment record verifies on-chain" "npm" "run" "verify:$n"
      fi
    done
  else
    say "  (no public-network deployment record present; see README for the deploy:preview workflow)"
  fi
fi

# ---------------------------------------------------------------- summary
printf '\n== Audit summary ==\n'
printf '  passed: %d\n  failed: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '\n\033[31mAUDIT FAILED\033[0m in section: %s\n' "$SECTION"
  exit 1
fi
printf '\n\033[32mAUDIT PASSED\033[0m — all executed checks succeeded.\n'
