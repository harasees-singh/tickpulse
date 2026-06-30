import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  loadSettings, getSettings, updateSettings, resetSettings, saveSettings,
  subscribeSettings, SCHEMA_VERSION, SETTINGS_DEFAULTS, type Settings
} from '../core/settings'
import { installMemoryLocalStorage } from './localStorageShim'

beforeEach(() => {
  installMemoryLocalStorage() // fresh, isolated storage per test
  loadSettings() // re-read the (empty) store → defaults
})

afterEach(() => {
  // Cancel any pending debounced write so a stray timer can't touch the next test.
  saveSettings()
})

describe('settings — versioned tickpulse.settings persistence', () => {
  it('returns defaults when storage is empty', () => {
    expect(loadSettings()).toEqual(SETTINGS_DEFAULTS)
    expect(getSettings().version).toBe(SCHEMA_VERSION)
    expect(getSettings().theme).toBe('obsidian')
  })

  it('round-trips an update through localStorage (survives a reload)', () => {
    updateSettings({ theme: 'daylight', breakout: { crit: 7 } })
    saveSettings()

    const reloaded = loadSettings()
    expect(reloaded.theme).toBe('daylight')
    expect(reloaded.breakout.crit).toBe(7)
    // untouched fields keep their defaults (partial deep-merge)
    expect(reloaded.breakout.info).toBe(SETTINGS_DEFAULTS.breakout.info)
    expect(reloaded.breakout.warn).toBe(SETTINGS_DEFAULTS.breakout.warn)
  })

  it('migrates a legacy tickpulse.breakout blob into settings.breakout (v0 → v1)', () => {
    localStorage.setItem('tickpulse.breakout', JSON.stringify({ info: 1.1, crit: 9 }))

    const s = loadSettings()
    expect(s.version).toBe(SCHEMA_VERSION)
    expect(s.breakout.info).toBe(1.1)
    expect(s.breakout.crit).toBe(9)
    // keys absent from the legacy blob keep the new defaults
    expect(s.breakout.warn).toBe(SETTINGS_DEFAULTS.breakout.warn)
    expect(s.breakout.cooldownMs).toBe(SETTINGS_DEFAULTS.breakout.cooldownMs)
  })

  it('forward-merges a partial/old-shape settings blob over defaults', () => {
    // a stored v1 blob missing newer fields (e.g. alerts) must gain them
    localStorage.setItem('tickpulse.settings', JSON.stringify({ version: 1, theme: 'daylight' }))

    const s = loadSettings()
    expect(s.theme).toBe('daylight') // stored value kept
    expect(s.alerts).toEqual(SETTINGS_DEFAULTS.alerts) // filled from defaults
    expect(s.breakout).toEqual(SETTINGS_DEFAULTS.breakout)
    expect(s.watchlists).toEqual(SETTINGS_DEFAULTS.watchlists)
  })

  it('falls back to defaults on corrupt JSON without throwing', () => {
    localStorage.setItem('tickpulse.settings', '{ not valid json')
    expect(() => loadSettings()).not.toThrow()
    expect(getSettings()).toEqual(SETTINGS_DEFAULTS)
  })

  it('reset() restores defaults and rewrites storage', () => {
    updateSettings({ theme: 'daylight', pinned: [101, 202] })
    expect(getSettings().pinned).toEqual([101, 202])

    resetSettings()
    expect(getSettings()).toEqual(SETTINGS_DEFAULTS)
    expect(loadSettings()).toEqual(SETTINGS_DEFAULTS) // persisted, not just in-memory
  })

  it('replaces arrays wholesale but deep-merges nested objects', () => {
    updateSettings({ pinned: [1, 2, 3], alerts: { sound: true } })
    const s = getSettings()
    expect(s.pinned).toEqual([1, 2, 3]) // array replaced
    expect(s.alerts.sound).toBe(true) // nested key set
    expect(s.alerts.toast).toBe(SETTINGS_DEFAULTS.alerts.toast) // sibling kept
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    let calls = 0
    let last: Settings | null = null
    const unsub = subscribeSettings((s) => {
      calls++
      last = s
    })

    updateSettings({ theme: 'daylight' })
    expect(calls).toBe(1)
    expect(last!.theme).toBe('daylight')

    unsub()
    updateSettings({ theme: 'obsidian' })
    expect(calls).toBe(1) // no longer notified
  })
})

