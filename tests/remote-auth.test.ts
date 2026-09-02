/**
 * 🧪 IdentiFI SDK — Integration Test of the 3rd Function (AuthTicket)
 *
 * Usage:
 *   1. Deploy the Edge Functions (WITHOUT JWT — the SDK uses x-identifi-key):
 *      cd identifi-interfaces
 *      supabase functions deploy authorize --no-verify-jwt
 *      supabase functions deploy verify-ticket --no-verify-jwt
 *
 *   2. Set the secret (≤ 64 bytes, WITHOUT the 0x prefix):
 *      supabase secrets set TICKET_SECRET=<openssl rand -hex 32>
 *
 *   3. ⚠️ CRITICAL — GENERATE A FRESH PROOF PACK:
 *      Since SYSTEM_PEPPER was ROTATED, old ProofPacks (including the one in
 *      remote.test.ts) no longer match the new pepper. Generate a fresh pack
 *      via the ZkProverPanel on the IdentiFI website and paste it in PROOF_PACK below.
 *
 *   4. Run (with an ACTIVE API key via env var):
 *      export IDENTIFI_API_KEY=id_live_<YOUR_ACTIVE_KEY>
 *      npx tsx tests/remote-auth.test.ts
 *
 * Flow:
 *   1. authorizeTransaction(wallet, pack) → AuthTicket idf1.v1.*
 *   2. verifyTicket(ticket) via API → valid: true
 *   3. verifyTicketLocally(ticket, TICKET_SECRET) → valid: true (if secret provided)
 *   4. Tampered ticket → rejected on API and locally
 *   5. Wallet outside the pack → authorizeTransaction REJECTS (fatal error)
 */

import { IdentiFiSDK } from '../src/IdentiFiSDK.js';
import { parseAuthTicket } from '../src/engine/ticket.js';

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 TEST DATA — provided by the developer
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_FUNCTIONS_URL = 'https://hcftafgwrjbuxtebrsmi.supabase.co/functions/v1';

// ⚠️ ACTIVE API KEY — the key below (id_live_d537...) is INACTIVE/revoked in the
// database (the /verify function responded "Invalid or inactive API key").
// Replace it with the active key from your dashboard, or export via env var:
//   export IDENTIFI_API_KEY=id_live_<YOUR_ACTIVE_KEY>
const API_KEY = process.env.IDENTIFI_API_KEY ?? 'id_live_11ef9ea207b86b473f7df488949501bcac4dfe1d19550c5a56372b6760234212ea0c24fd';
// Active wallet = masterAddress of the pack (the wallet used to generate the
// pack with the CURRENT pepper). The walletHashes are blinded (Poseidon +
// SYSTEM_PEPPER), so only the server can match the wallet to the entry.
const ACTIVE_WALLET = '0x925f80b1294d30231bfffa0df8494ae14d15faa3';

// ⚠️ TICKET_SECRET used on Supabase (to test verifyTicketLocally).
// Leave empty to skip the local verification (tests only the API path).
// SECURITY: this is a TEST file — never version a production secret.
const TICKET_SECRET = ''; // <-- fill with the same value as Supabase (or leave empty)

// ✅ CURRENT PROOF PACK (generated with the new SYSTEM_PEPPER by the ZkProverPanel).
const PROOF_PACK = {
  version: 1 as const,
  masterAddress: '0x925f80b1294d30231bfffa0df8494ae14d15faa3',
  createdAt: '1785609579',
  expiresAt: '1788201579',
  entries: [
    {
      walletHash: '0x273e3f10aaaed01a8ceb85ab4cacb7f1fc07279857f0415d14c0578571b94d22',
      proof: '0x3cd797a5664ea19a4c9679e830b7db0729c29546e226054adc33a706a4be960ca1586fddd5840e5693f5da0552918fec0ccf8cd4acfeded6c6ee11c40747e42eb95b70f8c90c532df63e73b8a367139801ad195288112f5d1dae97090ab6250755bd6969c3bda80ea31ddc0ab89d159b034eebbe144abd65cf386a31af74d580',
      root: '0x144a02c82aebef986452f1db741ad68f246fabf5141298f25cb777a69e873b38',
      iat: '1785609579',
      exp: '1788201579',
    },
    {
      walletHash: '0x2e9c824e31372b4fee8cc41dd2e00ce96e0d483c609b9b03f63e394f34e23c7b',
      proof: '0x29bd0ce7ab449b1efd1c9b3f41a41805d9518e8c97fb202e1bd405a78d4f86a9c9ccadb564118469196b81c273bff55e9805cbd75f9e03e0ea29fc6bd7b34b2fae686cc342f1d8adbf3842a3f1347c23a37b3db14825162358ca5b76e75544a8aa04dea685a57795699c87631a0618dc569fcbbde8879bc72038f7e2fe6c060a',
      root: '0x144a02c82aebef986452f1db741ad68f246fabf5141298f25cb777a69e873b38',
      iat: '1785609579',
      exp: '1788201579',
    },
    {
      walletHash: '0x0e66b2e61cf8b2b9816af68057b17a377d836de6e855fa6d88b00b86f5cc62c2',
      proof: '0x0985db64525a0bc755a726a5cd121d460b63b6569a50546240afe4ddb60f1a09b604034199f25b1eb8fa2df1419d1f20a6042872117a419e1ec896c1efe33623db03ddcd4d23cb41682b6f2952ac60ffa098a4f36d24d58fb0cc16d9baae45ad19d66db25f3b3a92ef29042119979224d9653c49b902fcaadda342db3624eca4',
      root: '0x144a02c82aebef986452f1db741ad68f246fabf5141298f25cb777a69e873b38',
      iat: '1785609579',
      exp: '1788201579',
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 MAIN TEST
// ═══════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`   ✅ ${name}`);
  } else {
    failed++;
    console.error(`   ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('🧪 [IdentiFI Remote AuthTicket Test] Starting...\n');

  const sdk = new IdentiFiSDK({
    apiKey: API_KEY,
    apiUrl: SUPABASE_FUNCTIONS_URL,
    ...(TICKET_SECRET ? { ticketSecret: TICKET_SECRET } : {}),
  });

  console.log(`   🌐 API URL : ${SUPABASE_FUNCTIONS_URL}`);
  console.log(`   👛 Wallet  : ${ACTIVE_WALLET}`);

  // ── Fail-fast: PROOF_PACK placeholder not filled yet ────────────────────
  if (!PROOF_PACK.entries?.[0] || PROOF_PACK.entries[0].proof === '0x00') {
    console.error('\n   ❌ PROOF_PACK not filled! Generate a FRESH pack via the ZkProverPanel');
    console.error('     (SYSTEM_PEPPER was rotated — old packs do not work) and paste it into PROOF_PACK.');
    process.exit(1);
  }

  // ── PHASE 1: authorizeTransaction → AuthTicket ──────────────────────────
  console.log('\n━━━ [PHASE 1] authorizeTransaction() → /authorize ━━━');

  let ticket = '';
  try {
    ticket = await sdk.authorizeTransaction({
      activeWallet: ACTIVE_WALLET,
      proofPack: PROOF_PACK,
    });
    const parsed = parseAuthTicket(ticket);
    check(
      'resolves with AuthTicket idf1.v1 (8+1 parts)',
      typeof ticket === 'string' && ticket.startsWith('idf1.v1.') && !!parsed,
      ticket.slice(0, 40)
    );
    check(
      'ticket wallet matches the pack (blinded hash of activeWallet)',
      !!parsed && parsed.activeWallet === parsed.activeWallet.toLowerCase(),
      parsed?.activeWallet?.slice(0, 20)
    );
  } catch (err: any) {
    console.error(`   ❌ authorizeTransaction failed: ${err.message}`);
    console.error('     → Check that the functions are deployed, TICKET_SECRET is set');
    console.error('       and the PROOF_PACK was generated with the CURRENT SYSTEM_PEPPER.');
    // ⚠️ Do NOT use printSummary() here: with failed === 0 it would call
    // process.exit(0) (false success). Failure in PHASE 1 is fatal → exit(1).
    console.error('\n🏁 RESULT: PHASE 1 FAILED — no assertions executed');
    process.exit(1);
  }

  // ── PHASE 2: verifyTicket via API ───────────────────────────────────────
  console.log('\n━━━ [PHASE 2] verifyTicket() → /verify-ticket (SaaS) ━━━');

  const v = await sdk.verifyTicket(ticket);
  check('valid ticket → valid:true on the API', v.valid === true, v.error);
  check('returns activeWallet', !!v.activeWallet, v.activeWallet?.slice(0, 20));
  check('returns numeric exp', typeof v.exp === 'number' && v.exp > 0, String(v.exp));

  // ── PHASE 3: Tampered ticket → rejected ─────────────────────────────────
  console.log('\n━━━ [PHASE 3] Tampered ticket → rejected ━━━');

  const parts = ticket.split('.');
  parts[4] = String(Number(parts[4]) + 1); // changes the exp of the payload
  const tampered = parts.join('.');
  const vt = await sdk.verifyTicket(tampered);
  check('tampered ticket → valid:false on the API', vt.valid === false, vt.error);

  // ── PHASE 4: verifyTicketLocally (self-hosted, if secret provided) ──────
  console.log('\n━━━ [PHASE 4] verifyTicketLocally() — self-hosted ━━━');

  if (TICKET_SECRET) {
    const vl = await sdk.verifyTicketLocally(ticket);
    check('valid ticket → valid:true locally', vl.valid === true, vl.error);
    const vlt = await sdk.verifyTicketLocally(tampered);
    check('tampered ticket → valid:false locally', vlt.valid === false, vlt.error);
  } else {
    console.log('   ⏭️  TICKET_SECRET empty — skipping local verification (fill the constant to test)');
  }

  // ── PHASE 5: Wallet outside the pack → fatal error ──────────────────────
  console.log('\n━━━ [PHASE 5] Wallet outside the pack → authorizeTransaction REJECTS ━━━');

  try {
    await sdk.authorizeTransaction({
      activeWallet: '0x1111111111111111111111111111111111111111',
      proofPack: PROOF_PACK,
    });
    check('unknown wallet → rejected', false, 'resolved without error — unexpected!');
  } catch (err: any) {
    const msg: string = err.message || String(err);
    check('unknown wallet → rejected with fatal error', /ERR_|authorization failed/i.test(msg), msg);
  }

  // ═══════════════════════════════════════════════════════════════════════
  printSummary();
}

function printSummary(): void {
  console.log(`\n🏁 RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ FATAL ERROR:', err.message || err);
  process.exit(1);
});
