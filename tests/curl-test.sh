#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# 🧪 IdentiFI Protocol — cURL test (verify Edge Function)
# ═══════════════════════════════════════════════════════════════════════════════
#
# Usage:
#   1. Edit the variables below with your real data
#   2. Run: bash tests/curl-test.sh
#   3. Or copy & paste the curl command directly into your terminal
#
# Expected responses:
#   ✅ Success:       {"valid":true, "checked_at":"...", "plan":{...}}
#   ❌ Hash mismatch: {"valid":false, "error":"Cryptographic verification failed..."}
#   ❌ Invalid key:   {"valid":false, "error":"Invalid or inactive API key"}
# ═══════════════════════════════════════════════════════════════════════════════

# ═══ CONFIG — EDIT HERE ═══════════════════════════════════════════════════════

# Supabase base URL (change if the project moves)
SUPABASE_URL="https://hcftafgwrjbuxtebrsmi.supabase.co"

# Your API key generated on the IdentiFI dashboard
API_KEY="id_live_7bb60792c35c713b072101bfd50944a008cdb9b85dc8dc631182a5648b0374b544c4e5d5"

# Active wallet you want to test (must be inside the ProofPack)
ACTIVE_WALLET="0xDD273E93e9F5A44E287D64fBA45fbBF5D6c32df7"

# ── Tip: compute the hash of your wallet to find the right entry ──────────────
# ⚠️ The current /verify uses Poseidon(activeWallet, SYSTEM_PEPPER) — the old
#    keccak256 hint below is kept for historical reference only.
# ══════════════════════════════════════════════════════════════════════════════

# ═══ PROOF PACK — EDIT HERE ═══════════════════════════════════════════════════
# Replace with the data of your ProofPack exported from the ZkProverPanel.
# You can keep 1 entry or the whole pack — the Edge Function does the hash lookup.

BODY='{
  "activeWallet": "'${ACTIVE_WALLET}'",
  "proofPack": {
    "version": 1,
    "masterAddress": "0x3318f0b040281d7285a21177aa2fa5ed3da5d2de",
    "createdAt": "1783463230",
    "expiresAt": "1783549630",
    "entries": [
      {
        "walletHash": "0x451e33db59db9651eba018a80d1c8b3b8e7fa1658ac6f72d374d055be89f6f6b",
        "proof": "0xc0df7ca1a694325d7e671c3e0c298e7ee5233a548f76d83844fb839818f03226dda27b23a07de3320f428add9c20db9c0046657ee7fda4d6c2c879f85e64cd005d3e72546f684006cc321996fb152fc6ff8508ac59507d7393cd58dbc411cb232f99bd679ff5d9c2488dcd996353122671f0e630370acb126b6cb2dc67b1e3a1",
        "root": "0x053a874cd17b6591804a0134b48e1f10b2696dbace239b7553e5445c2bd8ee0d",
        "iat": "1783463230",
        "exp": "1783549630"
      }
    ]
  }
}'

# ═══ NO NEED TO EDIT BELOW THIS LINE ═══════════════════════════════════════════

ENDPOINT="${SUPABASE_URL}/functions/v1/verify"

echo "╔════════════════════════════════════════════════════════╗"
echo "║   🔍 IdentiFI — Edge Function test (cURL)           ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "  📡 URL : ${ENDPOINT}"
echo "  🔑 API : ${API_KEY:0:15}..."
echo "  👛 Wallet : ${ACTIVE_WALLET}"
echo ""

# ── Test 1: VALID wallet ─────────────────────────────────────────────────────
echo "━━━ [TEST 1] VALID wallet (should return valid: true) ━━━"
echo ""

curl -s --max-time 10 -X POST "${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "X-IdentiFI-Key: ${API_KEY}" \
  -d "${BODY}"

echo ""
echo ""

# ── Test 2: INVALID wallet ───────────────────────────────────────────────────
echo "━━━ [TEST 2] INVALID wallet (not in the pack → hash mismatch) ━━━"
echo ""

curl -s --max-time 10 -X POST "${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "X-IdentiFI-Key: ${API_KEY}" \
  -d '{
    "activeWallet": "0x0000000000000000000000000000000000000000",
    "proofPack": {
      "version": 1,
      "masterAddress": "0x3318f0b040281d7285a21177aa2fa5ed3da5d2de",
      "createdAt": "1783463230",
      "expiresAt": "1783549630",
      "entries": [
        {
          "walletHash": "0x451e33db59db9651eba018a80d1c8b3b8e7fa1658ac6f72d374d055be89f6f6b",
          "proof": "0xc0df7ca1a694325d7e671c3e0c298e7ee5233a548f76d83844fb839818f03226dda27b23a07de3320f428add9c20db9c0046657ee7fda4d6c2c879f85e64cd005d3e72546f684006cc321996fb152fc6ff8508ac59507d7393cd58dbc411cb232f99bd679ff5d9c2488dcd996353122671f0e630370acb126b6cb2dc67b1e3a1",
          "root": "0x053a874cd17b6591804a0134b48e1f10b2696dbace239b7553e5445c2bd8ee0d",
          "iat": "1783463230",
          "exp": "1783549630"
        }
      ]
    }
  }'

echo ""
echo ""

# ── Test 3: INVALID API key ──────────────────────────────────────────────────
echo "━━━ [TEST 3] INVALID API key (should return 401) ━━━"
echo ""

curl -s --max-time 10 -X POST "${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "X-IdentiFI-Key: id_live_WRONG_KEY_HERE" \
  -d "${BODY}"

echo ""
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║   🏁 Tests finished!                                  ║"
echo "╚════════════════════════════════════════════════════════╝"
