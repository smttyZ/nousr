import { describe, expect, it } from 'vitest'
import { Timeline } from './index'

/** Turns a lone unit at this SPD takes in each of the first `cycles` Memory of Chaos cycles. */
function turnsPerCycle(spd: number, cycles: number): number[] {
  const t = new Timeline()
  t.addUnit({ id: 'u', baseSpd: spd })
  const counts = new Array<number>(cycles).fill(0)
  for (const step of t.run({ cycles })) {
    if (step.kind === 'turn') counts[step.cycle - 1]! += 1
  }
  return counts
}

function totalTurns(spd: number, cycles: number): number {
  return turnsPerCycle(spd, cycles).reduce((a, b) => a + b, 0)
}

describe('Memory of Chaos SPD breakpoints', () => {
  it('134 SPD takes 2 turns in cycle 1, 133 SPD takes 1', () => {
    expect(turnsPerCycle(134, 1)).toEqual([2])
    expect(turnsPerCycle(133, 1)).toEqual([1])
  })

  // Game8, "Speed Breakpoint Chart", read 2026-11-10:
  // https://game8.co/games/Honkai-Star-Rail/archives/438178
  // Each row lists the cycles (out of the first 5) in which that SPD gets 2 turns.
  const game8: [spd: number, cyclesWithTwoTurns: number[]][] = [
    [120, [2]],
    [134, [1, 4]],
    [143, [1, 3]],
    [146, [1, 3, 5]],
    [156, [1, 3, 4]],
    [160, [1, 2, 4]],
    [164, [1, 2, 4, 5]],
    [172, [1, 2, 3, 5]],
    [178, [1, 2, 3, 4]],
  ]

  it.each(game8)('%d SPD gets 2 turns in cycles %j and 1 turn in the rest (Game8)', (spd, doubles) => {
    const expected = [1, 2, 3, 4, 5].map((cycle) => (doubles.includes(cycle) ? 2 : 1))
    expect(turnsPerCycle(spd, 5)).toEqual(expected)
  })

  // stephenli.ca, "Honkai Star Rail Speed Stat and Breakpoints", read 2026-11-10:
  // https://www.stephenli.ca/honkai-star-rail-speed-stat-and-breakpoints
  // Row = cycle, counted from 0 as the community does. Column = number of turns, 1 to 8.
  // Cell = the SPD needed to fit that many turns by the end of that cycle, to one decimal.
  const stephenLi: number[][] = [
    [66.7, 133.3, 200.0, 266.7, 333.3, 400.0, 466.7, 533.3],
    [40.0, 80.0, 120.0, 160.0, 200.0, 240.0, 280.0, 320.0],
    [28.6, 57.1, 85.7, 114.3, 142.9, 171.4, 200.0, 228.6],
    [22.2, 44.4, 66.7, 88.9, 111.1, 133.3, 155.6, 177.8],
    [18.2, 36.4, 54.5, 72.7, 90.9, 109.1, 127.3, 145.5],
    [15.4, 30.8, 46.2, 61.5, 76.9, 92.3, 107.7, 123.1],
    [13.3, 26.7, 40.0, 53.3, 66.7, 80.0, 93.3, 106.7],
    [11.8, 23.5, 35.3, 47.1, 58.8, 70.6, 82.4, 94.1],
    [10.5, 21.1, 31.6, 42.1, 52.6, 63.2, 73.7, 84.2],
    [9.5, 19.0, 28.6, 38.1, 47.6, 57.1, 66.7, 76.2],
  ]

  const cells = stephenLi.flatMap((row, cycleFromZero) =>
    row.map((published, i) => ({ cycles: cycleFromZero + 1, turns: i + 1, published })),
  )

  it.each(cells)('$turns turns within $cycles cycles needs $published SPD (stephenli.ca)', ({ cycles, turns, published }) => {
    const windowAv = 150 + 100 * (cycles - 1)
    const exact = (turns * 10_000) / windowAv

    // The published cell is the exact threshold rounded to one decimal.
    expect(Math.abs(exact - published)).toBeLessThanOrEqual(0.05 + 1e-9)

    // The simulator agrees: at the exact threshold the last turn lands on the boundary and counts,
    // and a hair below it that turn is lost.
    expect(totalTurns(exact, cycles)).toBe(turns)
    expect(totalTurns(exact * (1 - 1e-6), cycles)).toBe(turns - 1)
  })
})
