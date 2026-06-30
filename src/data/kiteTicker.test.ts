import { describe, it, expect } from 'vitest'
import { parseBinary } from './kiteTicker'
import { expectValidKiteTick } from '../test/tickShape'

// --- assemble a Kite binary frame EXACTLY as wss://ws.kite.trade sends it ---
// (big-endian: int16 packet-count, then per packet: int16 length + payload).
// This independently states the wire contract; if the parser's offsets/divisor
// drift, these tests fail.

function frame(packets: Uint8Array[]): ArrayBuffer {
  const total = 2 + packets.reduce((n, p) => n + 2 + p.length, 0)
  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  const all = new Uint8Array(buf)
  dv.setInt16(0, packets.length)
  let off = 2
  for (const p of packets) {
    dv.setInt16(off, p.length)
    off += 2
    all.set(p, off)
    off += p.length
  }
  return buf
}

function ltpPacket(token: number, pricePaise: number): Uint8Array {
  const b = new Uint8Array(8)
  const dv = new DataView(b.buffer)
  dv.setInt32(0, token)
  dv.setInt32(4, pricePaise)
  return b
}

interface Level { quantity: number; pricePaise: number; orders: number }
interface FullValues {
  token: number; ltp: number; ltq: number; atp: number; vol: number
  buyQty: number; sellQty: number
  open: number; high: number; low: number; close: number
  ltt: number; oi: number; oiHi: number; oiLo: number; ts: number
  depth: Level[] // 10 levels: 5 buy then 5 sell
}
function fullPacket(v: FullValues): Uint8Array {
  const b = new Uint8Array(184)
  const dv = new DataView(b.buffer)
  dv.setInt32(0, v.token)
  dv.setInt32(4, v.ltp)
  dv.setInt32(8, v.ltq)
  dv.setInt32(12, v.atp)
  dv.setInt32(16, v.vol)
  dv.setInt32(20, v.buyQty)
  dv.setInt32(24, v.sellQty)
  dv.setInt32(28, v.open)
  dv.setInt32(32, v.high)
  dv.setInt32(36, v.low)
  dv.setInt32(40, v.close)
  dv.setInt32(44, v.ltt)
  dv.setInt32(48, v.oi)
  dv.setInt32(52, v.oiHi)
  dv.setInt32(56, v.oiLo)
  dv.setInt32(60, v.ts)
  let d = 64
  for (const lvl of v.depth) {
    dv.setInt32(d, lvl.quantity)
    dv.setInt32(d + 4, lvl.pricePaise)
    dv.setInt16(d + 8, lvl.orders)
    d += 12
  }
  return b
}

const NSE_EQ = 738561 // RELIANCE; (token & 0xff) === 1 → divisor 100

describe('KiteTicker binary frame contract', () => {
  it('parses an LTP (8-byte) packet', () => {
    const ticks = parseBinary(frame([ltpPacket(NSE_EQ, 294215)]))
    expect(ticks).toHaveLength(1)
    expect(ticks[0].mode).toBe('ltp')
    expect(ticks[0].instrument_token).toBe(NSE_EQ)
    expect(ticks[0].last_price).toBeCloseTo(2942.15, 2)
  })

  it('parses a FULL (184-byte) equity packet with every documented field', () => {
    const depth: Level[] = [
      { quantity: 1000, pricePaise: 145200, orders: 5 }, // buy[0]
      { quantity: 800, pricePaise: 145150, orders: 4 },
      { quantity: 600, pricePaise: 145100, orders: 3 },
      { quantity: 400, pricePaise: 145050, orders: 2 },
      { quantity: 200, pricePaise: 145000, orders: 1 },
      { quantity: 900, pricePaise: 145300, orders: 4 }, // sell[0]
      { quantity: 700, pricePaise: 145350, orders: 3 },
      { quantity: 500, pricePaise: 145400, orders: 2 },
      { quantity: 300, pricePaise: 145450, orders: 2 },
      { quantity: 100, pricePaise: 145500, orders: 1 }
    ]
    const buf = frame([
      fullPacket({
        token: 408065, // INFY (segment 1)
        ltp: 145210,
        ltq: 50,
        atp: 145000,
        vol: 1234567,
        buyQty: 250000,
        sellQty: 180000,
        open: 144000,
        high: 146000,
        low: 143500,
        close: 144500,
        ltt: 1719792000,
        oi: 54321,
        oiHi: 60000,
        oiLo: 50000,
        ts: 1719792005,
        depth
      })
    ])

    const [t] = parseBinary(buf)
    expectValidKiteTick(t)
    expect(t.mode).toBe('full')
    expect(t.instrument_token).toBe(408065)
    expect(t.last_price).toBeCloseTo(1452.1, 2)
    expect(t.last_traded_quantity).toBe(50)
    expect(t.average_traded_price).toBeCloseTo(1450.0, 2)
    expect(t.volume_traded).toBe(1234567)
    expect(t.total_buy_quantity).toBe(250000)
    expect(t.total_sell_quantity).toBe(180000)
    expect(t.ohlc).toEqual({ open: 1440, high: 1460, low: 1435, close: 1445 })
    expect(t.change).toBeCloseTo(0.4913, 3) // (1452.10 − 1445.00) / 1445.00 × 100
    expect(t.oi).toBe(54321)
    expect(t.last_trade_time?.getTime()).toBe(1719792000 * 1000)
    expect(t.exchange_timestamp?.getTime()).toBe(1719792005 * 1000)
    expect(t.depth?.buy).toHaveLength(5)
    expect(t.depth?.sell).toHaveLength(5)
    expect(t.depth?.buy[0]).toEqual({ price: 1452.0, quantity: 1000, orders: 5 })
    expect(t.depth?.sell[0]).toEqual({ price: 1453.0, quantity: 900, orders: 4 })
  })

  it('parses a QUOTE (44-byte) packet without depth or timestamps', () => {
    const b = new Uint8Array(44)
    const dv = new DataView(b.buffer)
    dv.setInt32(0, NSE_EQ)
    dv.setInt32(4, 294215)
    dv.setInt32(8, 10)
    dv.setInt32(12, 294000)
    dv.setInt32(16, 999)
    dv.setInt32(20, 1)
    dv.setInt32(24, 2)
    dv.setInt32(28, 290000)
    dv.setInt32(32, 295000)
    dv.setInt32(36, 289000)
    dv.setInt32(40, 291000)
    const [t] = parseBinary(frame([b]))
    expect(t.mode).toBe('quote')
    expect(t.last_price).toBeCloseTo(2942.15, 2)
    expect(t.depth).toBeUndefined()
    expect(t.exchange_timestamp).toBeUndefined()
  })

  it('parses multiple packets in one frame, in order', () => {
    const ticks = parseBinary(frame([ltpPacket(111, 10000), ltpPacket(222, 20000)]))
    expect(ticks.map((t) => t.instrument_token)).toEqual([111, 222])
  })

  it('returns [] for an empty (0-packet) frame', () => {
    expect(parseBinary(frame([]))).toEqual([])
  })

  it('does not throw on a truncated frame', () => {
    const buf = frame([ltpPacket(111, 10000)])
    const truncated = buf.slice(0, buf.byteLength - 2)
    expect(() => parseBinary(truncated)).not.toThrow()
  })

  it('applies the segment-specific price divisor (CDS segment → 1e7)', () => {
    const cdsToken = 0x103 // (token & 0xff) === 3
    const [t] = parseBinary(frame([ltpPacket(cdsToken, 750000000)]))
    expect(t.last_price).toBeCloseTo(75.0, 4)
  })
})

