// Shared "terminal" state provided by the Shell (the always-mounted layout) and
// consumed by route pages via useTerminal(). Keeps the data wiring (ticker /
// pump / timers) in ONE place so navigation never tears it down — pages only
// read these accessors / call these handlers.

import { createContext, useContext, type Accessor } from 'solid-js'
import type { Alert, SortKey, SortDir, ScanFilters } from '../core/store'

export interface TerminalCtx {
  // --- scanner data ---
  sort: Accessor<SortKey>
  setSort: (s: SortKey) => void
  sortDir: Accessor<SortDir>
  cycleSort: (key: SortKey) => void
  filters: Accessor<ScanFilters>
  setFilters: (f: ScanFilters) => void
  order: Accessor<number[]>
  alerts: Accessor<Alert[]>
  live: Accessor<boolean>
  userName: Accessor<string | null>
  feedIdle: Accessor<boolean>
  // --- breadth / pressure / VWAP positioning ---
  adv: Accessor<number>
  dec: Accessor<number>
  aboveVwap: Accessor<number>
  buy: Accessor<number>
  sell: Accessor<number>
  // --- mock-feed controls (no-ops on the live adapter) ---
  rps: Accessor<number>
  chaos: Accessor<boolean>
  paused: Accessor<boolean>
  onRps: (v: number) => void
  toggleChaos: () => void
  togglePause: () => void
  triggerBurst: () => void
  // --- breakout thresholds (Settings / Alerts) ---
  thInfo: Accessor<number>
  thWarn: Accessor<number>
  thCrit: Accessor<number>
  thCool: Accessor<number>
  onTh: (which: 'info' | 'warn' | 'crit', v: number) => void
  onCooldown: (secs: number) => void
  resetBreakout: () => void
}

export const TerminalContext = createContext<TerminalCtx>()

export function useTerminal(): TerminalCtx {
  const ctx = useContext(TerminalContext)
  if (!ctx) throw new Error('useTerminal() must be used inside the Shell <TerminalContext.Provider>')
  return ctx
}

