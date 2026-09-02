# Changelog

All notable changes to `@identifi-protocol/sdk` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)  
Versioning: [Semantic Versioning](https://semver.org/)

---

## [0.0.1-alpha.3] — 2026-09-02

### Package & Repository

- **Fixed package scope name** — changed from `@identifiskd/sdk` to `@identifi-protocol/sdk`.
- **Repository & Bugs links** — updated `package.json` repository URL and added bugs issue tracker link pointing to `IdentiFI-Protocol/identifi-sdk`.

---

## [0.0.1-alpha.2] — 2026-08-06

### Breaking — V2 Purge (removal of the V1 local engine)

- **Removed `WasmEngine`** — no more client-side WASM loading, `fs/promises` file
  resolution, `BUNDLED_VERIFYING_KEY`, or `fetchTextAsset`/`resolveAsset` helpers.
  All cryptography now runs server-side via the IdentiFI API.
- **Removed deprecated methods** — `init()`, `verify()`, `verifyFromProofPack()`
  and the `status` / `isReady` getters.
- **Removed config fields and types** — `wasmUrl`, `verifyingKeyUrl` from
  `SDKConfig`; `ProofEnvelope`, `EngineStatus` and `WasmEngineOptions` types.
- **Package slimming** — `wasm/` and `keys/` no longer shipped in the npm tarball;
  the `./engine` subpath export is gone. The client bundle dropped from ~32 kB to ~5 kB.
- **`identifi-swap`** — now pins `@identifiskd/sdk@0.0.1-alpha.2`.

---

## [0.0.1-alpha.1] — 2026-08-03

### Build & Packaging

- **Dual ESM + CJS output** — `tsup` now emits `index.js` (ESM), `index.cjs` (CJS) and `.d.ts`/`.d.cts` types
- **`publishConfig` added** — `access: public`, `tag: alpha` for scoped public publishing
- **`LICENSE` (MIT) added** — previously declared in `package.json` but missing from the repo
- **`.gitignore` added** — `node_modules`, `dist`, env and editor files
- **`wasm/` binary now ships** — removed the folder-level `.gitignore` (`*`) that was silently excluding `identifi_core_bg.wasm` from `npm pack`

### Documentation

- All source, test and doc comments normalized to English


### Security — BREAKING

- **Proving key removed from SDK** — `keys/proving_key.hex` is no longer bundled.
  Proof generation now requires an authorized endpoint.
- **New config fields**: `SDKConfig` and `WasmEngineOptions` now accept `provingAuthToken`
  and `provingApiUrl` for authenticated proving key retrieval.
- **`WasmEngine._getProvingKey()`** throws a descriptive error if neither `provingKeyUrl`
  nor `provingApiUrl` is configured.
- **Removed `WasmEngine._defaultProvingKeyUrl()`** — no bundled fallback path.
- **New Edge Function**: `proving-key` — serves the proving key to authenticated
  wallet sessions via Supabase Edge Runtime.
- **`verify()` and `verifyRemote()` unaffected** — these use the public verifying key
  which remains bundled.
- **`useWasmEngine` hook updated** — proving key now set via `setProvingKeyHex()` state
  instead of local file fetch.

## [1.0.0] — 2026-06-23

### Added
- Initial release of `@identifi/sdk`
- `IdentiFiSDK` facade class with full TypeScript typings
- `WasmEngine` singleton — framework-agnostic X-Core WASM loader
  - CDN URL and local file path support (browser + Node.js >= 18)
  - Singleton pattern with idempotent `init()`
  - Groth16 proof generation (`generateProof`)
  - Groth16 proof verification (`verifyProof`)
  - Poseidon commitment root computation (`computeCommitmentRoot`)
  - "The Purge" — WASM linear memory zero-fill + cache clearing
- `EthProvider` — SSR-safe Ethereum wallet wrapper
  - No `window.ethereum` access in constructor
  - Lazy wallet binding via `connect()`
  - Trusted RPC URL support (Infura/Alchemy/QuickNode)
  - Exponential backoff retry on RPC failures
  - `onAccountsChanged` event listener
- `IdentiFiSDK.proveCluster()` — high-level proof generation
- `IdentiFiSDK.verify()` — local offline verification
- `IdentiFiSDK.verifyRemote()` — API-gated metered verification
- Convenience vault — `saveToVault()`, `loadFromVault()`, `clearVault()`
- Shield utilities — `shield()`, `unshield()`, `serializeEnvelope()`, `deserializeEnvelope()`
- Bundled WASM binary (`wasm/identifi_core_bg.wasm` — X-Core v1.0, Arkworks Groth16)
- Bundled cryptographic keys (`keys/proving_key.hex`, `keys/verifying_key.hex`)
- Examples: `basic-proof.ts`, `dapp-integration.ts`, `api-gateway.ts`
- Documentation: `architecture.md`, `api-reference.md`, `monetization.md`
- `tsup` build configuration with ethers externalized
- Subpath exports: `@identifi/sdk`, `@identifi/sdk/engine`, `@identifi/sdk/provider`, `@identifi/sdk/utils`

### Engine
- X-Core WASM v1.0 — Groth16 over BN254 (Arkworks)
- Poseidon hash function (SNARK-friendly, native Rust implementation)
- Zeroize: all private inputs overwritten post-proof via Rust `zeroize` crate
