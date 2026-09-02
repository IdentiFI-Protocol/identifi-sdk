/**
 * IdentiFI Protocol SDK — Ethereum Provider Wrapper
 *
 * SSR-safe wrapper around ethers.js BrowserProvider / JsonRpcProvider.
 *
 * Design principles:
 *  - NO `window` access in the constructor (safe for Next.js, Node.js, Workers)
 *  - Lazy binding: window.ethereum is accessed only when `connect()` is called
 *  - Supports injected wallets (MetaMask) AND headless RPC (Infura/Alchemy)
 *  - Exponential backoff on RPC failures
 *
 * @module @identifi-protocol/sdk/provider
 */

import { ethers } from 'ethers';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EthProviderOptions {
  /** Trusted RPC URL for server-side or headless environments (no wallet). */
  rpcUrl?: string;
}

export interface NetworkInfo {
  name: string;
  chainId: bigint;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 200
): Promise<T> {
  let attempt = 0;
  while (attempt < attempts) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= attempts) throw err;
      const jitter = Math.floor(Math.random() * 100);
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      console.warn(`[IdentiFI] EthProvider: retry ${attempt}/${attempts} in ${delay}ms`, err);
      await sleep(delay);
    }
  }
  throw new Error('[IdentiFI] EthProvider: max retries exhausted');
}

// ─── EthProvider ──────────────────────────────────────────────────────────────

export class EthProvider {
  private _browserProvider: ethers.BrowserProvider | null = null;
  private _rpcProvider: ethers.JsonRpcProvider | null = null;
  private _signer: ethers.Signer | null = null;
  private _accountsChangedCallbacks: Array<(accounts: string[]) => void> = [];
  private _listenerRegistered = false;
  private _rpcUrl: string | null = null;

  constructor(options: EthProviderOptions = {}) {
    // Store RPC config — but do NOT touch window here (SSR safe)
    if (options.rpcUrl) {
      this._rpcUrl = options.rpcUrl;
      this._rpcProvider = new ethers.JsonRpcProvider(options.rpcUrl);
    }
  }

  // ── RPC Configuration ──────────────────────────────────────────────────

  /**
   * Configure or change the trusted RPC URL at runtime.
   * @param url - Full Infura/Alchemy/QuickNode URL (https://)
   */
  setRpc(url: string): void {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('[IdentiFI] EthProvider: Invalid RPC URL — must start with http(s)://');
    }
    this._rpcUrl = url;
    this._rpcProvider = new ethers.JsonRpcProvider(url);
    // Persist for session restoration
    try { localStorage?.setItem('identifi_rpc', url); } catch {}
  }

  getRpcUrl(): string | null {
    if (this._rpcUrl) return this._rpcUrl;
    try { return localStorage?.getItem('identifi_rpc') ?? null; } catch { return null; }
  }

  // ── Wallet Connection ──────────────────────────────────────────────────

  /**
   * Returns the BrowserProvider bound to window.ethereum.
   * Safe to call only in browser environments.
   * @throws In Node.js / SSR if no window.ethereum is present.
   */
  getBrowserProvider(): ethers.BrowserProvider | null {
    if (typeof window === 'undefined') {
      console.warn('[IdentiFI] EthProvider: getBrowserProvider() called in non-browser environment');
      return null;
    }
    const eth = (window as any).ethereum;
    if (!eth) return null;
    if (!this._browserProvider) {
      this._browserProvider = new ethers.BrowserProvider(eth);
    }
    return this._browserProvider;
  }

  /**
   * Prompts the user to connect their wallet and caches the signer.
   * @returns Connected wallet address, or null if unavailable.
   */
  async connect(): Promise<string | null> {
    const provider = this.getBrowserProvider();
    if (!provider) return null;
    try {
      await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
      this._signer = await provider.getSigner();
      return await this._signer.getAddress();
    } catch (err) {
      console.error('[IdentiFI] EthProvider: connect() failed:', err);
      return null;
    }
  }

  /**
   * Returns the cached signer (after connect()) or attempts to get one.
   */
  async getSigner(): Promise<ethers.Signer | null> {
    if (this._signer) return this._signer;
    const provider = this.getBrowserProvider();
    if (!provider) return null;
    try {
      this._signer = await provider.getSigner();
      return this._signer;
    } catch {
      return null;
    }
  }

  /**
   * Listen for account changes (wallet switches, disconnects).
   */
  onAccountsChanged(callback: (accounts: string[]) => void): void {
    this._accountsChangedCallbacks.push(callback);
    if (!this._listenerRegistered && typeof window !== 'undefined') {
      const eth = (window as any).ethereum;
      if (eth) {
        eth.on('accountsChanged', (accounts: string[]) => {
          this._signer = null; // Invalidate stale signer
          this._accountsChangedCallbacks.forEach((cb) => cb(accounts));
        });
        this._listenerRegistered = true;
      }
    }
  }

  // ── Blockchain Queries ─────────────────────────────────────────────────

  /**
   * Returns a reliable block timestamp.
   * Priority: configured RPC → wallet provider → Date.now() fallback.
   */
  async getBlockTimestamp(): Promise<number> {
    // 1. Try trusted RPC first
    if (this._rpcProvider) {
      try {
        const block = await withRetry(() => this._rpcProvider!.getBlock('latest'), 3, 200);
        if (block?.timestamp) return block.timestamp;
      } catch {
        console.warn('[IdentiFI] EthProvider: Trusted RPC failed, falling back...');
      }
    }

    // 2. Try wallet provider
    const signer = await this.getSigner();
    if (signer?.provider) {
      try {
        const block = await signer.provider.getBlock('latest');
        if (block?.timestamp) return block.timestamp;
      } catch {
        console.warn('[IdentiFI] EthProvider: Wallet RPC failed, falling back to Date.now()');
      }
    }

    // 3. Last resort: local clock
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Returns current network info (chainId, name).
   */
  async getNetworkInfo(): Promise<NetworkInfo | null> {
    const provider = this.getBrowserProvider() ?? this._rpcProvider;
    if (!provider) return null;
    try {
      const network = await provider.getNetwork();
      return { name: network.name, chainId: network.chainId };
    } catch {
      return null;
    }
  }

  /**
   * Resets provider state (signer, listeners).
   * Call on logout or wallet disconnect.
   */
  reset(): void {
    this._browserProvider = null;
    this._signer = null;
    this._accountsChangedCallbacks = [];
    this._listenerRegistered = false;
    try { localStorage?.removeItem('identifi_rpc'); } catch {}
  }
}
