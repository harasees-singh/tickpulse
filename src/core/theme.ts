// Theme bridge. CSS variables drive the whole DOM via the document's
// `data-theme` attribute, but <canvas> can't read CSS vars — and the rAF render
// pump must NOT call getComputedStyle per frame. So we mirror the chart colors
// into a cached `palette` object that render.ts holds by reference, refreshed
// only when the theme changes. Default theme is Obsidian (dark).

import { getSettings, subscribeSettings, type Theme } from './settings'

export interface ChartPalette {
  up: string
  down: string
  upFill: string
  downFill: string
  vwap: string
  prevClose: string
  grid: string
  tagOn: string
  flashPeak: string
  flashRest: string
}

// Dark (Obsidian) defaults so the very first frame is correct even before the
// first refreshPalette() (e.g. SSR-less hydration order).
export const palette: ChartPalette = {
  up: '#4ae176',
  down: '#ff5451',
  upFill: 'rgba(74,225,118,0.14)',
  downFill: 'rgba(255,84,81,0.14)',
  vwap: 'rgba(174,198,255,0.6)',
  prevClose: 'rgba(140,144,159,0.5)',
  grid: 'rgba(140,144,159,0.18)',
  tagOn: '#0b0e12',
  flashPeak: 'rgba(78,142,255,0.28)',
  flashRest: 'rgba(78,142,255,0)'
}

/** Replace a color's trailing alpha with 0 (the flash end keyframe). */
function toTransparent(color: string): string {
  const m = color.match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return 'rgba(0,0,0,0)'
  const [r, g, b] = m[1].split(',').map((p) => p.trim())
  return `rgba(${r}, ${g}, ${b}, 0)`
}

/** Re-read the resolved `--chart-*`/`--flash` CSS vars into `palette` (mutated
 *  in place so render.ts's imported reference stays valid). */
export function refreshPalette(): void {
  if (typeof document === 'undefined') return
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  palette.up = v('--chart-up', palette.up)
  palette.down = v('--chart-down', palette.down)
  palette.upFill = v('--chart-up-fill', palette.upFill)
  palette.downFill = v('--chart-down-fill', palette.downFill)
  palette.vwap = v('--chart-vwap', palette.vwap)
  palette.prevClose = v('--chart-prevclose', palette.prevClose)
  palette.grid = v('--chart-grid', palette.grid)
  palette.tagOn = v('--chart-tag-on', palette.tagOn)
  palette.flashPeak = v('--flash', palette.flashPeak)
  palette.flashRest = toTransparent(palette.flashPeak)
}

/** Apply a theme: set the document attribute (drives every CSS var) + refresh
 *  the canvas palette so sparklines, price lines and flashes match. */
export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
  refreshPalette()
}

/** Wire theme ↔ settings: apply current + re-apply on every change. Call once. */
export function initTheme(): void {
  applyTheme(getSettings().theme)
  // Re-read once after the first paint in case the stylesheet resolves late
  // (production extracts CSS to an async <link>, so the early read can miss it).
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(refreshPalette)
  subscribeSettings((s) => applyTheme(s.theme))
}


