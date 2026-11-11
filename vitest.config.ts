import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const fribbelsRoot = resolve(import.meta.dirname, 'vendor/hsr-optimizer')

export default defineConfig({
  resolve: {
    // Fribbels imports its own files as bare paths ('lib/...', 'types/...') through the "paths"
    // entry in its tsconfig. This makes the resolver honour the tsconfig nearest each file.
    tsconfigPaths: true,
    alias: {
      'cross-fetch': resolve(fribbelsRoot, 'src/lib/utils/nativeFetch.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
