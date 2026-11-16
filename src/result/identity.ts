import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { repoPath, REPO_ROOT } from '../paths'

/** The damage kernel and the commit of it NouSR is pinned to (CLAUDE.md, build order step 1). New Fribbels math changes numbers with no NouSR change. */
export const KERNEL_ID = 'fribbels/hsr-optimizer@31644d9'

/** SHA-256 of some bytes, as lowercase hex. */
export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** NouSR's package version. */
export function nousrVersion(): string {
  return (JSON.parse(readFileSync(repoPath('package.json'), 'utf8')) as { version: string }).version
}

/** The git commit NouSR runs from, or null when git or the repository is not there. */
export function nousrCommit(): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return /^[0-9a-f]{40}$/.test(out) ? out : null
  } catch {
    return null
  }
}
