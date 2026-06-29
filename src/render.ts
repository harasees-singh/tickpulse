// Render plane (DESIGN.md §7). A single rAF pump reads the latest store
// snapshot for ONLY the currently-visible (registered) rows and patches the DOM
// directly. Constant work per frame = O(visible rows), independent of tick rate.

import { ltp, chgPct, cumVol, rvol, alertUntil, alertTier, histVol, histHead, HIST } from './store'
import { fmtPrice, fmtVol } from './format'

export interface RowRefs {
  idx: number
  root: HTMLElement
  ltpEl: HTMLElement
  chgEl: HTMLElement
  volEl: HTMLElement
  surgeEl: HTMLElement
  surgeBar: HTMLElement
  ctx: CanvasRenderingContext2D
  canvasW: number
  canvasH: number
  lastLtp: number
  lastVol: number
  lastTier: number
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
    [{ backgroundColor: 'rgba(212,227,255,0.9)' }, { backgroundColor: 'rgba(212,227,255,0)' }],
    { duration: 500, easing: 'ease-out' }
  )
}

// Velocity sparkline: area + line, colored green/red by recent trend.
function drawSpark(r: RowRefs) {
  const i = r.idx
  const ctx = r.ctx
  const W = r.canvasW
  const H = r.canvasH
  ctx.clearRect(0, 0, W, H)

  const head = histHead[i]
  let max = 1
  for (let k = 0; k < HIST; k++) {
    const v = histVol[i * HIST + k]
    if (v > max) max = v
  }
  const first = histVol[i * HIST + head]
  const last = histVol[i * HIST + ((head + HIST - 1) % HIST)]
  const rising = last >= first
  const stroke = rising ? '#006e12' : '#b02528'
  const fill = rising ? 'rgba(0,110,18,0.12)' : 'rgba(176,37,40,0.12)'

  const stepX = W / (HIST - 1)
  const yOf = (v: number) => H - 2 - (v / max) * (H - 6)

  ctx.beginPath()
  ctx.moveTo(0, H)
  for (let k = 0; k < HIST; k++) ctx.lineTo(k * stepX, yOf(histVol[i * HIST + ((head + k) % HIST)]))
  ctx.lineTo(W, H)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()

  ctx.beginPath()
  for (let k = 0; k < HIST; k++) {
    const x = k * stepX
    const y = yOf(histVol[i * HIST + ((head + k) % HIST)])
    if (k) ctx.lineTo(x, y)
    else ctx.moveTo(x, y)
  }
  ctx.lineWidth = 1.5
  ctx.strokeStyle = stroke
  ctx.stroke()
}

function updateRow(r: RowRefs, now: number) {
  const i = r.idx

  const price = ltp[i]
  if (price !== r.lastLtp) {
    r.ltpEl.textContent = fmtPrice(price)
    flash(r.ltpEl)
    r.lastLtp = price
  }

  const c = chgPct[i]
  const dirCls = c > 0.01 ? 'up' : c < -0.01 ? 'down' : 'flat'
  r.chgEl.textContent = (c > 0 ? '+' : '') + c.toFixed(2) + '%'
  r.chgEl.className = 'chg-pill ' + dirCls

  const v = cumVol[i]
  if (v !== r.lastVol) {
    r.volEl.textContent = fmtVol(v)
    r.lastVol = v
  }

  const rv = rvol[i]
  const upDown = c >= 0 ? 'up' : 'down'
  r.surgeEl.textContent = rv.toFixed(2) + 'x'
  r.surgeEl.className = 'surge-val ' + upDown
  r.surgeBar.style.width = Math.max(4, Math.min(100, (rv / 4) * 100)) + '%'
  r.surgeBar.className = 'surge-bar ' + upDown

  const tier = now < alertUntil[i] ? alertTier[i] : 0
  if (tier !== r.lastTier) {
    r.root.classList.toggle('alert-1', tier === 1)
    r.root.classList.toggle('alert-2', tier === 2)
    r.root.classList.toggle('alert-3', tier === 3)
    r.lastTier = tier
  }

  drawSpark(r)
}
