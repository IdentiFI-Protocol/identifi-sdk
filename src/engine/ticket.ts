/**
 * IdentiFI Protocol SDK — AuthTicket Helpers (3rd Function)
 *
 * Parse and LOCAL verification of the AuthTicket issued by the Edge Function
 * `/authorize`. The canonical format:
 *
 *   idf1.v1.<activeWallet>.<root>.<exp>.<iat>.<checkedAt>.<nonce>.<sig>
 *
 * Canonical normalization (MANDATORY on both sides — /authorize and
 * /verify-ticket): lowercase on all hex, root without `0x`. Any divergence
 * in the HMAC recomputation silently invalidates the ticket.
 *
 * ⚠️ Rust compatibility: `verifier.rs` uses the secret as
 * `validator_secret_hex.as_bytes()` (UTF-8 bytes of the hex STRING, NOT
 * decoded hex). `verifyTicketLocally` replicates exactly this via
 * `new TextEncoder().encode(secret)` — if one side decodes and the other
 * doesn't, the HMAC never matches.
 *
 * @module @identifi-protocol/sdk/engine
 */

import type { AuthTicket, AuthTicketPayload, TicketVerification } from './types.js';

/** Clock skew tolerance window for `checkedAt` (seconds). */
export const TICKET_SKEW_SECONDS = 120;

/**
 * Resolves the runtime `SubtleCrypto` — compatible with browser and Node.js >= 18.
 *
 * `globalThis.crypto.subtle` only exists by default on Node >= 19. On Node 18
 * (the SDK's minimum) we must fall back to `node:crypto` webcrypto.
 */
async function getSubtle(): Promise<SubtleCrypto> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  try {
    const { webcrypto } = await import('node:crypto');
    return webcrypto.subtle as unknown as SubtleCrypto;
  } catch {
    throw new Error(
      '[IdentiFI] Web Crypto unavailable — use a secure context (HTTPS) in browsers or Node.js >= 18 for verifyTicketLocally()'
    );
  }
}

const TICKET_PARTS = 9; // idf1.v1.wallet.root.exp.iat.checkedAt.nonce.sig

/**
 * Parses an AuthTicket in the canonical format.
 * Returns `null` for malformed tickets (structure, version or invalid fields).
 */
export function parseAuthTicket(ticket: AuthTicket): AuthTicketPayload | null {
  if (typeof ticket !== 'string' || ticket.length === 0) return null;

  const parts = ticket.split('.');
  if (parts.length !== TICKET_PARTS) return null;

  const [protocol, version, activeWallet, root, expStr, iatStr, checkedAtStr, nonce, sig] = parts;

  if (protocol !== 'idf1' || version !== 'v1') return null;

  const exp = Number(expStr);
  const iat = Number(iatStr);
  const checkedAt = Number(checkedAtStr);

  // Timestamps must be positive safe integers in Unix seconds
  if (!Number.isSafeInteger(exp) || !Number.isSafeInteger(iat) || !Number.isSafeInteger(checkedAt)) {
    return null;
  }
  if (exp <= 0 || iat <= 0 || checkedAt <= 0) return null;

  // nonce: 16 random bytes → 32 hex chars
  if (!/^[0-9a-f]{32}$/i.test(nonce)) return null;
  // sig: HMAC-SHA256 → 64 hex chars
  if (!/^[0-9a-f]{64}$/i.test(sig)) return null;

  const canonical = parts.slice(0, TICKET_PARTS - 1).join('.');

  return {
    protocol,
    version,
    activeWallet,
    root,
    exp,
    iat,
    checkedAt,
    nonce,
    canonical,
    sig,
  };
}

/**
 * Computes the hex HMAC-SHA256 over the payload using the shared secret.
 *
 * The secret is used as the UTF-8 bytes of the string (same as the Rust
 * `as_bytes()`) — NOT hex-decoded. Requires Web Crypto (`crypto.subtle`),
 * available in modern browsers and Node.js >= 18.
 *
 * @param secretHex - Shared TICKET_SECRET (self-hosted / DEX operator)
 * @param payload - Canonical payload over which the HMAC was computed
 * @returns Lowercase hex HMAC-SHA256 signature
 */
export async function computeTicketHmac(secretHex: string, payload: string): Promise<string> {
  const subtle = await getSubtle();
  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(secretHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const mac = await subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * LOCAL verification of an AuthTicket (self-hosted — the DEX operator
 * holds the shared TICKET_SECRET and does not call the IdentiFI API).
 *
 * Rules (identical to the Edge Function `/verify-ticket`):
 *   1. Canonical parse + HMAC recomputation (integrity + authenticity)
 *   2. `checkedAt` within the skew window (±120s)
 *   3. `now <= exp` — the ticket dies with the proof
 *
 * @param ticket - AuthTicket `idf1.v1....`
 * @param secretHex - Shared TICKET_SECRET (hex string, ≤ 64 UTF-8 bytes)
 * @returns TicketVerification — { valid: true, activeWallet, exp } or error
 */
export async function verifyTicketLocally(
  ticket: AuthTicket,
  secretHex: string
): Promise<TicketVerification> {
  if (!secretHex) {
    return { valid: false, error: 'Missing TICKET_SECRET — configure SDKConfig.ticketSecret or pass it explicitly (self-hosted mode)' };
  }

  const parsed = parseAuthTicket(ticket);
  if (!parsed) {
    return { valid: false, error: 'Malformed ticket — expected idf1.v1.<wallet>.<root>.<exp>.<iat>.<checkedAt>.<nonce>.<sig>' };
  }

  // 1. Integrity — HMAC recomputation over the canonical payload
  const expectedSig = await computeTicketHmac(secretHex, parsed.canonical);
  if (expectedSig !== parsed.sig.toLowerCase()) {
    return { valid: false, error: 'Invalid HMAC signature — ticket was tampered or TICKET_SECRET mismatch' };
  }

  const now = Math.floor(Date.now() / 1000);

  // 2. Skew — checkedAt cannot be far from the current clock
  if (Math.abs(now - parsed.checkedAt) > TICKET_SKEW_SECONDS) {
    return { valid: false, error: 'Ticket outside skew window (±120s) — replay or stale check' };
  }

  // 3. Not-yet-valid — parity with the Rust (ERR_PROOF_NOT_YET_VALID)
  if (now < parsed.iat) {
    return { valid: false, error: 'Ticket not yet valid — clock skew in issuance' };
  }

  // 4. Expiration — the ticket dies with the proof
  if (now > parsed.exp) {
    return { valid: false, error: 'Ticket expired' };
  }

  return { valid: true, activeWallet: parsed.activeWallet, exp: parsed.exp };
}
