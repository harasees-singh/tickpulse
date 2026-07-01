import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Icon } from './Icon'
import { symbols, ensureSlot, addScannerStock, activeScannerTokens } from '../core/store'
import { subscribeSettings } from '../core/settings'

interface ProxyRow { instrument_token: number; tradingsymbol: string; name: string; exchange: string }
interface Item { name: string; sub: string; tracked: boolean; token?: number; exch: string }

// Module-level open state so the topnav search trigger (or any other caller)
// can pop the palette without prop drilling. `mode` decides what selecting a row
// does: 'search' → open Analytics · 'add' → add it to the scanner watchlist.
type PaletteMode = 'search' | 'add'
const [paletteOpen, setPaletteOpen] = createSignal(false)
const [paletteMode, setPaletteMode] = createSignal<PaletteMode>('search')
export function openPalette(mode: PaletteMode = 'search') { setPaletteMode(mode); setPaletteOpen(true) }
export function closePalette() { setPaletteOpen(false) }

// Mac vs non-Mac shortcut display (⌘K vs Ctrl K). Exposed as an array so the
// topnav can render each key as a separate <kbd> cap (Spotify-style).
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
export const SHORTCUT_KEYS: [string, string] = IS_MAC ? ['⌘', 'K'] : ['Ctrl', 'K']
export const SHORTCUT_LABEL = SHORTCUT_KEYS.join(IS_MAC ? '' : ' ')

// Spotify-style command palette: ⌘K / Ctrl+K from anywhere → search every
// tradable symbol, ↑↓ to navigate, Enter to open Analytics, Esc to close.
export function CommandPalette() {
  const open = paletteOpen
  const setOpen = setPaletteOpen
  const [q, setQ] = createSignal('')
  const [proxy, setProxy] = createSignal<ProxyRow[]>([])
  const [cursor, setCursor] = createSignal(0)
  const navigate = useNavigate()
  let inputEl: HTMLInputElement | undefined

  // Bumped on any settings change so the "in scanner" state stays live while the
  // palette is open in add-mode (nameToIdx / watchlist aren't reactive sources).
  const [memberVer, setMemberVer] = createSignal(0)
  onCleanup(subscribeSettings(() => setMemberVer((v) => v + 1)))

  // Global ⌘K / Ctrl+K
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        open() ? setOpen(false) : openPalette('search') // ⌘K always opens in search mode
      } else if (e.key === 'Escape' && open()) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  // Auto-focus + reset on open
  function focusInput() {
    setCursor(0)
    setProxy([])
    setQ('')
    queueMicrotask(() => inputEl?.focus())
  }

  // Debounced live search for non-universe instruments (NSE only).
  let proxyTimer: ReturnType<typeof setTimeout> | undefined
  function onQuery(v: string) {
    setQ(v)
    setCursor(0)
    clearTimeout(proxyTimer)
    if (v.trim().length < 2) {
      setProxy([])
      return
    }
    proxyTimer = setTimeout(async () => {
      try {
        const r = await fetch('/auth/instruments?exchange=NSE&limit=15&q=' + encodeURIComponent(v.trim()))
        setProxy(await r.json())
      } catch {
        setProxy([])
      }
    }, 180)
  }

  // Items: local matches first, then proxy rows that aren't already tracked.
  // In add-mode, "tracked" means "already in the scanner watchlist".
  const items = createMemo<Item[]>(() => {
    memberVer() // re-evaluate scanner membership on add/remove
    const addMode = paletteMode() === 'add'
    const inScanner = activeScannerTokens()
    const query = q().trim().toUpperCase()
    const local: Item[] = symbols
      .filter((s) => !query || s.name.toUpperCase().includes(query))
      .slice(0, 40)
      .map((s) => {
        const member = inScanner.has(s.token)
        return {
          name: s.name,
          sub: addMode ? (member ? s.exch + ' • In scanner' : s.exch + ' • Tap to add') : s.exch + ' • Tracked',
          tracked: addMode ? member : true,
          token: s.token,
          exch: s.exch
        }
      })
    const localNames = new Set(local.map((i) => i.name))
    const remote: Item[] = proxy()
      .filter((r) => !localNames.has(r.tradingsymbol))
      .map((r) => ({
        name: r.tradingsymbol,
        sub: r.exchange + (r.name ? ' • ' + r.name : ''),
        tracked: false,
        token: r.instrument_token,
        exch: r.exchange
      }))
    return [...local, ...remote]
  })

  function select(it: Item) {
    if (paletteMode() === 'add') {
      // Add to the scanner watchlist and stay open so several can be added in a
      // row; the row flips to "In scanner" via memberVer.
      if (it.token) {
        addScannerStock({ token: it.token, name: it.name, exch: it.exch })
        setMemberVer((v) => v + 1)
      }
      setQ('')
      setProxy([])
      setCursor(0)
      queueMicrotask(() => inputEl?.focus())
      return
    }
    // search-mode (default): register if needed, then open Analytics.
    if (!it.tracked && it.token) ensureSlot({ token: it.token, name: it.name, exch: it.exch })
    setOpen(false)
    navigate('/analytics/' + it.name)
  }

  function onListKey(e: KeyboardEvent) {
    const list = items()
    if (!list.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => (c + 1) % list.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (c - 1 + list.length) % list.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = list[cursor()]
      if (it) select(it)
    }
  }

  // Refocus + reset whenever the palette opens.
  createEffect(() => {
    if (open()) focusInput()
  })

  return (
    <Show when={open()}>
      <div class="cmdk-backdrop" onClick={() => setOpen(false)}>
        <div class="cmdk" role="dialog" aria-label={paletteMode() === 'add' ? 'Add symbols to scanner' : 'Search symbols'} onClick={(e) => e.stopPropagation()} onKeyDown={onListKey}>
          <div class="cmdk-search">
            <Icon n={paletteMode() === 'add' ? 'add_circle' : 'search'} />
            <input
              ref={inputEl}
              type="text"
              placeholder={paletteMode() === 'add' ? 'Add stocks to your scanner…' : 'Search symbols…'}
              value={q()}
              onInput={(e) => onQuery(e.currentTarget.value)}
            />
            <span class="cmdk-kbd">ESC</span>
          </div>
          <div class="cmdk-list">
            <Show when={items().length} fallback={<div class="cmdk-empty">No matches{q().trim().length < 2 ? ' — type to search live instruments' : ''}.</div>}>
              <For each={items()}>
                {(it, i) => (
                  <div
                    class="cmdk-item"
                    classList={{ active: i() === cursor() }}
                    onMouseEnter={() => setCursor(i())}
                    onClick={() => select(it)}
                  >
                    <Icon n="show_chart" />
                    <div class="cmdk-item-main">
                      <span class="cmdk-item-name">{it.name}</span>
                      <span class="cmdk-item-sub">{it.sub}</span>
                    </div>
                    <Show when={!it.tracked} fallback={<Show when={paletteMode() === 'add'}><span class="cmdk-added">✓ In scanner</span></Show>}>
                      <span class="cmdk-add">＋ Add</span>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
          <div class="cmdk-foot">
            <span><span class="kbd-row"><span class="cmdk-kbd">↑</span><span class="cmdk-kbd">↓</span></span> navigate</span>
            <span><span class="cmdk-kbd">⏎</span> {paletteMode() === 'add' ? 'add' : 'open'}</span>
            <span><span class="kbd-row"><span class="cmdk-kbd">{SHORTCUT_KEYS[0]}</span><span class="cmdk-kbd">{SHORTCUT_KEYS[1]}</span></span> toggle</span>
          </div>
        </div>
      </div>
    </Show>
  )
}


