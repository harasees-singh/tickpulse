// Live Kite Connect ticker. Opens the real WebSocket from the browser
// (api_key + access_token in the URL — no secret), parses the binary frames
// into our KiteTick shape, and exposes the SAME Ticker interface as MockTicker
// so the UI is a drop-in swap. See DESIGN.md §4/§12.

import type { KiteTick, KiteDepthItem, Ticker, TickHandler, Mode } from './kite'

const WS_URL = 'wss://ws.kite.trade'

// Price divisor by segment (instrument_token & 0xff): NSE_CD=3 → 1e7,
// BSE_CD=6 → 1e4, everything else → 100 (NSE/BSE equity, F&O, MCX).
function divisorFor(token: number): number {
  const seg = token & 0xff
  return seg === 3 ? 1e7 : seg === 6 ? 1e4 : 100
}

function parsePacket(dv: DataView, off: number, len: number): KiteTick | null {
  const token = dv.getInt32(off)
  const div = divisorFor(token)
  const px = (o: number) => dv.getInt32(off + o) / div

  // LTP mode (8 bytes)
  if (len === 8) {
    return { tradable: true, mode: 'ltp', instrument_token: token, last_price: px(4) }
  }

  // quote (44) and full (184) share the first 44 bytes
  if (len < 44) return null
  const last_price = px(4)
  const ohlc = { open: px(28), high: px(32), low: px(36), close: px(40) }
  const tick: KiteTick = {
    tradable: true,
    mode: len >= 184 ? 'full' : 'quote',
    instrument_token: token,
    last_price,
    last_traded_quantity: dv.getInt32(off + 8),
    average_traded_price: px(12),
    volume_traded: dv.getInt32(off + 16),
    total_buy_quantity: dv.getInt32(off + 20),
    total_sell_quantity: dv.getInt32(off + 24),
    ohlc,
    change: ohlc.close ? ((last_price - ohlc.close) / ohlc.close) * 100 : 0
  }

  if (len >= 184) {
    tick.last_trade_time = new Date(dv.getInt32(off + 44) * 1000)
    tick.oi = dv.getInt32(off + 48)
    tick.oi_day_high = dv.getInt32(off + 52)
    tick.oi_day_low = dv.getInt32(off + 56)
    tick.exchange_timestamp = new Date(dv.getInt32(off + 60) * 1000)
    const buy: KiteDepthItem[] = []
    const sell: KiteDepthItem[] = []
    let d = off + 64
    for (let k = 0; k < 10; k++) {
      const entry: KiteDepthItem = {
        quantity: dv.getInt32(d),
        price: dv.getInt32(d + 4) / div,
        orders: dv.getInt16(d + 8)
      }
      ;(k < 5 ? buy : sell).push(entry)
      d += 12
    }
    tick.depth = { buy, sell }
  }

  return tick
}

export function parseBinary(buf: ArrayBuffer): KiteTick[] {
  const dv = new DataView(buf)
  const count = dv.getInt16(0)
  const out: KiteTick[] = []
  let off = 2
  for (let i = 0; i < count; i++) {
    const len = dv.getInt16(off)
    off += 2
    if (off + len > buf.byteLength) break
    const tick = parsePacket(dv, off, len)
    if (tick) out.push(tick)
    off += len
  }
  return out
}

export class KiteTickerAdapter implements Ticker {
  private url: string
  private tokens: number[]
  private mode: Mode = 'full'
  private ws?: WebSocket
  private shouldRun = false
  private reconnectDelay = 1000

  private tickHandlers: TickHandler[] = []
  private connectHandlers: Array<() => void> = []
  private disconnectHandlers: Array<() => void> = []

  private latency = 0
  private latencyInit = false
  private logged = new Set<number>() // TEMP: one-time diagnostic per symbol

  constructor(opts: { apiKey: string; accessToken: string; tokens: number[] }) {
    this.url = `${WS_URL}?api_key=${encodeURIComponent(opts.apiKey)}&access_token=${encodeURIComponent(opts.accessToken)}`
    this.tokens = opts.tokens.slice()
  }

  connect(): Promise<void> {
    this.shouldRun = true
    this.open()
    return Promise.resolve()
  }

  private open() {
    const ws = new WebSocket(this.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      this.reconnectDelay = 1000
      this.connectHandlers.forEach((h) => h())
      this.send({ a: 'subscribe', v: this.tokens })
      this.send({ a: 'mode', v: [this.mode, this.tokens] })
    }

    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') return // text postbacks/errors — ignore (read-only)
      const buf = e.data as ArrayBuffer
      if (buf.byteLength < 2) return // 1-byte heartbeat
      const ticks = parseBinary(buf)
      if (!ticks.length) return

      // TEMP diagnostic: log the first tick per symbol so we can verify the Chg%
      // inputs (is LTP actually below prevClose? above open?). Remove later.
      for (const tk of ticks) {
        if (!this.logged.has(tk.instrument_token) && tk.ohlc) {
          this.logged.add(tk.instrument_token)
          console.log(
            `[KITE] token=${tk.instrument_token} ltp=${tk.last_price} open=${tk.ohlc.open}` +
              ` prevClose=${tk.ohlc.close} dayChg=${(tk.change ?? 0).toFixed(2)}%`
          )
        }
      }

      // Feed latency from the exchange timestamp (full mode).
      const ts = ticks[0].exchange_timestamp
      if (ts) {
        const lat = Date.now() - ts.getTime()
        if (lat >= 0 && lat < 60000) {
          this.latency = this.latencyInit ? this.latency + 0.2 * (lat - this.latency) : lat
          this.latencyInit = true
        }
      }
      for (let i = 0; i < this.tickHandlers.length; i++) this.tickHandlers[i](ticks)
    }

    ws.onclose = () => {
      this.disconnectHandlers.forEach((h) => h())
      if (this.shouldRun) {
        setTimeout(() => this.open(), this.reconnectDelay)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
      }
    }

    ws.onerror = () => {
      try {
        ws.close()
      } catch {
        /* noop */
      }
    }
  }

  private send(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  disconnect(): void {
    this.shouldRun = false
    this.ws?.close()
  }

  subscribe(tokens: number[]): void {
    const set = new Set(this.tokens)
    for (const t of tokens) set.add(t)
    this.tokens = [...set]
    this.send({ a: 'subscribe', v: tokens })
    this.send({ a: 'mode', v: [this.mode, tokens] })
  }

  unsubscribe(tokens: number[]): void {
    const drop = new Set(tokens)
    this.tokens = this.tokens.filter((t) => !drop.has(t))
    this.send({ a: 'unsubscribe', v: tokens })
  }

  setMode(mode: Mode, tokens: number[]): void {
    this.mode = mode
    this.send({ a: 'mode', v: [mode, tokens] })
  }

  on(ev: 'ticks', cb: TickHandler): void
  on(ev: 'connect', cb: () => void): void
  on(ev: 'disconnect', cb: () => void): void
  on(ev: string, cb: any): void {
    if (ev === 'ticks') this.tickHandlers.push(cb)
    else if (ev === 'connect') this.connectHandlers.push(cb)
    else if (ev === 'disconnect') this.disconnectHandlers.push(cb)
  }

  // Browser WebSockets can't send ping frames; feed latency is derived from the
  // exchange timestamp instead, so ping() is a no-op.
  ping(): void {}
  getLatency(): number {
    return this.latency
  }
}

