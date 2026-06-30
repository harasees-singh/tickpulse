// Kite instruments dump → slim, searchable JSON. The full CSV at
// https://api.kite.trade/instruments is PUBLIC (no access token), but large
// (tens of thousands of rows), so we parse it once, cache per day (memory +
// best-effort /tmp file), and serve a slim 5-field projection with a result cap.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

export interface SlimInstrument {
  instrument_token: number
  tradingsymbol: string
  name: string
  exchange: string
  segment: string
}

const INSTRUMENTS_URL = 'https://api.kite.trade/instruments'

// Kite CSV columns:
// 0 instrument_token, 1 exchange_token, 2 tradingsymbol, 3 name, 4 last_price,
// 5 expiry, 6 strike, 7 tick_size, 8 lot_size, 9 instrument_type, 10 segment, 11 exchange
const COL = { token: 0, tradingsymbol: 2, name: 3, segment: 10, exchange: 11 } as const

/** Quote-aware CSV line split (handles "a,b" fields and escaped "" quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** Parse the Kite instruments CSV into slim rows (skips header, garbage lines). */
export function parseInstrumentsCsv(csv: string): SlimInstrument[] {
  const lines = csv.split('\n')
  const out: SlimInstrument[] = []
  for (let i = 1; i < lines.length; i++) {
    let raw = lines[i]
    if (!raw) continue
    if (raw.charCodeAt(raw.length - 1) === 13) raw = raw.slice(0, -1) // strip trailing \r
    if (!raw.trim()) continue
    const f = splitCsvLine(raw)
    if (f.length < 12) continue
    const token = Number(f[COL.token])
    if (!Number.isFinite(token) || token <= 0) continue
    out.push({
      instrument_token: token,
      tradingsymbol: f[COL.tradingsymbol],
      name: f[COL.name],
      segment: f[COL.segment],
      exchange: f[COL.exchange]
    })
  }
  return out
}

export interface FilterOpts {
  q?: string
  exchange?: string
  limit?: number
}

/** Case-insensitive search on tradingsymbol/name, optional exchange, capped. */
export function filterInstruments(rows: SlimInstrument[], opts: FilterOpts = {}): SlimInstrument[] {
  const q = (opts.q ?? '').trim().toUpperCase()
  const ex = (opts.exchange ?? '').trim().toUpperCase()
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200))
  const out: SlimInstrument[] = []
  for (const r of rows) {
    if (ex && r.exchange.toUpperCase() !== ex) continue
    if (q && !r.tradingsymbol.toUpperCase().includes(q) && !r.name.toUpperCase().includes(q)) continue
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

// --- daily cache (memory + best-effort /tmp file) ---------------------------

let cache: { day: string; rows: SlimInstrument[] } | null = null
let inflight: Promise<SlimInstrument[]> | null = null

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function cacheFile(day: string): string {
  return join(tmpdir(), `tickpulse-instruments-${day}.json`)
}
async function loadFromDisk(day: string): Promise<SlimInstrument[] | null> {
  try {
    return JSON.parse(await readFile(cacheFile(day), 'utf8')) as SlimInstrument[]
  } catch {
    return null
  }
}
async function saveToDisk(day: string, rows: SlimInstrument[]): Promise<void> {
  try {
    await writeFile(cacheFile(day), JSON.stringify(rows))
  } catch {
    /* best effort — caching is an optimization, not a requirement */
  }
}

/** Get today's instruments (memory → disk → network), deduping concurrent calls. */
export async function getInstruments(fetchImpl: typeof fetch = fetch): Promise<SlimInstrument[]> {
  const day = today()
  if (cache && cache.day === day) return cache.rows
  if (inflight) return inflight
  inflight = (async () => {
    const disk = await loadFromDisk(day)
    if (disk) return disk
    const res = await fetchImpl(INSTRUMENTS_URL)
    if (!res.ok) throw new Error(`instruments fetch failed: ${res.status}`)
    const rows = parseInstrumentsCsv(await res.text())
    await saveToDisk(day, rows)
    return rows
  })()
  try {
    cache = { day, rows: await inflight }
    return cache.rows
  } finally {
    inflight = null
  }
}

