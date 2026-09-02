import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'provider/EthProvider': 'src/provider/EthProvider.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2020',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: true,

  // ── Critical: do NOT bundle peer dependencies ────────────────────────────
  // ethers (~2MB) must be resolved by the consuming project.
  // The SDK is a pure HTTP client — no fs/path/url imports remain after the
  // V2 purge (the local WASM engine was removed).
  external: [
    'ethers',
    'crypto',
    'node:crypto',
  ],

  esbuildOptions(options) {
    options.banner = {
      js: '/* @identifi-protocol/sdk — IdentiFI Protocol v0.0.1-alpha.3 | MIT License */',
    };
  },
});
