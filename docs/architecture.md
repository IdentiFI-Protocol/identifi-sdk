# IdentiFI Protocol — SDK Architecture

## System Overview

The IdentiFI SDK is a **API-gated ZK-SNARK verification client** for wallet cluster ownership proofs. All cryptographic operations execute **server-side** inside a Supabase Edge Function running Rust/WASM.

The SDK itself is a thin HTTP client that sends the `activeWallet` + `ProofPack` to the IdentiFI API. No WASM loading, no local verification.

**Proof generation is NOT performed by this SDK.** It is performed exclusively by the IdentiFI website. This SDK only triggers remote verification.

```
┌──────────────────────────────────────────────────────────────────────┐
│                          INTEGRATING dAPP                            │
│                                                                      │
│    const { valid } = await sdk.verifyRemote(activeWallet, proofPack);│
│                               │                                      │
└───────────────────────────────┼──────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    @identifi-protocol/sdk  (TypeScript)                 │
│                                                                      │
│   IdentiFiSDK (API Client Facade)                                    │
│     ├── HTTP POST to Supabase Edge Function                          │
│     └── EthProvider (SSR-safe wallet abstraction)                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│              IdentiFI API — Supabase Edge Function                   │
│                                                                      │
│  1. Validate API key + check quota                                   │
│  2. Blind wallet: Poseidon(activeWallet, SYSTEM_PEPPER)              │
│  3. Lookup blinded hash in ProofPack entries                         │
│  4. Run Groth16 Verifier (Rust WASM — ark-groth16 + ark-bn254)       │
│  5. Meter usage → return { valid, plan }                             │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Cryptographic Stack

| Component | Library | Purpose |
|---|---|---|
| Proof System | `ark-groth16` | Groth16 SNARK verifier |
| Elliptic Curve | `ark-bn254` | BN254 pairing-friendly curve |
| Hash Function | Poseidon (native) | SNARK-friendly commitment + System Pepper blinding |
| WASM Binding | `wasm-bindgen` | Rust ↔ JavaScript bridge (server-side) |
| Memory Safety | `zeroize` | Overwrite sensitive data post-use |

## Verification Flow (verifyRemote)

```
CLIENT (SDK):
  activeWallet  ← wallet address executing the operation
  proofPack     ← ProofPack downloaded from identifi.xyz

API (Edge Function):
  1. Validate API key → check quota
  2. Blind wallet: blinded = Poseidon(activeWallet, SYSTEM_PEPPER)
  3. Lookup: find entry in proofPack where entry.walletHash === blinded
  4. Verify: client_verify_proof(entry.proof, entry.root, iat, exp, blinded, verifyingKey)
  5. Meter: increment API key usage counter
  6. Return: { valid: true/false, plan: { usage, limit } }

OUTPUT:
  { valid: true }                   ← proof accepted
  { valid: false, reason: ... }     ← proof rejected
```

## AuthTicket Flow (authorizeTransaction — 3rd Function)

```
CLIENT (SDK):
  authorizeTransaction({ activeWallet, proofPack })

API (Edge Function /authorize):
  1. Same blinding + lookup + Groth16 verification as /verify
  2. Temporal lock inside Rust: now > exp → ERR_PROOF_EXPIRED (fatal)
  3. Forge AuthTicket: idf1.v1.<wallet>.<root>.<exp>.<iat>.<checkedAt>.<nonce>.<sig>
     (HMAC-SHA256 with the server-side TICKET_SECRET — never in the client)
  4. Return: { valid: true, ticket, exp, checked_at }

DEX validation:
  verifyTicket() (SaaS, metered)  or  verifyTicketLocally() (self-hosted, shared secret)
```

Full design: [auth-ticket.md](./auth-ticket.md)

## Security Principles

### 1. System Pepper Blinding
Every wallet address in the ProofPack is hashed with `Poseidon(wallet, SYSTEM_PEPPER)` where `SYSTEM_PEPPER` is a 32-byte secret known only to the IdentiFI server. Without this secret, no third party can:
- Reverse the hash to discover wallet addresses
- Verify proofs independently (only IdentiFI's API can)
- Perform dictionary attacks on the ProofPack

### 2. No WASM on the Client
The proving key (64MB+) and WASM engine live **exclusively on the server**. The SDK never loads or instantiates WASM — it's a lightweight HTTP client.

### 3. API-Key Metering
Every `verifyRemote()` call counts against the developer's plan quota. The Edge Function enforces:
- Monthly usage limits per plan tier
- Rate limiting per API key
- Overage billing via Stripe Meter Events

### 4. The Purge (Client-side)
When `sdk.purge()` is called, all local session state is cleared.

## Layer Map

```
identifi-sdk/
├── src/                   TypeScript SDK
│   ├── IdentiFiSDK.ts     API client facade — start here (verifyRemote + AuthTicket)
│   ├── engine/
│   │   ├── ticket.ts      AuthTicket parse + local HMAC validation (self-hosted)
│   │   └── types.ts       All public interfaces
│   └── provider/
│       └── EthProvider.ts Ethereum wallet abstraction
├── examples/              Reference integration examples
└── tests/                 Unit + remote integration tests
```

> The `wasm/` and `keys/` folders exist in the repo only as server-side build
> artifacts — they are **not** shipped in the npm package.
