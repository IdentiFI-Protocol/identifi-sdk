/**
 * IdentiFI SDK — Example: verifyRemote() via IdentiFI API
 *
 * ★ This is the PRIMARY and RECOMMENDED verification method for V2 proofs.
 *
 * V2 proofs have sub-wallet addresses BLINDED via Poseidon(sub_wallet, SYSTEM_PEPPER).
 * Local verify() does NOT work — the SDK cannot replicate the secret server pepper.
 *
 * Instead, send the activeWallet + ProofPack to the IdentiFI API:
 *   1. Server blinds the wallet with SYSTEM_PEPPER
 *   2. Looks up the blinded hash in the ProofPack
 *   3. Runs Groth16 ZK verifier (Rust/WASM server-side)
 *   4. Meters usage against your plan quota
 *
 * Run (Node.js >= 18):
 *   export IDENTIFI_API_KEY=id_live_your_key_here
 *   npx tsx examples/verify-proof.ts
 */

import { IdentiFiSDK } from '../src/index.js';
import type { ProofPack } from '../src/index.js';

async function main() {
  // ── 1. Create SDK instance (no WASM init needed!) ──────────────────────
  const sdk = new IdentiFiSDK({
    apiKey: process.env.IDENTIFI_API_KEY ?? 'id_live_your_key_here',
    apiUrl: 'https://hcftafgwrjbuxtebrsmi.supabase.co/functions/v1',
  });

  console.log('IdentiFI SDK ready for remote verification.');
  console.log(`   API URL : ${process.env.IDENTIFI_API_URL ?? 'https://hcftafgwrjbuxtebrsmi.supabase.co/functions/v1'}/verify`);

  // ── 2. Receive a ProofPack from the IdentiFI website ───────────────────
  // In production, the user downloads this after generating proofs on identifi.xyz
  const proofPack: ProofPack = {
    version: 1,
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
    ],
  };

  // ── 3. Get the operative wallet address ────────────────────────────────
  // In a real dApp this comes from the connected wallet (e.g., MetaMask).
  const activeWallet = '0xD45c7d0B8944Cb913fEEf3c35466560Fe5C11482';

  // ── 4. Verify via IdentiFI API (★ recommended) ─────────────────────────
  console.log('\nVerifying proof via IdentiFI API...');
  console.log(`   Active wallet: ${activeWallet}`);
  console.log(`   Pack entries : ${proofPack.entries.length}`);

  const result = await sdk.verifyRemote(activeWallet, proofPack);

  if (result.valid) {
    console.log('✓ Proof is VALID — wallet authorized.');
    if ((result as any).plan) {
      console.log(`   Plan usage: ${(result as any).plan.usage}/${(result as any).plan.limit}`);
    }
  } else {
    console.log('✗ Proof INVALID:', result.reason);
    console.log('  → Generate a new proof at https://identifi.xyz');
  }

  // ── 5. Purge session when done ────────────────────────────────────────
  sdk.purge();
  console.log('\n✓ Session cleared.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
