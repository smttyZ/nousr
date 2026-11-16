import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const fribbelsRoot = resolve(import.meta.dirname, 'vendor/hsr-optimizer')

/**
 * Builds the `nousr` command into `dist/cli.js` (DESIGN.md K8, K34). The damage kernel imports Fribbels'
 * own files through tsconfig path aliases only Vite's resolver follows, so the CLI is bundled with the same resolver settings the
 * tests use (`vitest.config.ts`). Everything is bundled, Fribbels' npm dependencies included, so `node dist/cli.js` needs nothing
 * but Node; data files (schemas, standard builds, enemy profiles, Fribbels' game data) are read from the repository at run time.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      'cross-fetch': resolve(fribbelsRoot, 'src/lib/utils/nativeFetch.ts'),
    },
  },
  ssr: { noExternal: true },
  build: {
    // The entry is the one file that imports the Fribbels adapter; it calls `main` from src/cli.ts.
    ssr: 'src/kernel/fribbels/cliEntry.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node24',
    sourcemap: true,
    rollupOptions: {
      output: { entryFileNames: 'cli.js', format: 'es', banner: '#!/usr/bin/env node' },
      // Bundled npm packages that mark every file "use client" (React-style) make Rollup warn about a directive that
      // means nothing in Node. Only that warning is dropped; every other one still prints.
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
        warn(warning)
      },
    },
  },
})
