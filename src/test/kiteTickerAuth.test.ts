import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { KiteTickerAdapter } from '../data/kiteTicker'

// The live adapter treats "socket closed without ever delivering a binary frame,
// twice in a row, while online" as a dead access_token and raises `authError` so
// the UI can bounce the user to Login. Kite completes the WS handshake even for
// an expired token (onopen fires) then drops us silently, so we key off *data*,
// not onopen. These specs drive that heuristic with a fake WebSocket + fake
// timers (the module runs in a node environment).

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  static reset() {
    FakeWebSocket.instances = []
  }
  readyState = 0
  binaryType = ''
  url: string
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  emitOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  emitMessage(data: ArrayBuffer | string) {
    this.onmessage?.({ data } as MessageEvent)
  }
  emitClose() {
    this.readyState = 3
    this.onclose?.()
  }
}

function makeAdapter() {
  return new KiteTickerAdapter({ apiKey: 'k', accessToken: 't', tokens: [1, 2] })
}

describe('KiteTickerAdapter auth-failure heuristic', () => {
  beforeEach(() => {
    FakeWebSocket.reset()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('navigator', { onLine: true })
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fires authError once after two consecutive handshake failures, then stops retrying', () => {
    const onAuthErr = vi.fn()
    const onDisc = vi.fn()
    const a = makeAdapter()
    a.on('authError', onAuthErr)
    a.on('disconnect', onDisc)
    a.connect()

    // socket #1 closes before opening → failure #1, reconnect scheduled
    expect(FakeWebSocket.instances).toHaveLength(1)
    FakeWebSocket.instances[0].emitClose()
    expect(onAuthErr).not.toHaveBeenCalled()

    // reconnect timer fires → socket #2
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(2)

    // socket #2 closes before opening → failure #2 → authError
    FakeWebSocket.instances[1].emitClose()
    expect(onAuthErr).toHaveBeenCalledTimes(1)

    // retry loop is halted — no socket #3 is ever created
    vi.advanceTimersByTime(60000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(onDisc).toHaveBeenCalledTimes(2)
  })

  it('fires authError when an expired token opens the handshake then closes with no data', () => {
    // The real Kite failure mode: the WS handshake SUCCEEDS (onopen) for a dead
    // token, but no frame is ever delivered before the server drops us.
    const onAuthErr = vi.fn()
    const a = makeAdapter()
    a.on('authError', onAuthErr)
    a.connect()

    FakeWebSocket.instances[0].emitOpen()
    FakeWebSocket.instances[0].emitClose() // opened, but no data → failure #1
    expect(onAuthErr).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    FakeWebSocket.instances[1].emitOpen()
    FakeWebSocket.instances[1].emitClose() // opened, but no data → failure #2
    expect(onAuthErr).toHaveBeenCalledTimes(1)
  })

  it('resets the tripwire once a real frame arrives (a heartbeat proves the token is live)', () => {
    const onAuthErr = vi.fn()
    const a = makeAdapter()
    a.on('authError', onAuthErr)
    a.connect()

    FakeWebSocket.instances[0].emitClose() // failure #1
    vi.advanceTimersByTime(1000)
    FakeWebSocket.instances[1].emitOpen()
    FakeWebSocket.instances[1].emitMessage(new ArrayBuffer(1)) // 1-byte heartbeat → reset
    FakeWebSocket.instances[1].emitClose() // failure #1 again (not #2)

    vi.advanceTimersByTime(5000)
    expect(onAuthErr).not.toHaveBeenCalled()
  })

  it('does not treat a text error frame as proof of a live feed', () => {
    const onAuthErr = vi.fn()
    const a = makeAdapter()
    a.on('authError', onAuthErr)
    a.connect()

    FakeWebSocket.instances[0].emitOpen()
    FakeWebSocket.instances[0].emitMessage('{"type":"error"}') // string → ignored
    FakeWebSocket.instances[0].emitClose() // still a data-less close → failure #1
    vi.advanceTimersByTime(1000)
    FakeWebSocket.instances[1].emitClose() // failure #2 → authError
    expect(onAuthErr).toHaveBeenCalledTimes(1)
  })

  it('suppresses authError while the browser is offline', () => {
    vi.stubGlobal('navigator', { onLine: false })
    const onAuthErr = vi.fn()
    const a = makeAdapter()
    a.on('authError', onAuthErr)
    a.connect()

    FakeWebSocket.instances[0].emitClose()
    vi.advanceTimersByTime(1000)
    FakeWebSocket.instances[1].emitClose()
    expect(onAuthErr).not.toHaveBeenCalled()
  })

  it('does not raise authError after an explicit disconnect()', () => {
    const onAuthErr = vi.fn()
    const a = makeAdapter()
    a.on('authError', onAuthErr)
    a.connect()

    a.disconnect() // shouldRun = false
    FakeWebSocket.instances[0].emitClose()
    vi.advanceTimersByTime(60000)
    expect(onAuthErr).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(1) // no reconnect after disconnect
  })
})

