// Tick + client types that MIRROR the Zerodha Kite Connect (KiteTicker) "full"
// mode payload, exactly as the official `kiteconnect` JS client delivers it
// from `ticker.on('ticks', cb)`. Building against this shape means the real
// socket is a drop-in replacement for the mock (see DESIGN.md §4, §12).

export type Mode = 'ltp' | 'quote' | 'full'

export interface KiteDepthItem {
  price: number
  quantity: number
  orders: number
}

/** One parsed quote, identical in shape to a real KiteTicker tick. */
export interface KiteTick {
  tradable: boolean
  mode: Mode
  instrument_token: number
  last_price: number
  last_traded_quantity?: number
  average_traded_price?: number
  /** Cumulative volume traded for the day (NOT per-tick). */
  volume_traded?: number
  total_buy_quantity?: number
  total_sell_quantity?: number
  ohlc?: { open: number; high: number; low: number; close: number }
  /** % change vs previous close, as Kite sends it. */
  change?: number
  last_trade_time?: Date
  exchange_timestamp?: Date
  oi?: number
  oi_day_high?: number
  oi_day_low?: number
  depth?: { buy: KiteDepthItem[]; sell: KiteDepthItem[] }
}

export type TickHandler = (ticks: KiteTick[]) => void

/**
 * The contract both `MockTicker` and a future `KiteTickerAdapter` implement.
 * The app depends ONLY on this — swapping data sources is a one-line change.
 */
export interface TickerClient {
  connect(): Promise<void>
  disconnect(): void
  subscribe(tokens: number[]): void
  unsubscribe(tokens: number[]): void
  setMode(mode: Mode, tokens: number[]): void
  on(ev: 'ticks', cb: TickHandler): void
  on(ev: 'connect', cb: () => void): void
  on(ev: 'disconnect', cb: () => void): void
}

