/**
 * @identifi-protocol/sdk — Public Entry Point
 *
 * IdentiFI SDK for ZK proof VERIFICATION (V2 — server-side).
 * Proof generation is performed exclusively by the IdentiFI website.
 *
 * ```typescript
 * import { IdentiFiSDK } from '@identifi-protocol/sdk';
 * import type { ProofPack, VerifyResult } from '@identifi-protocol/sdk';
 * ```
 *
 * For advanced use cases (wallet-level access):
 * ```typescript
 * import { EthProvider } from '@identifi-protocol/sdk/provider';
 * ```
 */

// ── Main SDK Class (default export for most integrators)
export { IdentiFiSDK } from './IdentiFiSDK.js';

// ── Advanced: low-level wallet provider
export { EthProvider } from './provider/EthProvider.js';

// ── Types (re-exported for consumers)
export type {
  SDKConfig,
  ProofPack,
  ProofPackEntry,
  VerifyResult,
  AuthTicket,
  AuthTicketPayload,
  AuthorizeResult,
  TicketVerification,
} from './engine/types.js';

export type { EthProviderOptions, NetworkInfo } from './provider/EthProvider.js';
