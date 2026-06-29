// Deterministic instrument universe — imported by BOTH the worker (to generate
// ticks) and the main thread (to seed the store). No Math.random at module load
// so both sides agree on tokens, order and starting values.

export type Tier = 'L' | 'M' | 'S' // liquidity: Large / Mid / Small

export interface SymSpec {
  token: number
  name: string
  exch: string
  base: number // opening/reference price (₹)
  tier: Tier
  tickSize: number
  sigma: number // per-sqrt-second volatility
  theta: number // mean-reversion strength
  baseRps: number // ticks/sec under normal conditions
  qtyMedian: number // median trade size
  qtySigma: number // lognormal spread of trade size
  openingVolume: number // cumulative volume at session start
  band: number // circuit band (fraction)
}

// [name, basePrice, liquidityTier]
const RAW: [string, number, Tier][] = [
  ['RELIANCE', 2950, 'L'], ['TCS', 3900, 'L'], ['HDFCBANK', 1680, 'L'],
  ['INFY', 1520, 'L'], ['ICICIBANK', 1120, 'L'], ['HINDUNILVR', 2450, 'L'],
  ['SBIN', 820, 'L'], ['BHARTIARTL', 1380, 'L'], ['ITC', 435, 'L'],
  ['KOTAKBANK', 1750, 'L'], ['LT', 3550, 'L'], ['AXISBANK', 1150, 'L'],
  ['BAJFINANCE', 7100, 'L'], ['ASIANPAINT', 2900, 'L'], ['MARUTI', 12600, 'L'],
  ['SUNPHARMA', 1620, 'L'], ['TITAN', 3400, 'L'], ['ULTRACEMCO', 10800, 'L'],
  ['WIPRO', 460, 'M'], ['ONGC', 270, 'M'], ['NTPC', 360, 'L'],
  ['POWERGRID', 320, 'M'], ['NESTLEIND', 2500, 'L'], ['TATAMOTORS', 980, 'L'],
  ['TATASTEEL', 165, 'M'], ['JSWSTEEL', 920, 'M'], ['ADANIENT', 3100, 'L'],
  ['ADANIPORTS', 1430, 'L'], ['COALINDIA', 460, 'M'], ['HCLTECH', 1450, 'L'],
  ['TECHM', 1280, 'M'], ['GRASIM', 2450, 'M'], ['HINDALCO', 650, 'M'],
  ['DRREDDY', 6200, 'M'], ['CIPLA', 1500, 'M'], ['DIVISLAB', 4400, 'M'],
  ['BRITANNIA', 5200, 'M'], ['EICHERMOT', 4800, 'M'], ['HEROMOTOCO', 5400, 'M'],
  ['BAJAJ-AUTO', 9500, 'M'], ['BAJAJFINSV', 1650, 'L'], ['INDUSINDBK', 1450, 'M'],
  ['SBILIFE', 1500, 'M'], ['HDFCLIFE', 620, 'M'], ['ICICIPRULI', 600, 'S'],
  ['DMART', 4600, 'M'], ['PIDILITIND', 3000, 'M'], ['DABUR', 540, 'M'],
  ['GODREJCP', 1300, 'M'], ['MARICO', 620, 'S'], ['COLPAL', 2900, 'S'],
  ['BERGEPAINT', 540, 'S'], ['HAVELLS', 1800, 'M'], ['SIEMENS', 7000, 'M'],
  ['BOSCHLTD', 32000, 'S'], ['ABB', 7800, 'S'], ['SHREECEM', 26000, 'S'],
  ['AMBUJACEM', 620, 'M'], ['ACC', 2500, 'S'], ['VEDL', 440, 'M'],
  ['JINDALSTEL', 980, 'M'], ['SAIL', 130, 'S'], ['NMDC', 230, 'S'],
  ['GAIL', 230, 'M'], ['IOC', 170, 'M'], ['BPCL', 620, 'M'],
  ['HINDPETRO', 520, 'S'], ['PETRONET', 320, 'S'], ['TATAPOWER', 430, 'M'],
  ['ADANIGREEN', 1700, 'M'], ['ADANIPOWER', 700, 'M'], ['DLF', 870, 'M'],
  ['GODREJPROP', 2900, 'S'], ['OBEROIRLTY', 1900, 'S'], ['LICHSGFIN', 650, 'S'],
  ['BANDHANBNK', 190, 'M'], ['FEDERALBNK', 165, 'M'], ['IDFCFIRSTB', 78, 'M'],
  ['PNB', 125, 'M'], ['BANKBARODA', 270, 'M'], ['CANBK', 110, 'M'],
  ['AUBANK', 650, 'S'], ['CHOLAFIN', 1400, 'M'], ['MUTHOOTFIN', 1800, 'S'],
  ['PFC', 480, 'M'], ['RECLTD', 540, 'M'], ['ZOMATO', 200, 'L'],
  ['PAYTM', 450, 'M'], ['NYKAA', 180, 'M'], ['POLICYBZR', 1400, 'S'],
  ['IRCTC', 980, 'M'], ['INDIGO', 4300, 'M'], ['NAUKRI', 6500, 'S'],
  ['PERSISTENT', 5500, 'S'], ['LTIM', 5800, 'M'], ['MPHASIS', 2600, 'S'],
  ['COFORGE', 5600, 'S']
]

const SIGMA: Record<Tier, number> = { L: 0.0007, M: 0.0011, S: 0.0016 }
// Slow + watchable for the POC: ~1–2 ticks/sec/symbol.
const RPS: Record<Tier, number> = { L: 2, M: 1.5, S: 1 }
const QTY: Record<Tier, number> = { L: 900, M: 300, S: 80 }
const OPEN_VOL: Record<Tier, number> = { L: 4_000_000, M: 1_200_000, S: 300_000 }

// POC: keep only a handful of symbols so each one is easy to watch.
// Bump this (or remove the slice below) to stress-test hundreds of symbols.
export const UNIVERSE_SIZE = 5

const ALL: SymSpec[] = RAW.map(([name, base, tier], i) => ({
  token: 100001 + i,
  name,
  exch: 'NSE',
  base,
  tier,
  tickSize: 0.05,
  sigma: SIGMA[tier],
  theta: 0.1,
  baseRps: RPS[tier],
  qtyMedian: QTY[tier],
  qtySigma: 0.9,
  openingVolume: OPEN_VOL[tier] + i * 1234,
  band: 0.1
}))

export const UNIVERSE: SymSpec[] = ALL.slice(0, UNIVERSE_SIZE)

