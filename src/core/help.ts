// Single source of explanatory copy (DEV_PLAN §1.C + §4 "no undocumented
// numbers"). Framework-free so it can feed native `title=` attributes, the
// <InfoTip> ⓘ component, AND be unit-tested. Each entry renders as the design's
// "How: … · Means: …" line (DESIGN/DEV_PLAN §0).

export interface HelpEntry {
  label: string
  how: string
  means: string
}

export type HelpId =
  | 'col.symbol' | 'col.price' | 'col.ltp' | 'col.chg' | 'col.volume' | 'col.volSurge' | 'col.velocity'
  | 'col.flow' | 'col.turnover' | 'col.dayRange' | 'col.depth' | 'col.fresh'
  | 'widget.breadth' | 'widget.pressure' | 'widget.vwap' | 'widget.breakouts'
  | 'ws.ping' | 'ws.throughput' | 'ws.render' | 'conn'

// `satisfies` enforces exhaustiveness (a missing HelpId is a compile error) while
// keeping the literal keys for `helpText`.
export const HELP = {
  'col.symbol': {
    label: 'Symbol',
    how: "The instrument's Zerodha tradingsymbol with its exchange segment.",
    means: 'Which stock this row tracks and where it trades.'
  },
  'col.price': {
    label: 'Price',
    how: 'Intraday price line vs the previous close (grey dotted) and day VWAP (blue dotted).',
    means: 'Green above the prior close, red below; above VWAP means buyers are in control.'
  },
  'col.ltp': {
    label: 'LTP',
    how: 'Last Traded Price — the price of the most recent trade.',
    means: 'The live market price for the instrument right now.'
  },
  'col.chg': {
    label: 'Chg%',
    how: '(LTP − previous-day close) ÷ previous close × 100.',
    means: 'Up or down on the day — the same basis Kite/Groww show.'
  },
  'col.volume': {
    label: 'Current Volume',
    how: 'Cumulative shares traded so far today (volume_traded), in K / L / Cr.',
    means: 'Total participation in the stock since the open.'
  },
  'col.volSurge': {
    label: 'Vol Surge · Flow',
    how: "RVOL (×) = latest per-tick volume ÷ its recent average; the bar's green/red split is buyer- vs seller-initiated volume (tick rule).",
    means: "Surge magnitude that drives alerts, plus whether it's buying (▲) or selling (▼)."
  },
  'col.velocity': {
    label: 'Velocity',
    how: 'Per-tick traded volume over the last ~48 ticks.',
    means: 'Taller bars mean bursts of trading activity.'
  },
  'col.flow': {
    label: 'Vol Surge · Flow',
    how: "RVOL (×) = latest per-tick volume ÷ its recent average; the bar's green/red split is buyer- vs seller-initiated volume (tick rule).",
    means: "Surge magnitude that drives alerts, plus whether it's buying (▲) or selling (▼)."
  },
  'col.turnover': {
    label: 'Turnover',
    how: 'Day turnover ≈ VWAP × cumulative volume, shown in ₹ Cr / L.',
    means: 'How much money has actually changed hands — liquidity, not just share count.'
  },
  'col.dayRange': {
    label: 'Day Range',
    how: "LTP's position between the day's low and high; ticks mark VWAP (blue) and the open (grey).",
    means: 'Where price sits in its intraday range — near the high = strength.'
  },
  'col.depth': {
    label: 'Depth',
    how: 'Buy share of the 5-level order book (total bid qty ÷ bid+ask qty). Hover for the ladder.',
    means: 'Which side of the book is heavier right now.'
  },
  'col.fresh': {
    label: 'Fresh',
    how: 'Time since this symbol last ticked (dot: green fresh · amber slowing · grey stale).',
    means: 'How live the row is — stale rows may be illiquid or after-hours.'
  },
  'widget.breadth': {
    label: 'Watchlist Breadth',
    how: 'Count of symbols up (Advance) vs down (Decline) on the day across the tracked instruments.',
    means: 'Is the watchlist broadly rising or falling — the A/D ratio summarizes it.'
  },
  'widget.pressure': {
    label: 'Order Book Pressure',
    how: 'Aggregate pending buy vs sell quantity (total_buy/total_sell_quantity) summed across the watchlist.',
    means: 'Which side of the book is heavier — bullish when buying dominates.'
  },
  'widget.vwap': {
    label: 'VWAP Positioning',
    how: 'Share of tracked symbols whose last price is above their day VWAP, recomputed each second.',
    means: 'Breadth of intraday strength — a high % above VWAP means buyers are broadly in control.'
  },
  'widget.breakouts': {
    label: 'Recent Volume Breakouts',
    how: 'Live log of symbols whose volume z-score crossed a breakout threshold, newest first.',
    means: 'Where unusual volume just fired, with its RVOL × and time.'
  },
  'ws.ping': {
    label: 'WS Ping',
    how: 'Round-trip ping through the live data pipeline (worker↔UI); the WebSocket ping/pong RTT on the real socket.',
    means: 'Pipeline latency — lower is a healthier connection.'
  },
  'ws.throughput': {
    label: 'Throughput',
    how: 'Ticks ingested per second across all subscribed instruments.',
    means: 'How busy the feed is right now.'
  },
  'ws.render': {
    label: 'Render',
    how: 'Frames per second of the canvas/DOM render pump.',
    means: 'UI smoothness — 60 fps ideal; sustained low fps signals jank.'
  },
  conn: {
    label: 'Connection',
    how: 'A tiny ping to /auth/ping every 4s — the round-trip is smoothed (EWMA) and mapped to bars (<60ms excellent · <150 good · <400 fair · slower poor).',
    means: 'A real measurement of how snappy your network is to this server — not just a browser hint.'
  }
} satisfies Record<HelpId, HelpEntry>

/** Flatten an entry to the design's "How: … · Means: …" string (native title/aria). */
export function helpText(id: HelpId): string {
  const e = HELP[id]
  return `How: ${e.how} · Means: ${e.means}`
}

