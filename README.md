# IdentiFI Protocol SDK

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-0066ff?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-00ff88?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/engine-Rust%2FWASM%20(server--side)-ff6600?style=for-the-badge" alt="Engine" />
  <img src="https://img.shields.io/badge/ZK-Groth16%20%2B%20BN254-aa00ff?style=for-the-badge" alt="ZK" />
  <img src="https://img.shields.io/badge/bundle-%3E3kB%20gzip-00ff88?style=for-the-badge" alt="Bundle" />
</p>

<p align="center">
  <strong>Zero-knowledge proof VERIFICATION SDK for wallet cluster ownership.</strong><br/>
  A thin, typed HTTP client — all cryptography runs server-side via the IdentiFI API.
</p>

---

## What is IdentiFI?

IdentiFI is a **stateless cryptographic infrastructure protocol** that separates **asset ownership** from **operator identity** in DeFi.

A user links a KYC-verified master wallet to multiple sub-wallets on the IdentiFI website. The website generates a **ZK-SNARK proof** (Groth16 over BN254). This SDK submits those proofs to the IdentiFI API for verification — without ever exposing the master wallet address.

> *"IdentiFI doesn't change what you transact on the blockchain. It changes who can see that you own it."*

**What the verifier sees:** A boolean `true/false` from a cryptographic verifier.
**What the verifier does NOT see:** The master wallet, the cluster structure, or any link between wallets.

---

## Features (V2 — server-side verification)

- ☁️ **`verifyRemote()`** — API-gated ZK verification via IdentiFI's Edge Function
- 🎫 **AuthTicket (3rd Function)** — `authorizeTransaction()` issues a signed ticket; `verifyTicket()` / `verifyTicketLocally()` validate it
- 🧩 **System Pepper blinding** — sub-wallet addresses are masked server-side with Poseidon + secret pepper
- 🔑 **API-key metered** — usage tracking, plan quotas, and overage billing built-in
- 🦀 **Rust/WASM engine** — X-Core runs **server-side only** (zero WASM on the client)
- 🌐 **Framework-agnostic** — works in any HTTP-capable runtime (browser, Node.js, Deno, Cloudflare Workers)
- 🧹 **"The Purge"** — `sdk.purge()` clears client session state

> ⚠️ **This SDK is VERIFICATION-ONLY.** Proof generation is performed exclusively by the IdentiFI website. Third parties use this SDK only to validate proofs.
>
> ⚠️ **There is no local verification path.** V2 proofs are blinded with the secret System Pepper — they can only be verified through the IdentiFI API (`verifyRemote()`).

---

## Installation

```bash
npm install @identifi-protocol/sdk
# or
yarn add @identifi-protocol/sdk
# or
pnpm add @identifi-protocol/sdk
```

> `ethers@^6` is a peer dependency. If you already have it in your project, you're set.
> For server-side-only use (no wallet), ethers is optional.

---

## Quickstart

### 1. Browser / dApp

```typescript
import { IdentiFiSDK } from '@identifi-protocol/sdk';

const sdk = new IdentiFiSDK({
  apiKey: 'id_live_your_key_here',
  apiUrl: 'https://hcftafgwrjbuxtebrsmi.supabase.co/functions/v1',
});

// Receive a ProofPack from the IdentiFI website
const proofPack = {
  version: 1,
  masterAddress: '0x...',
  createdAt: '1700000000',
  expiresAt: '1700086400',
  entries: [{
    walletHash: '0x...', // Poseidon(sub_wallet, SYSTEM_PEPPER) — blinded
    proof: '0x...',
    root: '0x...',
    iat: '1700000000',
    exp: '1700086400',
  }],
};

// Verify via IdentiFI API — System Pepper blinding is applied server-side
const { valid, reason } = await sdk.verifyRemote(activeWallet, proofPack);
console.log(valid); // true or false
```

### 2. Server-side (Next.js API Route / Express)

```typescript
import { IdentiFiSDK } from '@identifi-protocol/sdk';
import type { ProofPack } from '@identifi-protocol/sdk';

const sdk = new IdentiFiSDK({
  apiKey: process.env.IDENTIFI_API_KEY,
  apiUrl: 'https://hcftafgwrjbuxtebrsmi.supabase.co/functions/v1',
});

// In your API route handler:
export async function POST(req: Request) {
  const { activeWallet, proofPack }: { activeWallet: string; proofPack: ProofPack } = await req.json();
  const { valid, reason } = await sdk.verifyRemote(activeWallet, proofPack);

  if (!valid) {
    return Response.json({ error: reason }, { status: 403 });
  }

  return Response.json({ authorized: true });
}
```

### 3. AuthTicket — lock the swap (active lock)

```typescript
// Client-side: validate the proof AND receive a signed ticket
const authTicket = await sdk.authorizeTransaction({
  activeWallet: userWallet,
  proofPack: userProofPack,
});

// Backend-side (DEX): validate the ticket before executing the action
const { valid, exp } = await sdk.verifyTicket(authTicket);
if (valid && exp > Date.now() / 1000) {
  await dexContract.executeSwap(authTicket);
}
```

---

## API Overview

| Method | Description |
|---|---|
| `sdk.verifyRemote(activeWallet, proofPack)` | **★ Primary.** Verify a ProofPack via the IdentiFI API (System Pepper blinding, metered). Requires `apiKey`. |
| `sdk.authorizeTransaction({ activeWallet, proofPack })` | Validate the proof AND issue an **AuthTicket** (`idf1.v1....`). Rejects with a fatal error if invalid. Requires `apiKey`. |
| `sdk.verifyTicket(ticket)` | Validate an AuthTicket via the IdentiFI API (SaaS, metered). Requires `apiKey`. |
| `sdk.verifyTicketLocally(ticket, secret?)` | Validate an AuthTicket locally with a shared `TICKET_SECRET` (self-hosted, backend-only). |
| `sdk.provider.connect()` | Connect MetaMask / injected wallet |
| `sdk.provider.setRpc(url)` | Set trusted Ethereum RPC |
| `sdk.purge()` | Clear all client session state |

Full API reference: [docs/api-reference.md](./docs/api-reference.md) · AuthTicket design: [docs/auth-ticket.md](./docs/auth-ticket.md)

---

## How It Works

```
[User on identifi.xyz]
      │
      │  Generates ProofPack via the IdentiFI website
      ▼
[ProofPack: { version, masterAddress, entries: [...] }]
      │
      │  Submitted to your dApp / API with activeWallet
      ▼
╔═══════════════════════════════════════════════════╗
║    @identifi-protocol/sdk  →  verifyRemote()               ║
║                                                    ║
║  1. POST to IdentiFI Edge Function (Supabase)      ║
║  2. Server blinds activeWallet with SYSTEM_PEPPER  ║
║     → Poseidon(activeWallet, SYSTEM_PEPPER)        ║
║  3. Lookup blinded hash in ProofPack entries       ║
║  4. Run Groth16 verifier (server-side WASM)        ║
║  5. Meter usage against API key quota              ║
║  6. Return { valid: true/false }                   ║
╚════════════════════════════════════════════════════╝
      │
      │  Returns { valid: true / false }  (or an AuthTicket via /authorize)
      ▼
   AUTHORIZED ✓  or  DENIED ✗
```

Architecture deep-dive: [docs/architecture.md](./docs/architecture.md)

---

## Examples

| Example | Description |
|---|---|
| [api-gateway.ts](./examples/api-gateway.ts) | ★ **Recommended.** Server-side verification + Express middleware using `verifyRemote()` |
| [verify-proof.ts](./examples/verify-proof.ts) | Standalone script — remote verification of a real ProofPack via `verifyRemote()` |

---

## Security

- **No private key handling** — IdentiFI never touches wallet private keys
- **No database** — fully stateless, zero persistent storage of identity data
- **No WASM on the client** — the verifying key and the Rust/WASM engine live **exclusively server-side**; the SDK is a pure HTTP client (~5 kB)
- **System Pepper blinding** — sub-wallet addresses are masked with Poseidon + secret server pepper
- **The Purge** — `sdk.purge()` clears provider/session state on logout
- **Public outputs only** — `ProofPack` contains no sensitive wallet data (all wallet hashes are Poseidon-blinded)
- **API-key gated** — only authorized integrators can verify proofs

---

## Contributing

This repository contains the SDK layer only. The Rust/WASM core source is maintained separately in [identifi-core](https://github.com/identifi-protocol/identifi-core).

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit with conventional commits: `feat:`, `fix:`, `docs:`
4. Open a PR — CI will run `tsc --noEmit` and lint checks

---

## License

MIT — see [LICENSE](./LICENSE)

---

<p align="center">
  Built with Rust, WASM, and zero compromises on privacy.<br/>
  <a href="https://identifi.xyz">identifi.xyz</a> ·
  <a href="https://twitter.com/identifi_xyz">@identifi_xyz</a> ·
  <a href="mailto:contact@identifi.xyz">contact@identifi.xyz</a>
</p>
