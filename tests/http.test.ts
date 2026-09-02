/**
 * 🧪 IdentiFI SDK — V2 HTTP Contract Unit Tests (offline, no network)
 *
 * Usage:
 *   npx tsx tests/http.test.ts
 *
 * Covers the PUBLIC V2 contract against the IdentiFI API, with `fetch` mocked:
 *   1. verifyRemote        → valid, invalid, network error, missing apiKey (throws)
 *   2. authorizeTransaction → success (AuthTicket), fatal error (throws), network error (throws)
 *   3. verifyTicket        → valid, invalid
 *
 * Runs 100% offline — no Edge Function, no API key needed.
 */

import { IdentiFiSDK } from '../src/IdentiFiSDK.js';

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

const API_URL = 'https://test.identifi.xyz/v1';
const API_KEY = 'id_test_0000000000000000000000000000000000000000000000';
const ACTIVE_WALLET = '0xd45c7d0b8944cb913feef3c35466560fe5c11482';

const PROOF_PACK = {
  version: 1 as const,
  masterAddress: '0xd5a038e059607c17624883e02d31b188e8740f87',
  createdAt: '1783527920',
  expiresAt: '1786119920',
  entries: [
    {
      walletHash: '0x1986d19471f1f2b0a7506a0b0ce6b673a7eb9c15154cbacb0034b4224ed12803',
      proof: '0x0be41cf335206a2d6e6fbe34bdac3cf5549c10b8c3227bc0d979c47f8f169e9f',
      root: '0x2e78f870f4c80b415362df5b809d47f973cfb62a628b70c7ceba5ff312ab2518',
      iat: '1783527920',
      exp: '1786119920',
    },
  ],
};

/** Installs a fake `fetch` that routes by URL + method and returns a canned JSON body. */
function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; json: any } | Error) {
  (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    const result = handler(url, init);
    if (result instanceof Error) throw result;
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.json,
    };
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 TESTS
// ═══════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`   ✅ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.error(`   ❌ ${name} — ${err.message}`);
    });
}

async function run() {
  passed = 0;
  failed = 0;
  console.log('🧪 [IdentiFI V2 HTTP Contract Test] Starting...\n');

  // ─────────────────────── PHASE 1: verifyRemote ─────────────────────────
  console.log('━━━ [PHASE 1] verifyRemote() ━━━');

  await check('missing apiKey → throws', async () => {
    const sdk = new IdentiFiSDK({ apiUrl: API_URL });
    let threw = false;
    try {
      await sdk.verifyRemote(ACTIVE_WALLET, PROOF_PACK);
    } catch (err: any) {
      threw = /apiKey/.test(err.message);
    }
    if (!threw) throw new Error('expected throw about apiKey');
  });

  await check('empty ProofPack → valid:false (no fetch)', async () => {
    const sdk = new IdentiFiSDK({ apiKey: API_KEY, apiUrl: API_URL });
    const res = await sdk.verifyRemote(ACTIVE_WALLET, { ...PROOF_PACK, entries: [] });
    if (res.valid !== false) throw new Error('expected valid:false');
  });

  await check('valid proof → { valid: true } + correct payload', async () => {
    let sentBody: any = null;
    mockFetch((url, init) => {
      if (url !== `${API_URL}/verify`) throw new Error(`unexpected URL: ${url}`);
      sentBody = JSON.parse((init!.body as string) || '{}');
      return { status: 200, json: { valid: true } };
    });
    const sdk = new IdentiFiSDK({ apiKey: API_KEY, apiUrl: API_URL });
    const res = await sdk.verifyRemote(ACTIVE_WALLET, PROOF_PACK);
    if (res.valid !== true) throw new Error(`expected valid:true, got ${JSON.stringify(res)}`);
    if (sentBody.activeWallet !== ACTIVE_WALLET) throw new Error('activeWallet not forwarded');
    if (!sentBody.proofPack?.entries?.length) throw new Error('proofPack not forwarded');
  });

  await check('invalid proof → { valid: false, reason }', async () => {
    mockFetch(() => ({ status: 200, json: { valid: false, error: 'Cryptographic verification failed' } }));
    const sdk = new IdentiFiSDK({ apiKey: API_KEY, apiUrl: API_URL });
    const res = await sdk.verifyRemote(ACTIVE_WALLET, PROOF_PACK);
    if (res.valid !== false || !res.reason) throw new Error('expected valid:false with reason');
  });

  await check('network error → { valid: false, reason } (auditor semantics — never throws)', async () => {
    mockFetch(() => new Error('ECONNRESET'));
    const sdk = new IdentiFiSDK({ apiKey: API_KEY, apiUrl: API_URL });
    const res = await sdk.verifyRemote(ACTIVE_WALLET, PROOF_PACK);
    if (res.valid !== false || !/Network error/.test(res.reason || '')) {
      throw new Error('expected valid:false with network reason');
    }
  });

  // ───────────────────── PHASE 2: authorizeTransaction ────────────────────
  console.log('\n━━━ [PHASE 2] authorizeTransaction() ━━━');

  await check('valid proof → resolves with AuthTicket', async () => {
    const ticket = [
      'idf1', 'v1',
      'd45c7d0b8944cb913feef3c35466560fe5c11482',
      '2e78f870f4c80b415362df5b809d47f973cfb62a628b70c7ceba5ff312ab2518',
      '1786119920', '1783527920', '1783527920',
      'a1b2c3d4e5f60718293a4b5c6d7e8f90', 'deadbeef'
    ].join('.');

    mockFetch((url) => {
      if (url !== `${API_URL}/authorize`) throw new Error(`unexpected URL: ${url}`);
      return { status: 200, json: { valid: true, ticket } };
    });
    const sdk = new IdentiFiSDK({ apiKey: API_KEY, apiUrl: API_URL });
    const result = await sdk.authorizeTransaction({ activeWallet: ACTIVE_WALLET, proofPack: PROOF_PACK });
    if (result !== ticket) throw new Error('expected the AuthTicket string');
  });

  await check('invalid proof → REJECTS with fatal error code', async () => {
    mockFetch(() => ({ status: 400, json: { valid: false, error: 'ERR_INVALID_ZK_PROOF' } }));
    const sdk = new IdentiFiSDK({ apiKey: API_KEY, apiUrl: API_URL });
    let msg = '';
    try {
      await sdk.authorizeTransaction({ activeWallet: ACTIVE_WALLET, proofPack: PROOF_PACK });
    } catch (err: any) {
      msg = err.message || '';
    }
    if (!/ERR_INVALID_ZK_PROOF/.test(msg)) throw new Error(`expected fatal error, got: ${msg}`);
  });

  await check('network error → REJECTS (fatal, unlike verifyRemote)', async () => {
    mockFetch(() => new Error('ECONNRESET'));
    const sdk = new IdentiFiSDK({ apiKey: API_KEY, apiUrl: API_URL });
    let threw = false;
    try {
      await sdk.authorizeTransaction({ activeWallet: ACTIVE_WALLET, proofPack: PROOF_PACK });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('expected fatal throw on network error');
  });

  // ─────────────────────────── PHASE 3: verifyTicket ──────────────────────
  console.log('\n━━━ [PHASE 3] verifyTicket() ━━━');

  await check('valid ticket → { valid: true, activeWallet, exp }', async () => {
    mockFetch(() => ({
      status: 200,
      json: { valid: true, activeWallet: ACTIVE_WALLET.toLowerCase(), exp: 1786119920 },
    }));
    const sdk = new IdentiFiSDK({ apiKey: API_KEY, apiUrl: API_URL });
    const res = await sdk.verifyTicket('idf1.v1.invalid.for.the.mock');
    if (res.valid !== true || res.exp !== 1786119920) throw new Error('expected valid ticket data');
  });

  await check('invalid ticket → { valid: false, error }', async () => {
    mockFetch(() => ({ status: 200, json: { valid: false, error: 'Invalid HMAC signature' } }));
    const sdk = new IdentiFiSDK({ apiKey: API_KEY, apiUrl: API_URL });
    const res = await sdk.verifyTicket('idf1.v1.tampered');
    if (res.valid !== false || !res.error) throw new Error('expected valid:false with error');
  });

  // ═══════════════════════════════════════════════════════════════════════
  console.log(`\n🏁 RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ FATAL ERROR:', err.message || err);
  process.exit(1);
});
