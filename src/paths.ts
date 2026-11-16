import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * The NouSR repository root: the nearest folder above this module whose `package.json` is named "nousr". Found by walking up
 * rather than by a fixed `../..`, so it is the same whether the code runs from `src/` (tests) or from the bundled `dist/cli.js`.
 */
function findRoot(start: string): string {
  let dir = start
  for (;;) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === 'nousr') return dir
      } catch {
        // not a readable package.json: keep walking
      }
    }
    const up = dirname(dir)
    if (up === dir) throw new Error(`Cannot find the NouSR folder (a package.json named "nousr") above ${start}`)
    dir = up
  }
}

export const REPO_ROOT = findRoot(import.meta.dirname)

/** A path inside the repository. */
export const repoPath = (...parts: string[]): string => resolve(REPO_ROOT, ...parts)
