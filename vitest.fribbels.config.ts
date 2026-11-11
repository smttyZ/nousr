// Runs Fribbels' OWN test suite from the pinned submodule, as a check that the kernel works on this
// machine. Used by `npm run test:fribbels`, which runs the submodule's vitest with this file as config.
//
// Why this exists: Fribbels' vite.config.ts sets test.execArgv = ['--no-webstorage'], a flag that
// Node older than 26 rejects. This config mirrors the parts of theirs that tests need and drops that
// flag. It has no imports on purpose, so it loads the same from either directory.
import { resolve } from 'node:path'

const fribbelsRoot = resolve(import.meta.dirname, 'vendor/hsr-optimizer')

export default {
  root: fribbelsRoot,
  resolve: {
    tsconfigPaths: true,
    alias: {
      'cross-fetch': resolve(fribbelsRoot, 'src/lib/utils/nativeFetch.ts'),
    },
  },
  test: {
    environment: 'node',
    slowTestThreshold: 500,
    exclude: ['node_modules/**', 'tests/**', 'plans/**'],
    execArgv: [],
  },
}
