// MockTicker — implements the SAME TickerClient interface a real KiteTicker
// adapter would. To go live later you swap `new MockTicker()` for the real
// adapter and nothing downstream changes (see DESIGN.md §12).

import type { KiteTick, Ticker, TickHandler, Mode } from '../data/kite'

export class MockTicker implements Ticker {
  private w: Worker
  private tickHandlers: TickHandler[] = []
  private connectHandlers: Array<() => void> = []
  private disconnectHandlers: Array<() => void> = []
  private authErrorHandlers: Array<() => void> = [] // never fires; mock can't lose auth
  private latency = 0
  private latencyInit = false

  constructor() {
    this.w = new Worker(new URL('./mockTicker.worker.ts', import.meta.url), { type: 'module' })
    this.w.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (d?.type === 'ticks') {
        const ticks: KiteTick[] = d.ticks
        for (let i = 0; i < this.tickHandlers.length; i++) this.tickHandlers[i](ticks)
      } else if (d?.type === 'pong') {
        // RTT measured on this thread's clock (t0 was echoed back unchanged).
        const rtt = performance.now() - d.t0
        this.latency = this.latencyInit ? this.latency + 0.3 * (rtt - this.latency) : rtt
        this.latencyInit = true
      }
    }
  }

  connect(): Promise<void> {
    this.connectHandlers.forEach((h) => h())
    return Promise.resolve()
  }

  disconnect(): void {
    this.w.terminate()
    this.disconnectHandlers.forEach((h) => h())
  }

  // Subscriptions are implicit in the mock (whole universe streams).
  subscribe(_tokens: number[]): void {}
  unsubscribe(_tokens: number[]): void {}
  setMode(_mode: Mode, _tokens: number[]): void {}

  on(ev: 'ticks', cb: TickHandler): void
  on(ev: 'connect', cb: () => void): void
  on(ev: 'disconnect', cb: () => void): void
  on(ev: 'authError', cb: () => void): void
  on(ev: string, cb: any): void {
    if (ev === 'ticks') this.tickHandlers.push(cb)
    else if (ev === 'connect') this.connectHandlers.push(cb)
    else if (ev === 'disconnect') this.disconnectHandlers.push(cb)
    else if (ev === 'authError') this.authErrorHandlers.push(cb)
  }

  // --- mock-only controls (wired to the UI; absent on the real adapter) ---
  setRpsScale(v: number) {
    this.w.postMessage({ type: 'rpsScale', value: v })
  }
  setBurstProb(v: number) {
    this.w.postMessage({ type: 'burstProb', value: v })
  }
  triggerBurst(idx?: number) {
    this.w.postMessage({ type: 'burst', idx })
  }
  pause() {
    this.w.postMessage({ type: 'pause' })
  }
  resume() {
    this.w.postMessage({ type: 'resume' })
  }

  /** Send a round-trip ping; the pong handler updates the smoothed latency. */
  ping() {
    this.w.postMessage({ type: 'ping', t0: performance.now() })
  }
  /** Smoothed round-trip latency in ms (the real adapter would expose WS RTT). */
  getLatency(): number {
    return this.latency
  }
}

