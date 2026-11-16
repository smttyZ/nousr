import { createPeriodRegistry } from './period'
import { SurvivalOfTheFittest } from './moc202611SurvivalOfTheFittest'

export * from './period'
export { SurvivalOfTheFittest, MOC_2026_11_SURVIVAL_OF_THE_FITTEST } from './moc202611SurvivalOfTheFittest'

/**
 * Every period the simulator knows, by id. To add a period: write its module in this folder, add it to the
 * list below, and set `battle.period` in the scenario to its id.
 */
export const PERIODS = createPeriodRegistry([SurvivalOfTheFittest])
