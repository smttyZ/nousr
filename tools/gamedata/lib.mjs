// Shared helpers for reading the game's data tables (DimbreathBot/TurnBasedGameData).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Where fetch.mjs puts the tables. Git-ignored. */
export const DEFAULT_DIR = resolve(import.meta.dirname, '../../.gamedata')

export function open(dir = DEFAULT_DIR) {
  // Text hashes are 64-bit, beyond what a JS number holds, so keep them as strings.
  const load = (name) =>
    JSON.parse(readFileSync(`${dir}/${name}.json`, 'utf8').replace(/"Hash":\s*(\d+)/g, '"Hash":"$1"'))
  const text = JSON.parse(readFileSync(`${dir}/TextMapEN.json`, 'utf8'))
  /** Text for a `{ Hash }` field, or for a string key such as "AvatarRankDesc_130801". */
  const t = (ref) => {
    if (!ref) return ''
    return (typeof ref === 'object' ? text[ref.Hash] : text[xxh64(String(ref))]) ?? ''
  }
  return { load, t }
}

/** Unwraps the tables' `{ Value: n }` numbers. */
export const v = (x) => (x && typeof x === 'object' && 'Value' in x ? x.Value : x)

/** Fills a description's #1[i]% style placeholders from its parameter list and strips markup. */
export function fill(desc, params) {
  return (desc || '(text not found)')
    .replace(/<[^>]+>/g, '')
    .replace(/\\n/g, ' / ')
    .replace(/#(\d+)\[(?:i|f\d)\](%?)/g, (_, i, pct) => {
      const p = params[Number(i) - 1]
      if (p === undefined) return '?'
      return pct ? `${+(p * 100).toFixed(2)}%` : `${+p.toFixed(2)}`
    })
}

// xxHash64 with seed 0 over the UTF-8 bytes. The text table keys string names by this hash.
const M = (1n << 64n) - 1n
const P1 = 11400714785074694791n
const P2 = 14029467366897019727n
const P3 = 1609587929392839161n
const P4 = 9650029242287828579n
const P5 = 2870177450012600261n
const rotl = (x, r) => ((x << r) | (x >> (64n - r))) & M
const round = (acc, input) => (rotl((acc + input * P2) & M, 31n) * P1) & M
const merge = (h, val) => ((h ^ round(0n, val)) * P1 + P4) & M

export function xxh64(str) {
  const b = Buffer.from(str, 'utf8')
  const len = b.length
  let i = 0
  let h
  if (len >= 32) {
    let v1 = (P1 + P2) & M
    let v2 = P2
    let v3 = 0n
    let v4 = (0n - P1) & M
    for (; i <= len - 32; i += 32) {
      v1 = round(v1, b.readBigUInt64LE(i))
      v2 = round(v2, b.readBigUInt64LE(i + 8))
      v3 = round(v3, b.readBigUInt64LE(i + 16))
      v4 = round(v4, b.readBigUInt64LE(i + 24))
    }
    h = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & M
    h = merge(merge(merge(merge(h, v1), v2), v3), v4)
  } else {
    h = P5
  }
  h = (h + BigInt(len)) & M
  for (; i + 8 <= len; i += 8) h = (rotl(h ^ round(0n, b.readBigUInt64LE(i)), 27n) * P1 + P4) & M
  if (i + 4 <= len) {
    h = (rotl(h ^ ((BigInt(b.readUInt32LE(i)) * P1) & M), 23n) * P2 + P3) & M
    i += 4
  }
  for (; i < len; i++) h = (rotl(h ^ ((BigInt(b[i]) * P5) & M), 11n) * P1) & M
  h ^= h >> 33n
  h = (h * P2) & M
  h ^= h >> 29n
  h = (h * P3) & M
  h ^= h >> 32n
  return h.toString()
}
