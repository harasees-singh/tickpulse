/// <reference lib="webworker" />
// Drives the MockEngine off the main thread and posts batched ticks (one
// message per ~16ms frame, mimicking Kite's multi-quote binary frames).

import { MockEngine } from './mockEngine'

const ctx = self as unknown as DedicatedWorkerGlobalScope
const engine = new MockEngine(Date.now())
let paused = false

setInterval(() => {
  if (paused) return
  const ticks = engine.generateUpTo(Date.now())
  if (ticks.length) ctx.postMessage({ type: 'ticks', ticks })
}, 16)

ctx.onmessage = (e: MessageEvent) => {
  const m = e.data
  switch (m?.type) {
    case 'rpsScale':
      engine.setRpsScale(m.value)
      break
    case 'burstProb':
      engine.setBurstProb(m.value)
      break
    case 'burst':
      engine.triggerBurst(m.idx)
      break
    case 'pause':
      paused = true
      break
    case 'resume':
      paused = false
      break
    case 'ping':
      // Echo the caller's timestamp back untouched so RTT is measured entirely
      // on the main thread's clock (no cross-context clock skew).
      ctx.postMessage({ type: 'pong', t0: m.t0 })
      break
  }
}

