/**
 * IdentiFI Protocol SDK — Public Type Definitions
 *
 * All interfaces exposed to SDK consumers. These types form the
 * public contract between IdentiFI and integrating dApps.
 *
 * @module @identifi-protocol/sdk/types
 */

// ─── SDK Configuration ──────────────────────────────────────────────────────

/**
 * Configuration passed to IdentiFiSDK constructor.
 *
 * @example
 * // SaaS mode (recommended for dApp frontends)
 * { apiKey: 'id_live_xxxxx' }
 *
 * @example
 * // Self-hosted ticket validation (DEX operator backend)
 * { apiKey: 'id_live_xxxxx', ticketSecret: '<shared TICKET_SECRET>' }
 */
export interface SDKConfig {
  /**
   * Your IdentiFI API key for metered/SaaS usage tracking.
   * Format: `id_live_xxxxx` (production) | `id_test_xxxxx` (testnet)
   */
  apiKey?: string;

  /**
   * Base URL for the IdentiFI gateway API.
   * Defaults to 'https://api.identifi.xyz/v1'.
   * Override for self-hosted deployments.
   */
  apiUrl?: string;

  /**
   * Trusted Ethereum RPC URL for on-chain timestamp validation.
   * e.g. 'https://mainnet.infura.io/v3/YOUR_KEY'
   * Falls back to `Date.now()` if not provided.
   */
  rpcUrl?: string;

  /**
   * Shared TICKET_SECRET (hex) for SELF-HOSTED ticket verification.
   * Used by `verifyTicketLocally()` — never ship this to the browser;
   * it belongs in your backend env (DEX operator mode).
   * Omit for SaaS mode (verifyTicket() via the IdentiFI API).
   */
  ticketSecret?: string;
}

// ─── ProofPack (Multi-Wallet Identity Proof) ─────────────────────────────────

/**
 * A single entry in a ProofPack — a proof bound to a specific sub-wallet.
 * The wallet is obfuscated via Poseidon(sub_wallet, SYSTEM_PEPPER) — NOT keccak256.
 * The blinded hash (Poseidon) is used directly as walletHash to prevent
 * dictionary attacks (zero reversible hash traces in the JSON).
 */
export interface ProofPackEntry {
  /**
   * Poseidon(sub_wallet, SYSTEM_PEPPER) — blinded hash of the sub-wallet.
   * NOT keccak256. This value is computed server-side by the IdentiFI backend
   * that holds the secret SYSTEM_PEPPER. Impossible to reverse into the real wallet.
   */
  walletHash: string;
  /** Groth16 ZK-SNARK proof bytes, hex-encoded. */
  proof: string;
  /** Poseidon commitment root of the cluster (public input). */
  root: string;
  /** Issued-at timestamp (Unix seconds) as string (bigint-safe). */
  iat: string;
  /** Expiry timestamp (Unix seconds) as string (bigint-safe). */
  exp: string;
}

/**
 * Pack of multiple proofs — one for each sub-wallet of the cluster.
 * The user downloads ONE file and can use it with any wallet of the cluster
 * without revealing the sub-wallets (protected by Poseidon blinding with
 * System Pepper — zero keccak256 traces in the JSON).
 */
export interface ProofPack {
  /** Pack format (currently 1) */
  version: 1;
  /** Master wallet address (public — has KYC on the DEX) */
  masterAddress: string;
  /** Creation timestamp (Unix seconds) */
  createdAt: string;
  /** Expiration timestamp (Unix seconds) */
  expiresAt: string;
  /** Entries — one proof per sub-wallet, identified by hash */
  entries: ProofPackEntry[];
}

// ─── Verification ────────────────────────────────────────────────────────────

/**
 * Result of a proof verification call.
 */
export interface VerifyResult {
  /** True if the proof is cryptographically valid and not expired. */
  valid: boolean;
  /** Human-readable reason for failure, undefined if valid. */
  reason?: string;
}

// ─── AuthTicket (3rd Function — the SDK's active lock) ─────────────────────

/**
 * Authorization ticket issued by the IdentiFI server after ZK verification.
 *
 * Canonical format:
 * `idf1.v1.<activeWallet>.<root>.<exp>.<iat>.<checkedAt>.<nonce>.<sig>`
 *
 * - `activeWallet`/`root`: lowercase hex, root without `0x`
 * - `exp`/`iat`/`checkedAt`: Unix timestamps (seconds)
 * - `nonce`: 16 random bytes (hex) — uniqueness, not single-use
 * - `sig`: HMAC-SHA256 hex over the payload (idf1.v1...nonce)
 *
 * The DEX validates with `verifyTicket()` (SaaS/metered) or `verifyTicketLocally()`
 * (self-hosted with a shared TICKET_SECRET).
 */
export type AuthTicket = string;

/**
 * Structured payload of an AuthTicket after parsing (without the signature).
 * Used internally by `verifyTicketLocally`.
 */
export interface AuthTicketPayload {
  protocol: string;      // 'idf1'
  version: string;       // 'v1'
  activeWallet: string;
  root: string;
  exp: number;
  iat: number;
  checkedAt: number;
  nonce: string;
  /** Canonical payload (idf1.v1...nonce) over which the HMAC was computed. */
  canonical: string;
  /** HMAC-SHA256 hex signature extracted from the ticket. */
  sig: string;
}

/**
 * Response of the `POST /authorize` endpoint (ticket issuance).
 */
export interface AuthorizeResult {
  valid: boolean;
  /** AuthTicket (`idf1.v1....`) — present only when valid === true. */
  ticket?: AuthTicket;
  /** Unix expiration timestamp of the ticket (seconds). */
  exp?: number;
  /** Unix verification timestamp (seconds). */
  checked_at?: number;
  /** Error code (ERR_PROOF_EXPIRED | ERR_INVALID_ZK_PROOF | ...). */
  error?: string;
}

/**
 * Result of an AuthTicket validation (verifyTicket / verifyTicketLocally).
 */
export interface TicketVerification {
  valid: boolean;
  /** Wallet bound to the ticket (present when valid === true). */
  activeWallet?: string;
  /** Unix expiration timestamp (seconds) — present when valid === true. */
  exp?: number;
  /** Error code when invalid. */
  error?: string;
}
