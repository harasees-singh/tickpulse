// Render plane (DESIGN.md §7). A single rAF pump reads the latest store
// snapshot for ONLY the currently-visible (registered) rows and patches the DOM
// directly. Constant work per frame = O(visible rows), independent of tick rate.

import {
  ltp, chgPct, cumVol, rvol, alertUntil, alertTier, buyFlow, sellFlow,
  vwap, open, low, high, lastTickAt, depth
} from './store'
import type { DepthSnapshot } from './store'
import { fmtPrice, fmtTurnover, fmtAge } from './format'
import { palette } from './theme'
import { drawPriceSeries } from './chart'

export type SurgeClass = 'zero' | 'up' | 'down'

/**
 * Colour class for the Vol Surge value. Muted grey ONLY for a no-surge reading
 * (rvol rounds to 0.00×); otherwise green for net buying / red for net selling.
 * It must NEVER be a plain/neutral colour for a NON-ZERO value — that bug has
 * surfaced twice (first grey, then white), so render.test.ts locks it.
 * @param bp buy proportion = buyFlow / (buyFlow + sellFlow); 0.5 when no flow.
 */
export function surgeClass(rvol: number, bp: number): SurgeClass {
  if (rvol < 0.005) return 'zero'
  return bp >= 0.5 ? 'up' : 'down'
}

/** Flow-direction glyph: ▲ strong buy · ▼ strong sell · · balanced / no surge. */
export function surgeArrow(rvol: number, bp: number): '▲' | '▼' | '·' {
  if (rvol < 0.005) return '·'
  return bp >= 0.55 ? '▲' : bp <= 0.45 ? '▼' : '·'
}

/**
 * A genuine live market has positive price AND quantity on BOTH sides of the
 * book. Market-closed snapshots are frequently empty or one-sided (all zeros),
 * which must NOT render as a live ladder — otherwise the panel shows a lone
 * ghost row and a bogus full-price "spread" (ask − 0). Locked by render.test.ts.
 */
export function depthTwoSided(book: DepthSnapshot | undefined): boolean {
  if (!book) return false
  const bid = book.buy.some((l) => l.quantity > 0 && l.price > 0)
  const ask = book.sell.some((l) => l.quantity > 0 && l.price > 0)
  return bid && ask
}

/** Best bid/ask spread, or null when there's no valid two-sided top-of-book (a
 *  zero on either side, or a crossed quote) — never report ask − 0 as a spread. */
export function depthSpread(book: DepthSnapshot | undefined): number | null {
  if (!book || !book.buy[0] || !book.sell[0]) return null
  const bid = book.buy[0].price
  const ask = book.sell[0].price
  if (bid <= 0 || ask <= 0 || ask < bid) return null
  return ask - bid
}

export interface RowRefs {
  idx: number
  root: HTMLElement
  ltpEl: HTMLElement
  chgEl: HTMLElement
  surgeEl: HTMLElement
  surgeNum: HTMLElement
  surgeArrow: HTMLElement
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
  drawPriceSeries(r.priceCtx, r.idx, r.priceW, r.priceH)
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
  // Number and arrow are separate fixed-width slots so neither the RVOL digit
  // count nor the arrow glyph ever shifts the layout.
  r.surgeNum.textContent = rv.toFixed(2) + 'x'
  r.surgeArrow.textContent = surgeArrow(rv, bp)
  // Colour: muted grey ONLY for a no-surge (0.00×); else green/red by net flow
  // lean (see surgeClass — locked by render.test.ts). Never plain white.
  r.surgeEl.className = 'surge-val ' + surgeClass(rv, bp)
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
