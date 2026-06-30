// Number formatting (Indian numbering + L/Cr volume units for NSE intuitiveness).

export function fmtPrice(v: number): string {
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtQty(v: number): string {
  return Math.round(v).toLocaleString('en-IN')
}

export function fmtVol(v: number): string {
  if (v >= 1e7) return (v / 1e7).toFixed(2) + ' Cr'
  if (v >= 1e5) return (v / 1e5).toFixed(2) + ' L'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(Math.round(v))
}

// Day turnover in ₹ with Cr / L / K units (NSE-intuitive).
export function fmtTurnover(v: number): string {
  if (v >= 1e7) return '₹' + Math.round(v / 1e7).toLocaleString('en-IN') + ' Cr'
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(1) + ' L'
  if (v >= 1e3) return '₹' + Math.round(v / 1e3) + 'K'
  return '₹' + Math.round(v)
}

// Compact "freshness" age (now / 12s / 3m / 1h) for the Scanner Fresh column.
export function fmtAge(ms: number): string {
  if (ms < 1500) return 'now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm'
  return Math.floor(m / 60) + 'h'
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

