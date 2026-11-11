import { describe, expect, it } from 'vitest'
import { EventBus } from './index'

interface TestEvents {
  ping: { n: number }
  pong: { n: number }
}

describe('event bus', () => {
  it('calls handlers in subscription order', () => {
    const bus = new EventBus<TestEvents>()
    const calls: string[] = []
    bus.on('ping', () => calls.push('first'))
    bus.on('ping', () => calls.push('second'))
    bus.emit('ping', { n: 1 })
    expect(calls).toEqual(['first', 'second'])
  })

  it('calls higher priority first, then subscription order', () => {
    const bus = new EventBus<TestEvents>()
    const calls: string[] = []
    bus.on('ping', () => calls.push('normal-1'))
    bus.on('ping', () => calls.push('high'), { priority: 10 })
    bus.on('ping', () => calls.push('normal-2'))
    bus.on('ping', () => calls.push('low'), { priority: -10 })
    bus.emit('ping', { n: 1 })
    expect(calls).toEqual(['high', 'normal-1', 'normal-2', 'low'])
  })

  it('only delivers to handlers of that event and passes the payload', () => {
    const bus = new EventBus<TestEvents>()
    const seen: number[] = []
    bus.on('ping', (e) => seen.push(e.n))
    bus.emit('pong', { n: 99 })
    bus.emit('ping', { n: 7 })
    expect(seen).toEqual([7])
  })

  it('unsubscribe stops delivery, even mid-delivery', () => {
    const bus = new EventBus<TestEvents>()
    const calls: string[] = []
    const offLater = bus.on('ping', () => calls.push('later'), { priority: -1 })
    bus.on('ping', () => {
      calls.push('remover')
      offLater()
    })
    bus.emit('ping', { n: 1 })
    bus.emit('ping', { n: 2 })
    expect(calls).toEqual(['remover', 'remover'])
  })

  it('a handler added during delivery starts with the next emit', () => {
    const bus = new EventBus<TestEvents>()
    const calls: string[] = []
    let added = false
    bus.on('ping', () => {
      calls.push('outer')
      if (!added) {
        added = true
        bus.on('ping', () => calls.push('added'))
      }
    })
    bus.emit('ping', { n: 1 })
    expect(calls).toEqual(['outer'])
    bus.emit('ping', { n: 2 })
    expect(calls).toEqual(['outer', 'outer', 'added'])
  })

  it('an event emitted inside a handler is delivered in full before the outer one continues', () => {
    const bus = new EventBus<TestEvents>()
    const calls: string[] = []
    bus.on('ping', () => {
      calls.push('ping-1 start')
      bus.emit('pong', { n: 0 })
      calls.push('ping-1 end')
    })
    bus.on('ping', () => calls.push('ping-2'))
    bus.on('pong', () => calls.push('pong'))
    bus.emit('ping', { n: 1 })
    expect(calls).toEqual(['ping-1 start', 'pong', 'ping-1 end', 'ping-2'])
  })
})
