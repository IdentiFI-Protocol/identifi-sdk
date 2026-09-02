/**
 * IdentiFI SDK — Example: API Gateway (Server-Side Verification via verifyRemote)
 *
 * ★ This is the PRIMARY integration pattern for dApps.
 * All V2 proofs (System Pepper blinded) MUST be verified via verifyRemote().
 * Local verify() does NOT work — the SDK cannot replicate the secret server pepper.
 *
 * Architecture:
 *   [User's browser] ──generates ProofPack on identifi.xyz──► [your dApp]
 *   [your dApp]       ──sends { activeWallet, proofPack }──► [your API Gateway]
 *   [your API Gateway] ──calls sdk.verifyRemote()──────────► [IdentiFI Edge Function]
 *   [Edge Function]   ──returns { valid, plan }───────────►  [your API Gateway]
 *
 * The Edge Function:
 *   1. Blinds the wallet: Poseidon(activeWallet, SYSTEM_PEPPER)
 *   2. Looks up the blinded hash in ProofPack entries
 *   3. Runs Groth16 ZK verifier (Rust/WASM server-side)
 *   4. Meters usage against the API key's plan quota
 *
 * Works in:
 *  - Next.js API Routes
 *  - Express.js
 *  - Fastify
 *  - Cloudflare Workers
 *  - Any Node.js >= 18 HTTP server
 *
 * Usage-based billing: Each verifyRemote() call counts against your plan quota.
 */

import { IdentiFiSDK } from '../src/index.js';
import type { ProofPack } from '../src/index.js';

// ── Server-side SDK instance (no WASM loading needed) ────────────────────────
const sdk = new IdentiFiSDK({
  apiKey: process.env.IDENTIFI_API_KEY ?? 'id_live_your_key_here',
  apiUrl: 'https://hcftafgwrjbuxtebrsmi.supabase.co/functions/v1',
});

// ── Example: Next.js API Route ────────────────────────────────────────────────

interface VerifyRequest {
  activeWallet: string;
  proofPack: ProofPack;
}

interface VerifyResponse {
  authorized: boolean;
  reason?: string;
  requestId?: string;
}

/**
 * POST /api/verify-proof
 *
 * ★ Uses verifyRemote() — the ONLY method that works with V2 blinded proofs.
 */
export async function handleVerifyProof(body: VerifyRequest): Promise<VerifyResponse> {
  const { activeWallet, proofPack } = body;

  if (!activeWallet || !proofPack?.entries?.length) {
    return { authorized: false, reason: 'Missing activeWallet or proofPack' };
  }

  // ── Verify via IdentiFI API (★ required for V2 proofs) ────────────────
  const result = await sdk.verifyRemote(activeWallet, proofPack);

  if (!result.valid) {
    console.warn(`[Gateway] Proof rejected for ${activeWallet}:`, result.reason);
    return { authorized: false, reason: result.reason };
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[Gateway] ✓ Authorized operation for ${activeWallet} | reqId: ${requestId}`);

  return {
    authorized: true,
    requestId,
  };
}

// ── Example: Express.js Middleware ────────────────────────────────────────────

/**
 * Express middleware factory: gates any route behind IdentiFI proof validation.
 *
 * Usage:
 * ```typescript
 * app.post('/api/protected', requireIdentiFiProof(), handler);
 * ```
 *
 * The client must include the activeWallet + proofPack in the Authorization header:
 * `Authorization: IdentiFI <base64({activeWallet, proofPack})>`
 */
export function requireIdentiFiProof() {
  return async (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'] as string | undefined;

    if (!authHeader?.startsWith('IdentiFI ')) {
      return res.status(401).json({
        error: 'Missing IdentiFI proof in Authorization header',
        hint: 'Authorization: IdentiFI <base64({activeWallet, proofPack})>',
      });
    }

    try {
      const encoded = authHeader.slice('IdentiFI '.length);
      const payload: { activeWallet: string; proofPack: ProofPack } = JSON.parse(
        Buffer.from(encoded, 'base64').toString('utf8')
      );

      const { activeWallet, proofPack } = payload;

      if (!activeWallet || !proofPack?.entries?.length) {
        return res.status(400).json({
          error: 'Missing activeWallet or proofPack in authorization payload',
        });
      }

      const { valid, reason } = await sdk.verifyRemote(activeWallet, proofPack);

      if (!valid) {
        return res.status(403).json({ error: 'Invalid IdentiFI proof', reason });
      }

      // Attach verified proof metadata to request for downstream handlers
      req.identifi = { valid: true, activeWallet };
      next();
    } catch (err: any) {
      return res.status(400).json({ error: 'Malformed proof payload', detail: err.message });
    }
  };
}

// ── Usage stats aggregation example ──────────────────────────────────────────

interface UsageRecord {
  timestamp: number;
  walletAddress: string;
  proofRoot: string;
  authorized: boolean;
}

const _usageLog: UsageRecord[] = [];

export function recordUsage(record: UsageRecord): void {
  _usageLog.push(record);
}

export function getUsageStats(): { total: number; authorized: number; rejected: number } {
  const authorized = _usageLog.filter((r) => r.authorized).length;
  return {
    total: _usageLog.length,
    authorized,
    rejected: _usageLog.length - authorized,
  };
}
