import { describe, it, expect } from 'vitest'
import { HELP, helpText, type HelpId } from '../core/help'

describe('help — copy registry', () => {
  const ids = Object.keys(HELP) as HelpId[]

  it('has non-empty label / how / means for every id', () => {
    for (const id of ids) {
      const e = HELP[id]
      expect(e.label.trim().length, `${id}.label`).toBeGreaterThan(0)
      expect(e.how.trim().length, `${id}.how`).toBeGreaterThan(0)
      expect(e.means.trim().length, `${id}.means`).toBeGreaterThan(0)
    }
  })

  it('helpText formats every entry as "How: … · Means: …"', () => {
    for (const id of ids) {
      expect(helpText(id)).toBe(`How: ${HELP[id].how} · Means: ${HELP[id].means}`)
      expect(helpText(id)).toContain(' · Means: ')
    }
  })

  it('renders a known entry exactly', () => {
    expect(helpText('col.ltp')).toBe(
      'How: Last Traded Price — the price of the most recent trade. · Means: The live market price for the instrument right now.'
    )
  })
})

