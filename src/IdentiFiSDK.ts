/**
 * IdentiFI Protocol SDK — API Client for Remote Verification (V2)
 *
 * `IdentiFiSDK` is the single entry point for dApp integrators.
 *
 * ★ V2 API (100% server-side verification):
 *   - `verifyRemote()`         → validates a ProofPack via the IdentiFI API
 *   - `authorizeTransaction()` → validates AND issues an AuthTicket (active lock)
 *   - `verifyTicket()`         → validates an AuthTicket via the API (SaaS, metered)
 *   - `verifyTicketLocally()`  → validates an AuthTicket with a shared secret (self-hosted)
 *
 * The SDK is a thin, typed HTTP client. There is NO local WASM engine, no bundled
 * verifying key, and no file-system access — all cryptography runs server-side
 * inside the IdentiFI Edge Function (System Pepper blinding + Groth16 verifier).
 *
 * Proof generation is performed exclusively by the IdentiFI website.
 * This SDK only triggers remote verification.
 *
 * Usage:
 * ```typescript
 * const sdk = new IdentiFiSDK({ apiKey: 'id_live_abc123' });
 * const { valid } = await sdk.verifyRemote(activeWallet, proofPack);
 * ```
 *
 * @module @identifi-protocol/sdk
 */

import { EthProvider } from './provider/EthProvider.js';

import type {
  SDKConfig,
  VerifyResult,
  ProofPack,
  AuthTicket,
  TicketVerification,
} from './engine/types.js';
import { verifyTicketLocally as verifyTicketLocallyInternal } from './engine/ticket.js';

export type {
  SDKConfig,
  VerifyResult,
  ProofPack,
  AuthTicket,
  TicketVerification,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_API_URL = 'https://api.identifi.xyz/v1';

// ─── IdentiFiSDK ─────────────────────────────────────────────────────────────

export class IdentiFiSDK {
  private _config: SDKConfig;
  private _provider: EthProvider;

  constructor(config: SDKConfig = {}) {
    this._config = config;
    this._provider = new EthProvider({ rpcUrl: config.rpcUrl });
  }

  // ── Wallet Provider ───────────────────────────────────────────────────

  /**
   * Access the underlying EthProvider for wallet operations.
   * Use this to connect, sign messages, or get network info.
   */
  get provider(): EthProvider {
    return this._provider;
  }

  // ── Proof Verification (V2 — server-side) ─────────────────────────────

  /**
   * ★ PRIMARY VERIFICATION METHOD
   *
   * Verifies a ProofPack via the IdentiFI API (Supabase Edge Function).
   * This is the **only** verification path for V2 proofs (System Pepper blinded).
   *
   * How it works:
   * 1. Sends activeWallet + ProofPack to the IdentiFI Edge Function
   * 2. Server blinds the wallet: Poseidon(activeWallet, SYSTEM_PEPPER)
   * 3. Looks up the blinded hash in the ProofPack entries
   * 4. Runs Groth16 ZK verifier (Rust/WASM server-side)
   * 5. Meters usage against API key plan quota
   * 6. Returns { valid, plan }
   *
   * NOTE: The walletHash in V2 ProofPacks is Poseidon(sub_wallet, SYSTEM_PEPPER),
   * NOT keccak256. No reversible hash leaks in the JSON.
   *
   * Requires a valid `apiKey` in the SDK config.
   *
   * @param activeWallet - Hex-encoded operative wallet address
   * @param proofPack - Complete ProofPack with walletHash = Poseidon blinded hash
   * @returns VerifyResult from the API response
   */
  async verifyRemote(activeWallet: string, proofPack: ProofPack): Promise<VerifyResult> {
    if (!this._config.apiKey) {
      throw new Error(
        '[IdentiFI] verifyRemote() requires an apiKey in SDKConfig. ' +
        'Get your API key at https://identifi.xyz/dashboard'
      );
    }

    if (!activeWallet) {
      return { valid: false, reason: 'Missing operative wallet address (activeWallet)' };
    }

    if (!proofPack || !proofPack.entries || proofPack.entries.length === 0) {
      return { valid: false, reason: 'Invalid or empty ProofPack' };
    }

    const apiUrl = this._config.apiUrl ?? DEFAULT_API_URL;

    try {
      const response = await fetch(`${apiUrl}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-IdentiFI-Key': this._config.apiKey,
        },
        body: JSON.stringify({
          activeWallet,
          proofPack,
        }),
      });

      const data = await response.json();

      return {
        valid: data.valid === true,
        reason: data.error,
      };
    } catch (err: any) {
      return {
        valid: false,
        reason: `Network error: ${err.message}`,
      };
    }
  }

  // ── AuthTicket (the SDK's active lock) ────────────────────────────────

  /**
   * ★ 3rd FUNCTION — verifies the proof AND issues the AuthTicket
   * (the evolution of V1's `forge_hook_data`, now with ZK).
   *
   * This is the method that gives the SDK teeth: there is no "swallowable" `false`
   * return — either it resolves with a signed ticket, or it REJECTS with a fatal
   * error that kills the dApp's button click before it reaches the network.
   *
   * Flow (V2 — System Pepper blinded):
   *   1. SDK sends { activeWallet, proofPack } to `{apiUrl}/authorize`
   *   2. The Edge Function blinds the wallet (Poseidon + SYSTEM_PEPPER),
   *      applies the temporal lock and runs the Groth16 verifier in WASM
   *   3. If valid → Rust forges the AuthTicket (HMAC-SHA256, server-side secret)
   *   4. Resolves with the string `idf1.v1.<wallet>.<root>.<exp>.<iat>.<checkedAt>.<nonce>.<sig>`
   *
   * If invalid/expired → REJECTS with the error code (ERR_PROOF_EXPIRED,
   * ERR_INVALID_ZK_PROOF, ...) — the dApp catches it and the click dies
   * before reaching the network.
   *
   * Requires `apiKey` in SDKConfig.
   *
   * @param params.activeWallet - Wallet connected in the dApp executing the action
   * @param params.proofPack - ProofPack downloaded from the IdentiFI website
   * @returns Promise<AuthTicket> — the ticket authorizing the operation
   * @throws Error with the fatal error code on failure
   *
   * @example
   * async function handleSwapClick() {
   *   try {
   *     const authTicket = await sdk.authorizeTransaction({
   *       activeWallet: userWallet,
   *       proofPack: userProofPack,
   *     });
   *     await dexContract.executeSwap(authTicket);
   *   } catch (error) {
   *     alert('IdentiFI validation failed: ' + error.message);
   *   }
   * }
   */
  async authorizeTransaction(params: {
    activeWallet: string;
    proofPack: ProofPack;
  }): Promise<AuthTicket> {
    if (!this._config.apiKey) {
      throw new Error(
        '[IdentiFI] authorizeTransaction() requires an apiKey in SDKConfig. ' +
        'Get your API key at https://identifi.xyz/dashboard'
      );
    }

    if (!params?.activeWallet) {
      throw new Error('[IdentiFI] authorizeTransaction() requires activeWallet');
    }

    if (!params?.proofPack || !params.proofPack.entries || params.proofPack.entries.length === 0) {
      throw new Error('[IdentiFI] authorizeTransaction() requires a non-empty ProofPack');
    }

    const apiUrl = this._config.apiUrl ?? DEFAULT_API_URL;

    let response: Response;
    try {
      response = await fetch(`${apiUrl}/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-IdentiFI-Key': this._config.apiKey,
        },
        body: JSON.stringify({
          activeWallet: params.activeWallet,
          proofPack: params.proofPack,
        }),
      });
    } catch (err: any) {
      throw new Error(`[IdentiFI] authorizeTransaction() network error: ${err.message}`);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        `[IdentiFI] authorization failed: HTTP ${response.status} (invalid response body)`
      );
    }

    if (response.ok && data.valid === true && typeof data.ticket === 'string' && data.ticket.length > 0) {
      return data.ticket as AuthTicket;
    }

    // ── Fatal error — aborts the dApp flow ───────────────────────────
    const code = typeof data.error === 'string' && data.error.length > 0
      ? data.error
      : `HTTP ${response.status}`;
    throw new Error(`[IdentiFI] authorization failed: ${code}`);
  }

  /**
   * ★ NEW — validates an AuthTicket on the IdentiFI backend (SaaS, metered).
   *
   * The DEX calls this method BEFORE executing the action: if the ticket was
   * tampered with, expired, or left the skew window, `valid` is false and the
   * operation is blocked. The secret never leaves IdentiFI.
   *
   * Self-hosted alternative: `verifyTicketLocally()` with a shared TICKET_SECRET
   * — no API call required.
   *
   * Requires `apiKey` in SDKConfig (metered).
   *
   * @param ticket - AuthTicket received from the client (`idf1.v1....`)
   * @returns TicketVerification — { valid, activeWallet, exp } or error
   *
   * @example
   * const { valid, exp } = await sdk.verifyTicket(authTicket);
   * if (valid && exp > Date.now() / 1000) {
   *   await dexContract.executeSwap(authTicket);
   * }
   */
  async verifyTicket(ticket: AuthTicket): Promise<TicketVerification> {
    if (!this._config.apiKey) {
      throw new Error(
        '[IdentiFI] verifyTicket() requires an apiKey in SDKConfig (metered SaaS). ' +
        'For self-hosted, use verifyTicketLocally() with a shared TICKET_SECRET.'
      );
    }

    if (!ticket || typeof ticket !== 'string' || ticket.length === 0) {
      return { valid: false, error: 'Invalid or empty AuthTicket' };
    }

    const apiUrl = this._config.apiUrl ?? DEFAULT_API_URL;

    try {
      const response = await fetch(`${apiUrl}/verify-ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-IdentiFI-Key': this._config.apiKey,
        },
        body: JSON.stringify({ ticket }),
      });

      const data = await response.json();

      return {
        valid: data.valid === true,
        activeWallet: data.activeWallet,
        exp: typeof data.exp === 'number' ? data.exp : undefined,
        error: data.error,
      };
    } catch (err: any) {
      return {
        valid: false,
        error: `Network error: ${err.message}`,
      };
    }
  }

  /**
   * ★ NEW — validates an AuthTicket LOCALLY (self-hosted).
   *
   * For DEX operators that configure the shared `TICKET_SECRET` on their own
   * backend — without calling the IdentiFI API on every swap.
   *
   * ⚠️ SECURITY: this method must NEVER run in the end user's browser —
   * the secret would be extractable. Use it ONLY in the operator's
   * backend/Edge Function (same trust boundary as `SYSTEM_PEPPER`).
   *
   * Validation rules (identical to `/verify-ticket`):
   *   1. Canonical parse + HMAC-SHA256 recomputation
   *   2. `checkedAt` within the skew window (±120s)
   *   3. `now <= exp` — the ticket dies with the proof
   *
   * @param ticket - AuthTicket received from the client (`idf1.v1....`)
   * @param secretHex - Shared TICKET_SECRET (or uses SDKConfig.ticketSecret)
   * @returns TicketVerification — { valid, activeWallet, exp } or error
   */
  async verifyTicketLocally(ticket: AuthTicket, secretHex?: string): Promise<TicketVerification> {
    return verifyTicketLocallyInternal(ticket, secretHex ?? this._config.ticketSecret ?? '');
  }

  // ── Session Teardown ──────────────────────────────────────────────────

  /**
   * Clears all session state — "The Purge".
   *
   * Resets the EthProvider (signer, RPC cache, listeners).
   */
  purge(): void {
    this._provider.reset();
  }
}
