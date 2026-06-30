import { describe, it, expect } from 'vitest'
import { splitCsvLine, parseInstrumentsCsv, filterInstruments } from '../../server/instruments'

const HEADER =
  'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange'

describe('instruments — CSV parse + filter', () => {
  it('splitCsvLine handles quoted commas and escaped quotes', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
    expect(splitCsvLine('a,"b""c",d')).toEqual(['a', 'b"c', 'd'])
  })

  it('parses slim fields and skips the header row', () => {
    const csv = HEADER + '\n' + '738561,2885,RELIANCE,RELIANCE INDUSTRIES,2950,,,0.05,1,EQ,NSE,NSE\n'
    const rows = parseInstrumentsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      instrument_token: 738561,
      tradingsymbol: 'RELIANCE',
      name: 'RELIANCE INDUSTRIES',
      segment: 'NSE',
      exchange: 'NSE'
    })
  })

  it('handles quoted names with commas + CRLF, and skips garbage/short/blank lines', () => {
    const csv =
      HEADER + '\r\n' +
      '256265,1001,NIFTY50,"NIFTY 50, INDEX",0,,,0,0,EQ,INDICES,NSE\r\n' +
      'garbage,row\r\n' +
      'abc,1,BADTOKEN,Bad token,0,,,0,0,EQ,NSE,NSE\r\n' +
      '\r\n'
    const rows = parseInstrumentsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('NIFTY 50, INDEX')
    expect(rows[0].exchange).toBe('NSE')
  })

  it('filterInstruments matches q (case-insensitive), exchange, and caps limit', () => {
    const rows = [
      { instrument_token: 1, tradingsymbol: 'RELIANCE', name: 'Reliance Industries', segment: 'NSE', exchange: 'NSE' },
      { instrument_token: 2, tradingsymbol: 'TCS', name: 'Tata Consultancy', segment: 'NSE', exchange: 'NSE' },
      { instrument_token: 3, tradingsymbol: 'RELCAPITAL', name: 'Reliance Capital', segment: 'BSE', exchange: 'BSE' }
    ]
    expect(filterInstruments(rows, { q: 'rel' }).map((r) => r.instrument_token)).toEqual([1, 3])
    expect(filterInstruments(rows, { q: 'rel', exchange: 'NSE' }).map((r) => r.instrument_token)).toEqual([1])
    expect(filterInstruments(rows, { limit: 2 })).toHaveLength(2)
  })
})

