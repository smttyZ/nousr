import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import { repoPath } from '../paths'

/**
 * Per-member kit options (DESIGN.md K25, K26; docs/proposals/scenario-kit-options.md).
 *
 * Each kit that takes options publishes `schema/kit-options/<character id>.schema.json`. A scenario member's `kit_options` is
 * checked against it, defaults are filled in, and values that name team members are checked against the team. Every option must
 * have a finite domain (an enum, a bounded integer, a boolean, or a bounded list of such values or member keys) and a default
 * (`default`, or `x-nousr-computed-default` describing one the kit computes), so an optimizer can enumerate the options of any kit
 * from its schema alone (`isFiniteOptionSchema`).
 *
 * Two annotation keywords:
 * - `x-nousr-domain: { member_keys: true, values: [...], exclude_self: true }` on a string: a member key of the same team, or one of
 *   `values`. `exclude_self` rules out the key of the member that carries the options (Cyrene's "This Ode, to All Lives" cannot
 *   target her), with a message that says so.
 * - `x-nousr-computed-default: "..."` on an option without a fixed `default`: what the kit uses when the option is absent.
 */

export type KitOptions = Record<string, unknown>
type Schema = Record<string, unknown>

interface Domain {
  member_keys?: boolean
  values?: string[]
  /** The member carrying the options is not an allowed member key. */
  exclude_self?: boolean
}

const DIR = repoPath('schema/kit-options') + '/'

const ajv = new Ajv2020({ allErrors: true, useDefaults: true })
ajv.addKeyword({ keyword: 'x-nousr-domain', schemaType: 'object' })
ajv.addKeyword({ keyword: 'x-nousr-computed-default', schemaType: 'string' })

/** Every kit-options schema, by character id. */
export const KIT_OPTION_SCHEMAS: ReadonlyMap<string, Schema> = new Map(
  readdirSync(DIR)
    .filter((name) => /^\d{4}\.schema\.json$/.test(name))
    .map((name) => [name.slice(0, 4), JSON.parse(readFileSync(DIR + name, 'utf8')) as Schema]),
)

const validators = new Map<string, ValidateFunction>()
function validatorFor(character: string): ValidateFunction | undefined {
  const schema = KIT_OPTION_SCHEMAS.get(character)
  if (!schema) return undefined
  let validate = validators.get(character)
  if (!validate) {
    validate = ajv.compile(schema)
    validators.set(character, validate)
  }
  return validate
}

/**
 * Checks one member's `kit_options` and returns them with the schema's defaults filled in, or undefined after pushing the
 * problems. `teamKeys` are the member keys of the member's team, and `selfKey` is the key of the member that carries the options
 * (what `x-nousr-domain.exclude_self` refuses).
 */
export function resolveKitOptions(
  character: string,
  given: KitOptions,
  teamKeys: ReadonlySet<string>,
  selfKey: string,
  at: string,
  problems: string[],
): KitOptions | undefined {
  const validate = validatorFor(character)
  if (!validate) {
    problems.push(`${at}: kit_options given, but character ${character} takes none (no schema/kit-options/${character}.schema.json)`)
    return undefined
  }
  const options = structuredClone(given)
  if (!validate(options)) {
    problems.push(...describe(validate.errors ?? []).map((p) => `${at}: kit_options${p}`))
    return undefined
  }
  const before = problems.length
  checkDomains(KIT_OPTION_SCHEMAS.get(character)!, options, '', teamKeys, selfKey, at, problems)
  return problems.length > before ? undefined : options
}

/** The schema defaults for a character that takes options, as if the member gave `{}`. */
export function defaultKitOptions(character: string): KitOptions | undefined {
  const validate = validatorFor(character)
  if (!validate) return undefined
  const options: KitOptions = {}
  validate(options)
  return options
}

/** Walks schema and value together through properties and items, checking `x-nousr-domain` strings. */
function checkDomains(
  schema: Schema,
  value: unknown,
  path: string,
  teamKeys: ReadonlySet<string>,
  selfKey: string,
  at: string,
  problems: string[],
): void {
  const domain = schema['x-nousr-domain'] as Domain | undefined
  if (domain && typeof value === 'string' && domain.exclude_self === true && domain.member_keys === true && value === selfKey) {
    problems.push(`${at}: kit_options${path} is "${value}", this member's own key, which this option does not allow (it must name another member of the team)`)
  } else if (domain && typeof value === 'string') {
    const ok = (domain.values ?? []).includes(value) || (domain.member_keys === true && teamKeys.has(value))
    if (!ok) {
      const allowed = [...(domain.member_keys ? ['a member key of this team'] : []), ...(domain.values ?? []).map((v) => `"${v}"`)]
      problems.push(`${at}: kit_options${path} is "${value}", which is not ${allowed.join(' or ')}`)
    }
  }
  const properties = schema.properties as Record<string, Schema> | undefined
  if (properties && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, sub] of Object.entries(properties)) {
      if (key in value) checkDomains(sub, (value as Record<string, unknown>)[key], `${path}.${key}`, teamKeys, selfKey, at, problems)
    }
  }
  const items = schema.items as Schema | undefined
  if (items && Array.isArray(value)) value.forEach((v, i) => checkDomains(items, v, `${path}[${i}]`, teamKeys, selfKey, at, problems))
}

/**
 * Whether every option in a kit-options schema has a finite domain and a default: the rule that makes kit options searchable.
 * Returns the problems found (empty when it holds). `notes` is exempt.
 */
export function isFiniteOptionSchema(schema: Schema): string[] {
  const problems: string[] = []
  if (schema.additionalProperties !== false) problems.push('the top level must set additionalProperties: false')
  const properties = (schema.properties ?? {}) as Record<string, Schema>
  for (const [name, option] of Object.entries(properties)) {
    if (name === 'notes') continue
    if (!finite(option)) problems.push(`${name}: the domain is not finite`)
    if (!('default' in option) && typeof option['x-nousr-computed-default'] !== 'string') {
      problems.push(`${name}: no default (give "default" or "x-nousr-computed-default")`)
    }
  }
  return problems
}

function finite(s: Schema): boolean {
  if (Array.isArray(s.enum) || 'const' in s) return true
  if (s.type === 'boolean') return true
  if (s.type === 'integer') return typeof s.minimum === 'number' && typeof s.maximum === 'number'
  if (s.type === 'string') return s['x-nousr-domain'] !== undefined
  if (s.type === 'array') return typeof s.maxItems === 'number' && s.items !== undefined && finite(s.items as Schema)
  return false
}

function describe(errors: ErrorObject[]): string[] {
  return [
    ...new Set(
      errors.map((e) => {
        const extra = e.keyword === 'additionalProperties' ? ` ("${String(e.params.additionalProperty)}")` : ''
        return `${e.instancePath.replaceAll('/', '.')}: ${e.message ?? e.keyword}${extra}`
      }),
    ),
  ]
}
