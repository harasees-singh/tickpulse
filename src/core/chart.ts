// Shared intraday price-series renderer. The Scanner "Spark" cell and the
// Analytics hero chart draw the same line (price + dotted previous-close +
// dotted VWAP), just at different sizes. Reads the SoA hist buffers directly;
// no per-call allocation.

import { ltp, histPrice, histHead, HIST, prevClose, vwap, high, low } from './store'
import { palette } from './theme'
import { fmtPrice } from './format'

/**
 * Draw symbol `idx`'s intraday price line (+ dotted previous-close & VWAP refs)
 * into a 2D context sized W×H. The caller owns canvas sizing / DPR transform.
 */
export function drawPriceSeries(ctx: CanvasRenderingContext2D, idx: number, W: number, H: number): void {
  const i = idx
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

  // dotted previous-close baseline + dotted VWAP reference
  const yc = yOf(pc)
  ctx.save()
  ctx.setLineDash([2, 2])
  ctx.strokeStyle = palette.prevClose
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, yc)
  ctx.lineTo(W, yc)
  ctx.stroke()
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

/** Mutable per-canvas state for the eased Analytics chart — lerps the price
 *  scale frame-by-frame so the chart glides instead of snapping on every tick. */
export interface ChartState {
  easedLo: number
  easedHi: number
  easedY: number // smoothed LTP y-coordinate (for the marker dot label)
  init: boolean
}
export function makeChartState(): ChartState {
  return { easedLo: 0, easedHi: 0, easedY: 0, init: false }
}

const PAD_RIGHT = 64 // gutter for on-chart price labels (H, VWAP, LTP, PDC, L)

/**
 * Analytics hero chart. Same series as the spark, but with on-canvas labels
 * (H / L / VWAP / PDC / LTP) at their actual price levels and a smoothed scale
 * so the chart doesn't snap when extremes update. Caller drives this on rAF
 * and owns the persistent `ChartState`.
 */
export function drawAnalyticsChart(
  ctx: CanvasRenderingContext2D,
  idx: number,
  W: number,
  H: number,
  st: ChartState
): void {
  const i = idx
  ctx.clearRect(0, 0, W, H)
  const plotW = Math.max(20, W - PAD_RIGHT)

  const head = histHead[i]
  const pc = prevClose[i] || ltp[i]
  const vw = vwap[i]
  const hi0 = high[i] || pc
  const lo0 = low[i] || pc
  // Target scale spans the day H/L plus prev-close and VWAP for context.
  let targetLo = Math.min(lo0, pc, vw > 0 ? vw : pc)
  let targetHi = Math.max(hi0, pc, vw > 0 ? vw : pc)
  if (targetHi - targetLo < 1e-6) {
    targetHi = pc * 1.001
    targetLo = pc * 0.999
  }
  const pad = (targetHi - targetLo) * 0.12
  targetLo -= pad
  targetHi += pad

  // Ease the scale (skip on first frame so we don't animate from 0).
  if (!st.init) {
    st.easedLo = targetLo
    st.easedHi = targetHi
    st.init = true
  } else {
    st.easedLo += (targetLo - st.easedLo) * 0.18
    st.easedHi += (targetHi - st.easedHi) * 0.18
  }
  const lo = st.easedLo
  const hi = st.easedHi
  const span = hi - lo || 1
  const yOf = (v: number) => H - 8 - ((v - lo) / span) * (H - 16)

  const price = ltp[i]
  const up = price >= pc

  // Faint horizontal gridlines (4 ticks) for readability.
  ctx.strokeStyle = palette.grid
  ctx.lineWidth = 1
  for (let g = 0; g <= 4; g++) {
    const y = 8 + (g * (H - 16)) / 4
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(plotW, y)
    ctx.stroke()
  }

  // Reference lines + right-gutter labels, with PRIORITY-BASED collision
  // suppression: LTP > VWAP > H > L > PDC. We compute the LTP y first so the
  // others can skip themselves when they'd overlap something more important.
  const targetY = yOf(price)
  st.easedY = st.init ? st.easedY + (targetY - st.easedY) * 0.25 : targetY
  const ltpY = st.easedY

  const placedY: number[] = [ltpY] // LTP always wins
  const MIN_GAP = 14
  const collides = (y: number) => placedY.some((py) => Math.abs(py - ltpY) < 0.5 ? false : Math.abs(py - y) < MIN_GAP)
  // ltp y is always placed; for others, check against `placedY` AND ltpY explicitly.
  const wouldHit = (y: number) => placedY.some((py) => Math.abs(py - y) < MIN_GAP)

  const labelAt = (y: number, text: string, color: string) => {
    ctx.fillStyle = color
    ctx.font = '11px "JetBrains Mono", ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(text, plotW + 6, y)
  }
  const refLine = (y: number, color: string, dash: number[]) => {
    ctx.save()
    ctx.setLineDash(dash)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(plotW, y)
    ctx.stroke()
    ctx.restore()
  }
  void collides // silence unused; wouldHit covers our case

  // VWAP (priority 2 after LTP)
  if (vw > 0) {
    const yv = yOf(vw)
    refLine(yv, palette.vwap, [4, 3])
    if (!wouldHit(yv)) {
      labelAt(yv, 'VWAP ' + fmtPrice(vw), palette.vwap)
      placedY.push(yv)
    }
  }
  // Day H / L (priority 3-4)
  const yH = yOf(hi0)
  const yL = yOf(lo0)
  refLine(yH, palette.prevClose, [])
  refLine(yL, palette.prevClose, [])
  if (!wouldHit(yH)) {
    labelAt(yH, 'H ' + fmtPrice(hi0), palette.prevClose)
    placedY.push(yH)
  }
  if (!wouldHit(yL)) {
    labelAt(yL, 'L ' + fmtPrice(lo0), palette.prevClose)
    placedY.push(yL)
  }
  // Previous close (lowest priority — show only if it doesn't collide)
  const yc = yOf(pc)
  refLine(yc, palette.prevClose, [2, 3])
  if (!wouldHit(yc)) {
    labelAt(yc, 'PDC ' + fmtPrice(pc), palette.prevClose)
    placedY.push(yc)
  }

  // Collect price points; replace the latest sample's y with the eased LTP y so
  // the line glides between ticks instead of snapping.
  const stepX = plotW / (HIST - 1)
  const pts: { x: number; y: number }[] = []
  for (let k = 0; k < HIST; k++) {
    const v = histPrice[i * HIST + ((head + k) % HIST)]
    if (v <= 0) continue
    pts.push({ x: k * stepX, y: yOf(v) })
  }
  if (pts.length) pts[pts.length - 1] = { x: pts[pts.length - 1].x, y: ltpY }

  // Quadratic-bezier smoothed path through midpoints (Chaikin-style). Skips
  // the initial moveTo when `move=false` so a caller can append the curve to
  // an existing subpath (used by the fill path).
  const appendCurve = (target: CanvasRenderingContext2D | Path2D, move = true) => {
    if (!pts.length) return
    if (move) target.moveTo(pts[0].x, pts[0].y)
    else target.lineTo(pts[0].x, pts[0].y)
    if (pts.length < 3) {
      for (let k = 1; k < pts.length; k++) target.lineTo(pts[k].x, pts[k].y)
      return
    }
    for (let k = 1; k < pts.length - 1; k++) {
      const mx = (pts[k].x + pts[k + 1].x) / 2
      const my = (pts[k].y + pts[k + 1].y) / 2
      target.quadraticCurveTo(pts[k].x, pts[k].y, mx, my)
    }
    target.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
  }

  // Translucent area bounded by the price curve on top and the prev-close
  // baseline on the bottom (one subpath; no diagonal cut on close).
  if (pts.length) {
    const fillPath = new Path2D()
    fillPath.moveTo(pts[0].x, yc) // baseline-left
    appendCurve(fillPath, false) // up along the smoothed price curve
    fillPath.lineTo(pts[pts.length - 1].x, yc) // right edge down to baseline
    fillPath.closePath() // back along the baseline to the start
    ctx.fillStyle = up ? palette.upFill : palette.downFill
    ctx.fill(fillPath)
  }

  // Smooth price line on top of the fill.
  ctx.beginPath()
  appendCurve(ctx, true)
  ctx.lineWidth = 1.75
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = up ? palette.up : palette.down
  ctx.stroke()

  // LTP marker — dashed leader + dot at the latest sample + price tag.
  ctx.save()
  ctx.setLineDash([2, 3])
  ctx.strokeStyle = up ? palette.up : palette.down
  ctx.globalAlpha = 0.45
  ctx.beginPath()
  ctx.moveTo(0, ltpY)
  ctx.lineTo(plotW, ltpY)
  ctx.stroke()
  ctx.restore()
  const lastX = pts.length ? pts[pts.length - 1].x : plotW
  ctx.fillStyle = up ? palette.up : palette.down
  ctx.beginPath()
  ctx.arc(lastX, ltpY, 3.5, 0, Math.PI * 2)
  ctx.fill()
  // LTP price tag — theme-aware text colour for legibility in both themes.
  const tag = fmtPrice(price)
  ctx.font = '11px "JetBrains Mono", ui-monospace, monospace'
  const tagW = ctx.measureText(tag).width + 10
  const tagH = 16
  const tagX = plotW + 4
  const tagY = Math.max(tagH / 2 + 1, Math.min(H - tagH / 2 - 1, ltpY))
  ctx.fillStyle = up ? palette.up : palette.down
  ctx.fillRect(tagX, tagY - tagH / 2, tagW, tagH)
  ctx.fillStyle = palette.tagOn
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(tag, tagX + 5, tagY)
}

