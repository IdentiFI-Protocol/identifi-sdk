/**
 * 🧪 IdentiFI SDK — Remote Verification Test (Supabase Edge Function)
 *
 * Usage:
 *   1. First deploy the Edge Function:
 *      cd identifi-interfaces && supabase functions deploy verify --no-verify-jwt
 *
 *   2. Then run this test:
 *      npx tsx tests/remote.test.ts
 *
 * Flow:
 *   1. Initializes the SDK with a real API Key + Supabase Edge Function URL
 *   2. Calls verifyRemote(activeWallet, proofPack)
 *   3. The Edge Function blinds the wallet: Poseidon(activeWallet, SYSTEM_PEPPER)
 *      and looks up the entry in the pack
 *   4. Validates the ZK proof with the WASM engine (Rust)
 *   5. Displays the result
 *
 * ⚠️ The ProofPack below is an EXAMPLE. Since SYSTEM_PEPPER has been rotated,
 * generate a FRESH pack from the IdentiFI website (ZkProverPanel) with the
 * current pepper — packs generated with an older pepper will fail lookup.
 *
 * If it returns valid: true → SDK ↔ Edge Function ↔ WASM ↔ Rust → ALL GOOD 🔥
 */

import { IdentiFiSDK } from '../src/IdentiFiSDK.js';

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 TEST DATA — provided by the developer
// ═══════════════════════════════════════════════════════════════════════════════

const SUPABASE_FUNCTIONS_URL = 'https://hcftafgwrjbuxtebrsmi.supabase.co/functions/v1';
const API_KEY = 'id_live_11ef9ea207b86b473f7df488949501bcac4dfe1d19550c5a56372b6760234212ea0c24fd';
const ACTIVE_WALLET = '0xD45c7d0B8944Cb913fEEf3c35466560Fe5C11482';

const PROOF_PACK = {
  version: 1 as const, // V2 flow (Poseidon blinded)
  masterAddress: '0xd5a038e059607c17624883e02d31b188e8740f87',
  createdAt: '1783527920',
  expiresAt: '1786119920',
  entries: [
    {
      walletHash: '0x1986d19471f1f2b0a7506a0b0ce6b673a7eb9c15154cbacb0034b4224ed12803',
      proof: '0x0be41cf335206a2d6e6fbe34bdac3cf5549c10b8c3227bc0d979c47f8f169e9fc6cd406488637681de9a8ade9b2d9e83dd62e15060767ee15fadd3327d4c9920a41836c90ed6820407b3a95faccd1c649f6c924f997e0d65be9ba9f56a527f01604413bf20af12bb5bba475afda07ba13e103eb424c34f7b8dd4a71f618181a0',
      root: '0x2e78f870f4c80b415362df5b809d47f973cfb62a628b70c7ceba5ff312ab2518',
      iat: '1783527920',
      exp: '1786119920',
    },
    {
      walletHash: '0x222f13164de9a9c9b5cd8ab256ff26ddf3791ea7295ebcf02af4f6e8f38f5d20',
      proof: '0xd7b265657603c5c133a3241a06ca196c48fc012b6980cc1d0cc43f00a8b8e612f1e5d02bfaf970dd754aab609b53638b7717eda3b83779aeb0f721105100900fe80b9e938642a340817ca272c63ae48176901ead5f8b623e51af66c685ac8302c7c0de573d297078bd5ab05c5319f55b321a33780f4fc55e42c3c1aa16aeb783',
      root: '0x2e78f870f4c80b415362df5b809d47f973cfb62a628b70c7ceba5ff312ab2518',
      iat: '1783527920',
      exp: '1786119920',
    },
    {
      walletHash: '0x23c24d016a883aeec0a2859e782276a9a7b9b4a7387c57e4dc77d88edbf3a9cf',
      proof: '0x16d5008e5b8fbc2daadf7ca1a56d2b8972bf3808dbc63d6b6420e30fb6f8861b1bc8282536053d275316941358e4d0f9d95c8c4d8b0cfbbd4009cbf9d98a9f24ec6b9f577bc761885872da96a92bb821a8989d7c5dc79561105e52c7e09ca82834c25c28de5aae35d7b7377395b1158a3ece74b6db4ec7c0c4a3055498683f03',
      root: '0x2e78f870f4c80b415362df5b809d47f973cfb62a628b70c7ceba5ff312ab2518',
      iat: '1783527920',
      exp: '1786119920',
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 🚀 MAIN TEST
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('🧪 [IdentiFI Remote Test] Starting...\n');

  // ── Step 1: Initialize the SDK (remote mode — no WASM) ─────────────────
  console.log('━━━ [PHASE 1] Initialize SDK (remote mode) ━━━');
  const sdk = new IdentiFiSDK({
    apiKey: API_KEY,
    apiUrl: SUPABASE_FUNCTIONS_URL,
  });

  console.log(`   🌐 API URL : ${SUPABASE_FUNCTIONS_URL}/verify`);
  console.log(`   🔑 API Key : ${API_KEY.slice(0, 15)}...`);
  console.log(`   👛 Wallet  : ${ACTIVE_WALLET}`);
  console.log(`   📦 Pack    : ${PROOF_PACK.entries.length} entries\n`);

  // ── Step 2: Remote verification via Edge Function ──────────────────────
  console.log('━━━ [PHASE 2] verifyRemote() → Supabase Edge Function ━━━');
  console.log('   ⏳ Waiting for the cloud response...\n');

  const start = performance.now();

  const result = await sdk.verifyRemote(ACTIVE_WALLET, PROOF_PACK);

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);

  // ── Step 3: Result ────────────────────────────────────────────────────
  if (result.valid) {
    console.log(`   ✅ RESULT: valid=${result.valid}`);
    console.log(`   ⚡ Time    : ${elapsed}s`);
    console.log('\n   🎯 SDK ↔ Edge Function ↔ WASM ↔ Rust → ALL GOOD 🔥\n');
    process.exit(0);
  } else {
    console.log(`   ❌ RESULT: valid=${result.valid}`);
    if (result.reason) console.log(`   📋 Reason   : ${result.reason}`);
    console.log(`   ⚡ Time    : ${elapsed}s`);
    console.log('\n   ⚠️  Verification failed. Possible causes:');
    console.log('     1. The Edge Function has not been updated (pending deploy)');
    console.log('     2. The API key is not registered in the Supabase database');
    console.log('     3. The wallet does not match any entry of the ProofPack');
    console.log('     4. The WASM or verifying key in the Edge Function is outdated\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n❌ FATAL ERROR:', err.message || err);
  process.exit(1);
});
