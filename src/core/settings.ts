// Cold-state persistence (DEV_PLAN §1.A). The single source of truth for ALL
// persisted UI preferences: a versioned `tickpulse.settings` blob in
// localStorage with load / save / migrate. Framework-free on purpose — it is
// pulled into the node test graph via store.ts, so it must NOT import solid-js.
//
// Zero-jank rule: this is COLD state. The per-tick hot path (store.ingest /
// render pump) must never read settings directly; store.ts keeps a plain local
// mirror of the breakout thresholds, refreshed via subscribeSettings() only when
// the user actually changes them. Writes are debounced so dragging a slider
// doesn't thrash localStorage.

export const SCHEMA_VERSION = 1
const SETTINGS_KEY = 'tickpulse.settings'
const LEGACY_BREAKOUT_KEY = 'tickpulse.breakout' // pre-v1 standalone blob (v0)
const SAVE_DEBOUNCE_MS = 200

export type Theme = 'obsidian' | 'daylight'

/** Volume-"breakout" alert thresholds (canonical home; re-exported by store.ts). */
export interface BreakoutConfig {
  info: number // z-score for a "Watch" (mild) flag
  warn: number // z-score for "High"
  crit: number // z-score for "Spike" (a breakout)
  cooldownMs: number // min gap between alerts per symbol
}

export interface Watchlist {
  id: string
  name: string
  tokens: number[]
  enabled: boolean
}

export interface ScreenPrefs {
  sort: string
  filters: Record<string, unknown>
  columns: string[]
}

export interface AlertPrefs {
  toast: boolean
  sound: boolean
  desktop: boolean
}

export interface Settings {
  version: number
  theme: Theme
  activeSection: string
  watchlists: Watchlist[]
  activeWatchlist: string
  breakout: BreakoutConfig
  screens: Record<string, ScreenPrefs>
  alerts: AlertPrefs
  pinned: number[] // tokens
  muted: number[] // tokens
  devMock: boolean // dev-only: use the simulated feed instead of the live socket
}

export const SETTINGS_DEFAULTS: Settings = {
  version: SCHEMA_VERSION,
  theme: 'obsidian',
  activeSection: 'scanner',
  watchlists: [{ id: 'default', name: 'Default', tokens: [], enabled: true }],
  activeWatchlist: 'default',
  breakout: { info: 2.5, warn: 3.5, crit: 5, cooldownMs: 4000 },
  screens: {},
  alerts: { toast: true, sound: false, desktop: false },
  pinned: [],
  muted: [],
  devMock: false
}

// --- helpers --------------------------------------------------------------

/** Deep-partial: nested objects become optional recursively; arrays stay whole. */
export type DeepPartial<T> = T extends (infer _U)[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Recursive merge: nested plain objects merge; arrays & primitives replace. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch as T) ?? base
  const out: Record<string, unknown> = { ...base }
  for (const k of Object.keys(patch)) {
    const pv = (patch as Record<string, unknown>)[k]
    out[k] = isPlainObject(out[k]) && isPlainObject(pv) ? deepMerge(out[k], pv) : pv
  }
  return out as T
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

// --- state + persistence --------------------------------------------------

const listeners = new Set<(s: Settings) => void>()
let saveTimer: ReturnType<typeof setTimeout> | null = null
let current: Settings = clone(SETTINGS_DEFAULTS)

/** Bring any blob up to the current schema, folding in legacy keys. */
function migrate(raw: unknown, fromVersion: number): Settings {
  const result = deepMerge(clone(SETTINGS_DEFAULTS), isPlainObject(raw) ? raw : {})
  if (fromVersion < 1) {
    // v0 stored breakout thresholds in their own `tickpulse.breakout` key.
    try {
      const legacy = localStorage.getItem(LEGACY_BREAKOUT_KEY)
      if (legacy) result.breakout = { ...result.breakout, ...JSON.parse(legacy) }
    } catch {
      /* ignore malformed legacy blob */
    }
  }
  result.version = SCHEMA_VERSION
  return result
}

/**
 * Read + migrate from localStorage into the in-memory `current`. Idempotent and
 * always re-reads (so tests can seed storage then call it), and never throws —
 * corrupt/absent storage falls back to defaults.
 */
export function loadSettings(): Settings {
  try {
    const str = localStorage.getItem(SETTINGS_KEY)
    const raw = str ? JSON.parse(str) : null
    const fromVersion = isPlainObject(raw) && typeof raw.version === 'number' ? raw.version : 0
    current = migrate(raw, fromVersion)
  } catch {
    current = clone(SETTINGS_DEFAULTS)
  }
  return current
}

/** The live settings snapshot. Safe to read in cold paths; never per-tick. */
export function getSettings(): Settings {
  return current
}

/** Persist immediately (also cancels any pending debounced write). No-throw. */
export function saveSettings(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current))
  } catch {
    /* ignore (private mode / storage disabled) */
  }
}

/** Flush any pending debounced write now (e.g. on `beforeunload`). */
export const flushSettings = saveSettings

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveSettings, SAVE_DEBOUNCE_MS)
}

function notify(): void {
  for (const fn of listeners) fn(current)
}

/** Merge a (deep) partial patch, notify subscribers now, persist debounced. */
export function updateSettings(patch: DeepPartial<Settings>): Settings {
  current = deepMerge(current, patch)
  notify()
  scheduleSave()
  return current
}

/** Restore factory defaults, notify, persist immediately. */
export function resetSettings(): Settings {
  current = clone(SETTINGS_DEFAULTS)
  notify()
  saveSettings()
  return current
}

/** Subscribe to settings changes; returns an unsubscribe fn. */
export function subscribeSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

// Hydrate from storage at module load (after `current` is initialized above, so
// loadSettings()'s assignment to `current` is never in the temporal dead zone).
loadSettings()

