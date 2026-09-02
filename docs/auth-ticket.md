# 🎫 IdentiFI Protocol — AuthTicket: The SDK's 3rd Function (Design)

> **Status:** Design proposal — v0.2 (incorporates engineering recommendation from Leo: `Zeroizing`)
> **Scope:** Architecture document. No code was changed.
> **Conceptual decision (closed with Leo):** The **Public Auditor** (`client_verify_proof`)
> remains untouched for the site's audit page (pure transparency, `true`/`false`).
> The **3rd function** (`client_verify_and_forge_ticket`) is exclusive to the SDK: it verifies AND
> issues a **signed AuthTicket** that locks/unlocks the user's action in third-party apps.

---

## 1. Context & Motivation (the V2 gap)

In V1, the security secret was `forge_hook_data` — it was not a passive validator,
it was the *factory* that stamped the output payload. Without its output, the transaction was unviable.

In the ZK migration (Groth16/Poseidon), we were left with only:

| Function | Role | Limitation |
|---|---|---|
| `client_generate_proof` | Generator (Prover) | Only creates the proof |
| `client_verify_proof` | Auditor (Verifier) | Only returns `Ok(bool)` |

**The 3 identified gaps:**
1. **No temporal lock in Rust** — `client_verify_proof` does not receive `current_timestamp`;
   what blocks expiration today is the JS/Deno layer, which can be bypassed.
2. **Soft boolean return** — `Ok(false)` instead of a fatal error; a dApp can "swallow" the `false`.
3. **No ticket issuance** — nothing stamps "this wallet was authorized at this instant until exp Y".

---

## 2. Conceptual Separation (why keep both functions)

```
┌──────────────────────────────────────────────────────────────┐
│                     IdentiFI Rust Engine                     │
└──────────────┬────────────────────────────────┬──────────────┘
               │                                │
               ▼                                ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│    client_verify_proof      │  │ client_verify_and_forge_ti… │
│    (Public Auditor/Web)     │  │       (SDK/Automatic)       │
├─────────────────────────────┤  ├─────────────────────────────┤
│ • Use: Website page         │  │ • Use: dApps / DEXs / APIs  │
│ • Returns: `true` / `false` │  │ • Returns: AuthTicket or    │
│ • Role: Pure query and      │  │   Fatal Error (Abort)       │
│   public transparency       │  │ • Role: Active lock         │
│ • Signature: UNCHANGED      │  │ • Signature: NEW            │
└─────────────────────────────┘  └─────────────────────────────┘
```

- **Public Auditor (page):** the user pastes the ProofPack and sees the
  **Green/Red** indicator of the ZK math. `client_verify_proof` continues to exist
  **exactly as it is** — no current interface breaks.
- **Automatic SDK:** the dApp/DEX integrates the SDK and receives an **execution guarantee**,
  not a passive query. If it passes → signed AuthTicket; if it fails/expires →
  fatal error that **aborts the click** before reaching the network or the partner's backend.

---

## 3. Architecture Decisions (the choices that harden the design)

### 3.1 ⚠️ SECURITY FIX — the key NEVER lives in the client WASM

Leo's original proposal passed `validator_private_key_hex` to the WASM **on the client**.
That would reintroduce exactly the V1 vulnerability (extraction of the constant `K` via
memory dump/reverse engineering of the `.wasm`). If the stamping key is in the binary or
in the browser's linear memory, **anyone can forge tickets** and the lock dies.

**Non-negotiable rule:** the signing secret lives **only on the server**
(Edge Function, env var, `SYSTEM_PEPPER` pattern). The WASM may *receive* the secret as a
parameter **at runtime, on the server side** — never embedded in the binary, never in the SDK,
never in the browser. After use, the memory is zeroed (the project's `zeroize` principle,
via `Zeroizing` — see sketch 4.3).

### 3.2 Signature scheme: HMAC-SHA256 (V2) — ECDSA/k256 (roadmap)

| Criterion | HMAC-SHA256 (recommended for V2) | ECDSA/k256 (future) |
|---|---|---|
| Symmetric | ✅ same secret to sign and verify | — |
| Where it validates | `/verify-ticket` (SaaS) or shared secret (self-hosted) | public key (can be public) |
| Rust deps | `hmac` + `sha2` (small, pure Rust) | `k256` (larger) |
| Public/on-chain verification | ❌ | ✅ |
| Use case | V2: IdentiFI is the trusted authority | When you want to validate tickets without calling the API |

**HMAC-SHA256 solves V2:** the DEX validates the ticket by calling `/verify-ticket`
(metered, the secret never leaves IdentiFI) or, in self-hosted mode, with the shared
secret configured by the DEX operator.

**Secret engineering rules:**
1. `TICKET_SECRET` must be **≤ 64 bytes** — the `Mac::new_from_slice` of the `hmac`
   crate fails with `InvalidLength` for keys larger than the block size. Above that,
   pre-hash with SHA-256 before the HMAC.
2. **Avoid a single global secret:** if every DEX validates with the same
   `TICKET_SECRET`, leaking one key forges tickets for *all* of them. Derive a
   per-DEX key (`HKDF-SHA256(TICKET_SECRET, developerId)`) and document rotation.

---

## 4. Rust Function Design (identifi-core)

### 4.1 Proposed signature

```rust
#[wasm_bindgen]
pub fn client_verify_and_forge_ticket(
    proof_hex: &str,
    root_hex: &str,
    iat: u64,
    exp: u64,
    current_timestamp: u64,      // 👈 NEW — temporal lock in Rust
    active_wallet: &str,
    verifying_key_hex: &str,
    validator_secret_hex: &str,  // 👈 HMAC secret — SERVER-ONLY (env var)
) -> Result<String, JsValue>
```

- **Returns** `Result<String, JsValue>`: `Ok(ticket)` or a **fatal error** (`Err`).
- **`client_verify_proof` remains 100% untouched** — the page's verdict does not change.
- **New internal refactor:** extract a private helper `verify_groth16(...)` (the Groth16
  math currently embedded in `client_verify_proof`) used by both functions, eliminating
  duplication **without changing the existing public signature/API**. `verify_groth16`
  **does not exist yet** — it is part of this implementation.

> ⚠️ **Execution model (V1 vs V2) — read before coding:**
> - **V2 proofs (blinded with SYSTEM_PEPPER):** ticket forging happens
>   **mandatorily on the Edge Function** (`/authorize`). The SDK is a thin HTTP client
>   (like `verifyRemote`) — it does NOT run the WASM function locally, because the SDK
>   does not know the pepper. Never call `client_verify_and_forge_ticket` in the browser
>   with a real secret.
> - **V1 proofs (legacy):** the same WASM function can be called locally — but the
>   secret only makes sense if it belongs to the operator (self-hosted), never embedded.

### 4.2 Internal flow (diagram)

```
[ proof + root + iat + exp + current_timestamp + active_wallet + vk + secret ]
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │  1. TEMPORAL LOCK       │
                       │  now > exp  → ERR_PROOF_EXPIRED      (fatal Err)
                       │  now < iat  → ERR_PROOF_NOT_YET_VALID (fatal Err)
                       └────────────┬────────────┘
                                    ▼
                       ┌─────────────────────────┐
                       │  2. GROTH16 VERIFICATION│  (same math as the Auditor)
                       │  invalid    → ERR_INVALID_ZK_PROOF (fatal Err)
                       └────────────┬────────────┘
                                    ▼
                       ┌─────────────────────────┐
                       │  3. TICKET FORGING      │
                       │  nonce = getrandom(16)  │
                       │  payload = idf1.v1.{wallet}.{root}.{exp}.{iat}.{checkedAt}.{nonce}
                       │  sig = HMAC_SHA256(secret, payload)
                       │  secret = Zeroizing::new(bytes)  → automatic zeroize on drop
                       └────────────┬────────────┘
                                    ▼
                              Ok(payload.sig)
```

### 4.3 Implementation sketch

```rust
use hmac::{Hmac, Mac};
use sha2::Sha256;
use zeroize::{Zeroize, Zeroizing};

type HmacSha256 = Hmac<Sha256>;

#[wasm_bindgen]
pub fn client_verify_and_forge_ticket(
    proof_hex: &str,
    root_hex: &str,
    iat: u64,
    exp: u64,
    current_timestamp: u64,
    active_wallet: &str,
    verifying_key_hex: &str,
    validator_secret_hex: &str,
) -> Result<String, JsValue> {
    // ── 1. TEMPORAL LOCK (now inside Rust — cannot be bypassed) ──
    if current_timestamp > exp {
        return Err(JsValue::from_str("ERR_PROOF_EXPIRED"));
    }
    if current_timestamp < iat {
        return Err(JsValue::from_str("ERR_PROOF_NOT_YET_VALID"));
    }

    // ── 2. Groth16 verification (same math as the Auditor) ──────────────
    let is_valid = verify_groth16(proof_hex, root_hex, iat, exp, active_wallet, verifying_key_hex)?;
    if !is_valid {
        return Err(JsValue::from_str("ERR_INVALID_ZK_PROOF"));
    }

    // ── 3. TICKET FORGING ────────────────────────────────────────────────
    let mut nonce = [0u8; 16];
    getrandom::getrandom(&mut nonce).map_err(|_| JsValue::from_str("ERR_ENTROPY_FAILED"))?;
    let nonce_hex = hex::encode(nonce);
    nonce.zeroize();

    let payload = format!(
        "idf1.v1.{}.{}.{}.{}.{}.{}",
        active_wallet.to_lowercase(),
        root_hex.trim_start_matches("0x").to_lowercase(),
        exp, iat, current_timestamp, nonce_hex
    );

    // HMAC — secret comes from the server via env var. Zeroizing<Vec<u8>> guarantees
    // AUTOMATIC zeroization of the buffer on the heap when it goes out of scope (drop),
    // without manual mutability and without an exposure window between use and cleanup.
    // NOTE: the original &str is owned by wasm-bindgen (linear memory managed by the
    // JS glue) — the protected copy covers the buffer used in the HMAC; since forging
    // runs in the isolated Deno of the Edge Function, the residual risk is practically
    // nil (local browser calls are avoided by design — see "Execution model").
    let secret = Zeroizing::new(validator_secret_hex.as_bytes().to_vec());
    let mut mac = HmacSha256::new_from_slice(secret.as_slice())
        .map_err(|_| JsValue::from_str("ERR_HMAC_KEY"))?; // fails for key > 64 bytes
    mac.update(payload.as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());

    Ok(format!("{}.{}", payload, sig))
}
```

> **V2 note (blinded):** in the Edge Function flow, the `active_wallet` passed to Rust is the
> **blinded hash** `Poseidon(wallet, SYSTEM_PEPPER)` — exactly like the current `/verify`.
> The SDK never needs to know the pepper.

---

## 5. AuthTicket Format

```
idf1.v1.<activeWallet>.<root>.<exp>.<iat>.<checkedAt>.<nonce>.<sig>
```

| Field | Description |
|---|---|
| `idf1` | Protocol marker |
| `v1` | Ticket version |
| `activeWallet` | Wallet executing the action (hex, lowercase) |
| `root` | Proof commitment root (hex, without `0x`) |
| `exp` / `iat` | Unix timestamps of the proof |
| `checkedAt` | Unix verification timestamp (instant stamp) |
| `nonce` | 16 random bytes (hex) — anti-replay/uniqueness |
| `sig` | HMAC-SHA256 hex over the payload |

**Canonical normalization (mandatory on both sides):** lowercase on all
hex (`wallet`, `root` without `0x`) — any divergence between `/authorize` and
`/verify-ticket` in the HMAC recomputation silently breaks the ticket.

**Validation rules on the verifying end (DEX/backend):**
1. Parse and HMAC recomputation (shared secret) **or** a call to `/verify-ticket`.
2. `checkedAt` within the skew window (e.g. ±120s).
3. `now <= exp` — the ticket dies with the proof.
4. `activeWallet` of the ticket == the wallet initiating the action.

> ⚠️ **About replay (threat model honesty):** the `nonce` does **not** prevent replay
> by itself — for that, the verifier would need to keep a registry of consumed nonces,
> which conflicts with the protocol's *stateless* principle. In practice,
> replay is limited by `exp` + the skew window. If the DEX needs strict single-use,
> the nonce registry lives on its backend (outside the stateless core).

---

## 6. Edge Function (Supabase)

### 6.1 New endpoint `POST /authorize` (issuance)

Flow (reuses 90% of the current `/verify`):
1. Validates the API key + quota (existing code).
2. Blind: `blinded = Poseidon(activeWallet, SYSTEM_PEPPER)` → lookup in the ProofPack.
3. Calls `client_verify_and_forge_ticket` (WASM) with `current_timestamp = Date.now()/1000`
   and `validator_secret = env TICKET_SECRET` (≤ 64 bytes; per-DEX derived via
   HKDF when there are multiple DEXs — see section 3.2).
4. Returns:
   - `200 { valid: true, ticket: "idf1.v1....", exp, checked_at }`
   - `400 { valid: false, error: "ERR_PROOF_EXPIRED" | "ERR_INVALID_ZK_PROOF" | ... }`

### 6.2 New endpoint `POST /verify-ticket` (DEX validation)

1. Receives `{ ticket }` + the DEX's API key (metered).
2. Canonical normalization identical to `/authorize` (lowercase, strip `0x`) —
   any divergence in the HMAC recomputation invalidates the ticket.
3. Recomputes the HMAC with `TICKET_SECRET`; validates skew, `exp` and integrity.
4. Returns `{ valid: true, activeWallet, exp }` or `{ valid: false, error }`.

> Self-hosted alternative: the DEX configures the shared `TICKET_SECRET` on its own backend
> and validates locally without calling the API (`verifyTicketLocally` method in the SDK).

---

## 7. SDK (TypeScript — the public interface of the 3rd function)

```typescript
// ★ NEW — the SDK's 3rd function: verifies AND issues the ticket (active lock)
// Implementation: HTTP POST to {apiUrl}/authorize (same as verifyRemote).
// Does NOT run WASM locally — in V2 the forging lives on the Edge Function (SYSTEM_PEPPER).
const authTicket = await sdk.authorizeTransaction({
  activeWallet: userWallet,   // wallet connected in the dApp
  proofPack: userProofPack,   // ProofPack downloaded from the site
});
// Resolves → AuthTicket string. Rejects → ERR_PROOF_EXPIRED / ERR_INVALID_ZK_PROOF

// ★ NEW — validation on the DEX backend (SaaS, metered)
const { valid, exp } = await sdk.verifyTicket(authTicket);
if (valid && exp > Date.now() / 1000) {
  await dexContract.executeSwap(authTicket);
}
```

**Error contract (fatal — kill the button click):**

| Code | Meaning |
|---|---|
| `ERR_PROOF_EXPIRED` | `current_timestamp > exp` — proof/ticket expired |
| `ERR_PROOF_NOT_YET_VALID` | `current_timestamp < iat` — clock skew |
| `ERR_INVALID_ZK_PROOF` | Groth16 math rejected the proof |
| `ERR_DESERIALIZE_PROOF` / `ERR_DESERIALIZE_VK` | Corrupted input |
| `ERR_HMAC_KEY` / `ERR_ENTROPY_FAILED` | Internal forging failure |

### dApp flow (no popup, 1 click)

```typescript
async function handleSwapClick() {
  try {
    const authTicket = await sdk.authorizeTransaction({
      activeWallet: userWallet,
      proofPack: userProofPack,
    });
    await dexContract.executeSwap(authTicket);   // backend validates the ticket
  } catch (error) {
    alert("IdentiFI validation failed: " + error.message);  // dead click
  }
}
```

---

## 8. Implementation Impact (when we code it)

| File | Change |
|---|---|
| `identifi-core/Cargo.toml` | + `hmac = "0.12"`, `sha2 = "0.10"` |
| `identifi-core/src/verifier.rs` | New `client_verify_and_forge_ticket` + `verify_groth16` helper (internal refactor; `client_verify_proof` untouched) |
| `supabase/functions/authorize/index.ts` | New issuance endpoint |
| `supabase/functions/verify-ticket/index.ts` | New validation endpoint |
| `identifi-sdk/src/IdentiFiSDK.ts` | + `authorizeTransaction()`, `verifyTicket()`, `verifyTicketLocally()` |
| `identifi-sdk/src/engine/types.ts` | + `AuthTicket`, `AuthorizeResult`, `TicketVerification` types |
| `identifi-sdk/src/index.ts` | Re-export of the new types |
| Build | `wasm-pack build` → update `pkg/` (edge + frontend) and the SDK `dist/` |
| Tests | `identifi-sdk/tests/remote.test.ts` + Rust unit tests (`rlib` already enabled) |

**Callers affected by the NEW function:** none existing — it is additive.
`client_verify_proof` does not change its signature → zero contract breakage.

**Required tests before shipping:**
1. `/authorize` with a valid proof → `200` + ticket with recomputable `sig`.
2. `/authorize` with an expired proof (`now > exp`) → `400 ERR_PROOF_EXPIRED`.
3. `/authorize` with a wallet that does not match the pack → `400 ERR_INVALID_ZK_PROOF`.
4. `/verify-ticket` with a tampered ticket (any field) → `valid: false`.
5. `/verify-ticket` with a valid ticket but outside the skew window → `valid: false`.

---

## 9. Threat Model (summary)

| Threat | Mitigation |
|---|---|
| Key extraction from client WASM | Secret only on the server (env var), never in the binary/SDK |
| dApp ignores the `false` return | There is no `false` — there is a fatal `Err` + a ticket required to proceed |
| Expired proof passes the check | Temporal lock inside Rust + `exp` in the ticket itself |
| Ticket replay | Limited by `exp` + skew window (`checkedAt`). `nonce` guarantees uniqueness, not single-use — for strict single-use, a nonce registry on the DEX backend |
| Memory dump | `Zeroizing::new(bytes)` — automatic heap zeroization on drop (THE PURGE principle); forging restricted to the isolated Deno of the Edge Function |

---

## 10. Roadmap

1. **V2 (now):** complete implementation (Rust + `/authorize` + `/verify-ticket` + SDK).
2. **V2.1:** `verifyTicketLocally` for self-hosted (shared secret).
3. **V3 (optional):** swap HMAC for **ECDSA/k256** on the server — ticket verifiable
   with a public key (preparation for on-chain validation without depending on the API on every swap).
