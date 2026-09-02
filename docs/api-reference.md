# IdentiFI SDK — API Reference (V2)

## `IdentiFiSDK`

The main class. Import it and you have everything you need.

```typescript
import { IdentiFiSDK } from '@identifi-protocol/sdk';
```

---

### Constructor

```typescript
new IdentiFiSDK(config?: SDKConfig)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config.apiKey` | `string` | — | ★ **Required.** Your IdentiFI API key (`id_live_xxx`) |
| `config.apiUrl` | `string` | `https://api.identifi.xyz/v1` | API base URL (override for self-hosted) |
| `config.rpcUrl` | `string` | — | Trusted Ethereum RPC URL |
| `config.ticketSecret` | `string` | — | Shared `TICKET_SECRET` for `verifyTicketLocally()` (self-hosted, backend-only) |

> 🎯 **You only need `apiKey` (+ `apiUrl` for self-hosted).** WASM, verifying key and
> the System Pepper live entirely server-side — there is nothing to configure on the client.

---

### Lifecycle

#### `sdk.purge(): void`
Clears all client session state (EthProvider signer, RPC cache, listeners).
Call when the user logs out or session ends.

---

### Proof Verification

#### ★ `sdk.verifyRemote(activeWallet: string, proofPack: ProofPack): Promise<VerifyResult>`

**The only verification method for V2 proofs.**

Sends the `activeWallet` + `ProofPack` to the IdentiFI API (Supabase Edge Function), which:
1. Blinds the wallet with `Poseidon(activeWallet, SYSTEM_PEPPER)`
2. Looks up the matching entry in the ProofPack by blinded hash
3. Runs the Groth16 ZK verifier server-side (WASM)
4. Meters usage against the API key's plan quota
5. Returns `{ valid: true/false }`

```typescript
const { valid, reason } = await sdk.verifyRemote(
  '0xYourActiveWallet',
  proofPack
);
```

**Returns:** `VerifyResult`

```typescript
interface VerifyResult {
  valid: boolean;
  reason?: string; // Defined only when valid === false
}
```

**Error contract (Public Auditor semantics):** throws if `apiKey` is missing; otherwise it never throws — network failures and invalid input resolve as `{ valid: false, reason }`. This is the "audit" verb (soft boolean, like the website's verifier). Use `authorizeTransaction()` when you need a **fatal** error that aborts the click.

---

### AuthTicket — the SDK's active lock (3rd Function)

#### ★ `sdk.authorizeTransaction(params: { activeWallet: string; proofPack: ProofPack }): Promise<AuthTicket>`

Validates the proof **and** issues a signed AuthTicket. There is no "swallowable"
`false` return — it **resolves** with the ticket or **rejects** with a fatal error
that kills the dApp's click before it reaches the network.

```typescript
const authTicket = await sdk.authorizeTransaction({
  activeWallet: userWallet,
  proofPack: userProofPack,
});
// → 'idf1.v1.<wallet>.<root>.<exp>.<iat>.<checkedAt>.<nonce>.<sig>'
```

**Throws** on failure with the error code: `ERR_PROOF_EXPIRED`, `ERR_PROOF_NOT_YET_VALID`,
`ERR_INVALID_ZK_PROOF`, `ERR_DESERIALIZE_PROOF`, `ERR_DESERIALIZE_VK`, ...

#### ★ `sdk.verifyTicket(ticket: AuthTicket): Promise<TicketVerification>`

Validates an AuthTicket via the IdentiFI API (SaaS, metered). The DEX backend calls
this before executing the action. Requires `apiKey`.

```typescript
const { valid, activeWallet, exp } = await sdk.verifyTicket(authTicket);
if (valid && exp > Date.now() / 1000) {
  await dexContract.executeSwap(authTicket);
}
```

#### `sdk.verifyTicketLocally(ticket: AuthTicket, secretHex?: string): Promise<TicketVerification>`

Validates an AuthTicket locally (self-hosted). Uses `SDKConfig.ticketSecret` unless a
`secretHex` is passed explicitly.

> ⚠️ **SECURITY:** never run this in the end user's browser — the secret would be
> extractable. It belongs in the operator's backend (same trust boundary as `SYSTEM_PEPPER`).

**Returns:** `TicketVerification`

```typescript
interface TicketVerification {
  valid: boolean;
  activeWallet?: string; // present when valid
  exp?: number;          // present when valid
  error?: string;        // present when invalid
}
```

---

### Provider Access

#### `sdk.provider: EthProvider`
Access the underlying `EthProvider` for wallet operations.

```typescript
const address = await sdk.provider.connect();
await sdk.provider.setRpc('https://mainnet.infura.io/v3/...');
const ts = await sdk.provider.getBlockTimestamp();
const net = await sdk.provider.getNetworkInfo();
```

---

## `EthProvider` (Advanced)

```typescript
import { EthProvider } from '@identifi-protocol/sdk/provider';

const provider = new EthProvider({ rpcUrl: 'https://...' });
await provider.connect();
```

Methods: `connect()`, `getSigner()`, `setRpc(url)`, `getRpcUrl()`, `getBlockTimestamp()`, `getNetworkInfo()`, `onAccountsChanged(cb)`, `reset()`

---

## Error Handling

All SDK methods throw descriptive errors prefixed with `[IdentiFI]`. Wrap in try/catch:

```typescript
try {
  const { valid } = await sdk.verifyRemote(activeWallet, proofPack);
} catch (err) {
  // err.message: '[IdentiFI] ...'
  console.error(err.message);
}
```

Common errors:
- `[IdentiFI] verifyRemote() requires an apiKey` — add `apiKey` to config
- `[IdentiFI] authorization failed: ERR_PROOF_EXPIRED` — proof expired (AuthTicket flow)
- `[IdentiFI] authorization failed: ERR_INVALID_ZK_PROOF` — wallet doesn't match the pack
- `[IdentiFI] Invalid or inactive API key` — check your key at dashboard.identifi.xyz
- `[IdentiFI] Monthly quota exceeded` — upgrade your plan
- `[IdentiFI] Network error` — connectivity issue with the API
