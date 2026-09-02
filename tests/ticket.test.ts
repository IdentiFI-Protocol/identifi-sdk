/**
 * 🧪 IdentiFI SDK — AuthTicket Unit Tests (3rd Function)
 *
 * Usage:
 *   npx tsx tests/ticket.test.ts
 *
 * Covers:
 *   1. parseAuthTicket — canonical idf1.v1 format (valid + malformed)
 *   2. computeTicketHmac — deterministic, HMAC-SHA256 compatible
 *   3. verifyTicketLocally — roundtrip, tamper, skew, not-yet-valid, expiration
 *   4. Verification via the public SDK API (IdentiFiSDK.verifyTicketLocally)
 *
 * ⚠️ Independent oracle: reference tickets are forged with `node:crypto`
 * createHmac (secret as UTF-8 bytes, same as the Rust `as_bytes()`). If the
 * SDK's Web Crypto diverges, the test reports it immediately.
 */

import { createHmac } from 'node:crypto';
import { strict as assert } from 'node:assert';
import {
  parseAuthTicket,
  computeTicketHmac,
  verifyTicketLocally,
  TICKET_SKEW_SECONDS,
} from '../src/engine/ticket.js';
import { IdentiFiSDK } from '../src/IdentiFiSDK.js';

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 TEST CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// Test secret with exactly 64 bytes (HMAC-SHA256 limit)
const TEST_SECRET = '9c1f8d3a6e2b4c7f5a9d0e8b2c4f6a8d3b5e7c9a1d4f6e8b0c2a4d6e8f0a1b2c';
const WALLET = '0xd45c7d0b8944cb913feef3c35466560fe5c11482';
const ROOT = '0x2e78f870f4c80b415362df5b809d47f973cfb62a628b70c7ceba5ff312ab2518';
const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // 32 hex chars
const NOW = () => Math.floor(Date.now() / 1000);

/**
 * Forges a canonical AuthTicket with the EXACT Rust format:
 *   idf1.v1.{wallet_lower}.{root_no_0x_lower}.{exp}.{iat}.{checkedAt}.{nonce}.{sig}
 * The signature is computed with node:crypto (independent oracle).
 */
function buildTicket(opts: {
  wallet?: string;
  root?: string;
  exp?: number;
  iat?: number;
  checkedAt?: number;
  nonce?: string;
  secret?: string;
  sigOverride?: string;
}): { ticket: string; canonical: string; sig: string } {
  const wallet = (opts.wallet ?? WALLET).toLowerCase();
  const root = (opts.root ?? ROOT).replace(/^0x/, '').toLowerCase();
  const exp = opts.exp ?? NOW() + 3600;
  const iat = opts.iat ?? NOW() - 3600;
  const checkedAt = opts.checkedAt ?? NOW();
  const nonce = opts.nonce ?? NONCE;
  const secret = opts.secret ?? TEST_SECRET;

  const canonical = `idf1.v1.${wallet}.${root}.${exp}.${iat}.${checkedAt}.${nonce}`;
  const sig = opts.sigOverride ?? createHmac('sha256', secret).update(canonical).digest('hex');

  return { ticket: `${canonical}.${sig}`, canonical, sig };
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 TESTS
// ═══════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
const checks: Promise<void>[] = [];

function check(name: string, fn: () => void | Promise<void>): void {
  // Collects the promise — run() awaits ALL via Promise.all before exiting,
  // otherwise process.exit() would kill the microtasks and no assertion would run.
  checks.push(
    Promise.resolve()
      .then(fn)
      .then(() => {
        passed++;
        console.log(`   ✅ ${name}`);
      })
      .catch((err) => {
        failed++;
        console.error(`   ❌ ${name} — ${err.message}`);
      })
  );
}

async function run() {
  checks.length = 0; // defensive: avoids accumulation if run() is called again
  passed = 0;
  failed = 0;
  console.log('🧪 [IdentiFI AuthTicket Unit Test] Starting...\n');

  // ─────────────────────────── PHASE 1: parseAuthTicket ──────────────────────
  console.log('━━━ [PHASE 1] parseAuthTicket — canonical format ━━━');

  check('parse of a valid ticket returns all fields', () => {
    const { ticket, canonical } = buildTicket({});
    const parsed = parseAuthTicket(ticket);
    assert.ok(parsed, 'should parse');
    assert.equal(parsed.protocol, 'idf1');
    assert.equal(parsed.version, 'v1');
    assert.equal(parsed.activeWallet, WALLET.toLowerCase());
    assert.equal(parsed.root, ROOT.replace(/^0x/, '').toLowerCase());
    assert.equal(typeof parsed.exp, 'number');
    assert.equal(parsed.canonical, canonical);
    assert.equal(parsed.sig.length, 64);
  });

  check('canonical = first 8 parts joined by dot', () => {
    const { ticket } = buildTicket({});
    const parsed = parseAuthTicket(ticket)!;
    assert.equal(parsed.canonical, ticket.split('.').slice(0, 8).join('.'));
  });

  check('rejects empty string', () => {
    assert.equal(parseAuthTicket(''), null);
  });

  check('rejects part count different from 9', () => {
    const { ticket } = buildTicket({});
    assert.equal(parseAuthTicket(ticket.split('.').slice(0, 8).join('.')), null);
    assert.equal(parseAuthTicket(`${ticket}.extra`), null);
  });

  check('rejects different protocol/version', () => {
    const { ticket } = buildTicket({});
    const badProto = ticket.replace(/^idf1/, 'foobar');
    assert.equal(parseAuthTicket(badProto), null);
    const badVer = ticket.replace(/\.v1\./, '.v2.');
    assert.equal(parseAuthTicket(badVer), null);
  });

  check('rejects non-positive-integer timestamps', () => {
    const { ticket } = buildTicket({});
    const parts = ticket.split('.');
    parts[4] = 'abc'; // invalid exp
    assert.equal(parseAuthTicket(parts.join('.')), null);
    parts[4] = '0';   // zero exp
    assert.equal(parseAuthTicket(parts.join('.')), null);
    parts[4] = '-5';  // negative exp
    assert.equal(parseAuthTicket(parts.join('.')), null);
  });

  check('rejects nonce outside the 32-hex format', () => {
    const { ticket } = buildTicket({ nonce: 'zz'.repeat(16) });
    assert.equal(parseAuthTicket(ticket), null);
    const short = buildTicket({ nonce: 'a'.repeat(31) });
    assert.equal(parseAuthTicket(short.ticket), null);
  });

  check('rejects sig outside the 64-hex format', () => {
    const { ticket } = buildTicket({ sigOverride: '0'.repeat(63) });
    assert.equal(parseAuthTicket(ticket), null);
  });

  // ─────────────────────────── PHASE 2: computeTicketHmac ─────────────────────
  console.log('\n━━━ [PHASE 2] computeTicketHmac — determinism and compatibility ━━━');

  check('SDK HMAC == node:crypto HMAC (same payload/secret)', async () => {
    const { canonical } = buildTicket({});
    const expected = createHmac('sha256', TEST_SECRET).update(canonical).digest('hex');
    const actual = await computeTicketHmac(TEST_SECRET, canonical);
    assert.equal(actual, expected);
  });

  check('HMAC is deterministic (two identical calls)', async () => {
    const { canonical } = buildTicket({});
    const a = await computeTicketHmac(TEST_SECRET, canonical);
    const b = await computeTicketHmac(TEST_SECRET, canonical);
    assert.equal(a, b);
  });

  check('different canonical payload → different HMAC', async () => {
    const { canonical } = buildTicket({});
    const other = buildTicket({ exp: NOW() + 9999 }).canonical;
    const a = await computeTicketHmac(TEST_SECRET, canonical);
    const b = await computeTicketHmac(TEST_SECRET, other);
    assert.notEqual(a, b);
  });

  // ─────────────────────────── PHASE 3: verifyTicketLocally ───────────────────
  console.log('\n━━━ [PHASE 3] verifyTicketLocally — validations ━━━');

  check('valid ticket + correct secret → valid:true with wallet/exp', async () => {
    const { ticket } = buildTicket({});
    const res = await verifyTicketLocally(ticket, TEST_SECRET);
    assert.equal(res.valid, true);
    assert.equal(res.activeWallet, WALLET.toLowerCase());
    assert.equal(typeof res.exp, 'number');
  });

  check('wrong secret → invalid (TICKET_SECRET mismatch)', async () => {
    const { ticket } = buildTicket({});
    const res = await verifyTicketLocally(ticket, '0'.repeat(64));
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('HMAC'));
  });

  check('missing secret → explicit error', async () => {
    const { ticket } = buildTicket({});
    const res = await verifyTicketLocally(ticket, '');
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('TICKET_SECRET'));
  });

  check('malformed ticket → parse error', async () => {
    const res = await verifyTicketLocally('idf1.v1.incomplete', TEST_SECRET);
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('Malformed'));
  });

  check('TAMPER on wallet → invalid (HMAC breaks)', async () => {
    const { ticket } = buildTicket({});
    const tampered = ticket.replace(WALLET.toLowerCase(), '0x1111111111111111111111111111111111111111');
    const res = await verifyTicketLocally(tampered, TEST_SECRET);
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('HMAC'));
  });

  check('TAMPER on exp → invalid (HMAC breaks)', async () => {
    const { ticket } = buildTicket({});
    const parts = ticket.split('.');
    parts[4] = String(NOW() + 12345); // exp
    const res = await verifyTicketLocally(parts.join('.'), TEST_SECRET);
    assert.equal(res.valid, false);
  });

  check(`skew: checkedAt ${TICKET_SKEW_SECONDS + 180}s in the past → invalid`, async () => {
    const { ticket } = buildTicket({ checkedAt: NOW() - (TICKET_SKEW_SECONDS + 180) });
    const res = await verifyTicketLocally(ticket, TEST_SECRET);
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('skew'));
  });

  check('not-yet-valid: iat in the future → invalid', async () => {
    const { ticket } = buildTicket({ iat: NOW() + 3600 });
    const res = await verifyTicketLocally(ticket, TEST_SECRET);
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('not yet valid'));
  });

  check('expired: exp in the past → invalid', async () => {
    const { ticket } = buildTicket({ exp: NOW() - 60 });
    const res = await verifyTicketLocally(ticket, TEST_SECRET);
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('expired'));
  });

  // ─────────────────── PHASE 4: via the public SDK API ────────────────────────
  console.log('\n━━━ [PHASE 4] IdentiFiSDK.verifyTicketLocally (public method) ━━━');

  check('SDK resolves with ticketSecret from config', async () => {
    const sdk = new IdentiFiSDK({ ticketSecret: TEST_SECRET });
    const { ticket } = buildTicket({});
    const res = await sdk.verifyTicketLocally(ticket);
    assert.equal(res.valid, true);
  });

  check('SDK rejects tamper via public method', async () => {
    const sdk = new IdentiFiSDK({ ticketSecret: TEST_SECRET });
    const { ticket } = buildTicket({});
    const tampered = ticket.replace(WALLET.toLowerCase(), '0x2222222222222222222222222222222222222222');
    const res = await sdk.verifyTicketLocally(tampered);
    assert.equal(res.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Awaits ALL assertions before the summary — without this, process.exit
  // would kill the microtasks and the test would always report 0/0.
  await Promise.all(checks);

  console.log(`\n🏁 RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ FATAL ERROR:', err.message || err);
  process.exit(1);
});
