// Render plane (DESIGN.md §7). A single rAF pump reads the latest store
// snapshot for ONLY the currently-visible (registered) rows and patches the DOM
// directly. Constant work per frame = O(visible rows), independent of tick rate.

import {
  ltp, chgPct, cumVol, rvol, alertUntil, alertTier, buyFlow, sellFlow,
  histPrice, prevClose, vwap, open, low, high, lastTickAt, depth, histHead, HIST
} from './store'
import { fmtPrice, fmtTurnover, fmtAge } from './format'
import { palette } from './theme'

export interface RowRefs {
  idx: number
  root: HTMLElement
  ltpEl: HTMLElement
  chgEl: HTMLElement
  surgeEl: HTMLElement
  surgeBuy: HTMLElement
  surgeSell: HTMLElement
  turnoverEl: HTMLElement
  ltpDot: HTMLElement
  vwapTick: HTMLElement
  openTick: HTMLElement
  depthBuy: HTMLElement
  freshDot: HTMLElement
  freshEl: HTMLElement
  priceCtx: CanvasRenderingContext2D
  priceW: number
  priceH: number
  lastLtp: number
  lastTurnover: number
  lastTier: number
  lastFresh: string
  lastAgeText: string
}

// Only visible rows are registered (mount/unmount), so the pump naturally does
// bounded work even with hundreds of symbols.
export const registry = new Map<number, RowRefs>()
export function register(r: RowRefs) {
  registry.set(r.idx, r)
}
export function unregister(idx: number) {
  registry.delete(idx)
}

let fpsEwma = 60
let lastT = performance.now()

export function startPump(onFrame: (now: number, fps: number) => void) {
  function frame() {
    const now = performance.now()
    const dt = now - lastT
    lastT = now
    if (dt > 0) fpsEwma += 0.1 * (1000 / dt - fpsEwma)

    registry.forEach((r) => updateRow(r, now))
    onFrame(now, fpsEwma)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

// Brief primary-color highlight on price change (compositor-friendly, runs on
// the few visible cells only). Matches the design's "primary highlight" pulse.
function flash(el: HTMLElement) {
  el.animate(
    [{ backgroundColor: palette.flashPeak }, { backgroundColor: palette.flashRest }],
    { duration: 500, easing: 'ease-out' }
  )
}


// Intraday price line, colored green/red by current price vs previous close,
// with a dotted reference line at the previous close.
function drawPriceLine(r: RowRefs) {
  const i = r.idx
  const ctx = r.priceCtx
  const W = r.priceW
  const H = r.priceH
  ctx.clearRect(0, 0, W, H)

  const head = histHead[i]
  const pc = prevClose[i]
  const vw = vwap[i]
  let lo = pc
  let hi = pc
  for (let k = 0; k < HIST; k++) {
    const v = histPrice[i * HIST + k]
    if (v > 0) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (vw > 0) {
    if (vw < lo) lo = vw
    if (vw > hi) hi = vw
  }
  if (hi - lo < 1e-6) {
    hi = pc * 1.001
    lo = pc * 0.999
  }
  const pad = (hi - lo) * 0.15
  lo -= pad
  hi += pad
  const yOf = (v: number) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4)

  const up = ltp[i] >= pc
  const stroke = up ? palette.up : palette.down

  // dotted previous-close baseline (grey)
  const yc = yOf(pc)
  ctx.save()
  ctx.setLineDash([2, 2])
  ctx.strokeStyle = palette.prevClose
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, yc)
  ctx.lineTo(W, yc)
  ctx.stroke()
  // VWAP reference (blue dotted)
  if (vw > 0) {
    const yv = yOf(vw)
    ctx.setLineDash([1, 2])
    ctx.strokeStyle = palette.vwap
    ctx.beginPath()
    ctx.moveTo(0, yv)
    ctx.lineTo(W, yv)
    ctx.stroke()
  }
  ctx.restore()

  // price line (oldest → newest), skipping un-filled samples
  const stepX = W / (HIST - 1)
  ctx.beginPath()
  let started = false
  for (let k = 0; k < HIST; k++) {
    const v = histPrice[i * HIST + ((head + k) % HIST)]
    if (v <= 0) continue
    const x = k * stepX
    const y = yOf(v)
    if (started) ctx.lineTo(x, y)
    else {
      ctx.moveTo(x, y)
      started = true
    }
  }
  ctx.lineWidth = 1.5
  ctx.strokeStyle = stroke
  ctx.stroke()
}

function updateRow(r: RowRefs, now: number) {
  const i = r.idx

  // LTP (flash on change)
  const price = ltp[i]
  if (price !== r.lastLtp) {
    r.ltpEl.textContent = fmtPrice(price)
    flash(r.ltpEl)
    r.lastLtp = price
  }

  // Chg% pill
  const c = chgPct[i]
  r.chgEl.textContent = (c > 0 ? '+' : '') + c.toFixed(2) + '%'
  r.chgEl.className = 'chg-pill ' + (c > 0.01 ? 'up' : c < -0.01 ? 'down' : 'flat')

  // Vol Surge • Flow — RVOL× + ▲/▼, with a full-width buyer/seller split bar.
  const rv = rvol[i]
  const bf = buyFlow[i]
  const sf = sellFlow[i]
  const tot = bf + sf
  const bp = tot > 0 ? bf / tot : 0.5
  const flowCls = bp >= 0.55 ? 'up' : bp <= 0.45 ? 'down' : 'flat'
  r.surgeEl.textContent = rv.toFixed(2) + 'x' + (flowCls === 'up' ? ' ▲' : flowCls === 'down' ? ' ▼' : ' ·')
  // Grey ONLY when there's no surge (displays as 0.00×). Otherwise tint by flow
  // direction — neutral flow uses normal text, not a "disabled" grey.
  r.surgeEl.className = 'surge-val ' + (rv < 0.005 ? 'zero' : flowCls)
  r.surgeBuy.style.width = bp * 100 + '%'
  r.surgeSell.style.width = (1 - bp) * 100 + '%'

  // Turnover ₹ (only on change)
  const to = vwap[i] * cumVol[i]
  if (to !== r.lastTurnover) {
    r.turnoverEl.textContent = fmtTurnover(to)
    r.lastTurnover = to
  }

  // Day Range — LTP position between day low..high, with VWAP + open ticks.
  const lo = low[i]
  const span = high[i] - lo
  if (span > 1e-9) {
    const pos = (x: number) => Math.max(4, Math.min(96, ((x - lo) / span) * 100))
    r.ltpDot.style.left = pos(price) + '%'
    r.vwapTick.style.left = pos(vwap[i]) + '%'
    r.openTick.style.left = pos(open[i]) + '%'
  }

  // Depth — buy share of the (≤5-level) order book.
  const d = depth[i]
  let buyShare = 0.5
  if (d) {
    let bq = 0
    let sq = 0
    for (let k = 0; k < d.buy.length; k++) bq += d.buy[k].quantity
    for (let k = 0; k < d.sell.length; k++) sq += d.sell[k].quantity
    if (bq + sq > 0) buyShare = bq / (bq + sq)
  }
  r.depthBuy.style.width = buyShare * 100 + '%'

  // Fresh — dot bucket + age text (only on change).
  const age = now - lastTickAt[i]
  const fresh = lastTickAt[i] === 0 ? 'stale' : age < 1500 ? 'new' : age < 6000 ? 'fresh' : 'stale'
  if (fresh !== r.lastFresh) {
    r.freshDot.className = 'fresh-dot ' + fresh
    r.lastFresh = fresh
  }
  const ageText = lastTickAt[i] === 0 ? '—' : fmtAge(age)
  if (ageText !== r.lastAgeText) {
    r.freshEl.textContent = ageText
    r.lastAgeText = ageText
  }

  // Breakout tier glow
  const tier = now < alertUntil[i] ? alertTier[i] : 0
  if (tier !== r.lastTier) {
    r.root.classList.toggle('alert-1', tier === 1)
    r.root.classList.toggle('alert-2', tier === 2)
    r.root.classList.toggle('alert-3', tier === 3)
    r.lastTier = tier
  }

  drawPriceLine(r)
}
