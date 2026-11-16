import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ErrorObject } from 'ajv'
import schema from '../../schema/result.schema.json' with { type: 'json' }

/** Strict: an unknown keyword or a loose type in the schema itself is an error, not a silent pass. */
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
const validate = ajv.compile(schema)

/** The result object broke schema/result.schema.json: a bug in NouSR, never in the user's input. */
export class ResultContractError extends Error {
  constructor(readonly problems: string[]) {
    super(`The result does not match schema/result.schema.json (a NouSR bug):\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    this.name = 'ResultContractError'
  }
}

/** The ways `value` breaks the result schema, one line each; empty when it is valid. */
export function resultProblems(value: unknown): string[] {
  if (validate(value)) return []
  return [...new Set((validate.errors ?? []).map(describe))]
}

/** Throws `ResultContractError` unless `value` matches the schema. Run before every write, so a contract break fails loudly. */
export function assertValidResult(value: unknown): void {
  const problems = resultProblems(value)
  if (problems.length > 0) throw new ResultContractError(problems)
}

function describe(e: ErrorObject): string {
  const where = e.instancePath === '' ? '(top level)' : e.instancePath
  const extra = e.keyword === 'additionalProperties' ? ` ("${String(e.params.additionalProperty)}")` : ''
  return `${where}: ${e.message ?? e.keyword}${extra}`
}
