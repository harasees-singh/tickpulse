import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Icon } from '../Icon'
import { MarketGrid } from '../MarketGrid'
import {
  getSettings, subscribeSettings, setActiveWatchlist, createWatchlist, deleteWatchlist,
  addTokenToWatchlist, removeTokenFromWatchlist
} from '../../core/settings'
import { ensureSlot } from '../../core/store'
import { useMock } from '../../core/session'

interface SearchRow { instrument_token: number; tradingsymbol: string; name: string; exchange: string }

// Marketwatch (DEV_PLAN §2.3) — watchlist manager + NSE instrument search.
export default function Marketwatch() {
  const navigate = useNavigate()
  const [s, setS] = createSignal(getSettings())
  onMount(() => onCleanup(subscribeSettings(setS)))

  const lists = () => s().watchlists
  const activeId = () => s().activeWatchlist
  const active = () => lists().find((w) => w.id === activeId()) ?? lists()[0]
  const metaOf = (token: number) => s().watchlistMeta[token]

  // --- debounced instrument search ---
  const [q, setQ] = createSignal('')
  const [results, setResults] = createSignal<SearchRow[]>([])
  const [open, setOpen] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  function onSearch(value: string) {
    setQ(value)
    clearTimeout(timer)
    if (value.trim().length < 1) {
      setResults([])
      setOpen(false)
      return
    }
    timer = setTimeout(async () => {
      try {
        const r = await fetch('/auth/instruments?exchange=NSE&limit=12&q=' + encodeURIComponent(value.trim()))
        setResults(await r.json())
        setOpen(true)
      } catch {
        setResults([])
      }
    }, 220)
  }
  function add(row: SearchRow) {
    ensureSlot({ token: row.instrument_token, name: row.tradingsymbol, exch: row.exchange })
    addTokenToWatchlist(activeId(), row.instrument_token, { name: row.tradingsymbol, exch: row.exchange })
    setQ('')
    setResults([])
    setOpen(false)
  }

  function newList() {
    const name = prompt('New watchlist name')?.trim()
    if (name) createWatchlist(name)
  }
  function removeList(id: string) {
    if (confirm('Delete this watchlist?')) deleteWatchlist(id)
  }

  return (
    <div class="mw-page">
      <div class="content-head">
        <div>
          <h2 class="content-title">Marketwatch</h2>
          <p class="content-sub">Configurable watchlists — search NSE instruments and track them live.</p>
        </div>
      </div>

      <Show when={useMock()}>
        <div class="mw-note"><Icon n="info" /> Demo feed only streams the local universe — symbols added outside it show “—”. Switch to Live (Settings → Developer) for full data.</div>
      </Show>

      <div class="mw-layout">
        <aside class="mw-rail">
          <div class="mw-rail-head"><span>Watchlists</span><button class="icon-btn" title="New watchlist" onClick={newList}><Icon n="add_circle" /></button></div>
          <For each={lists()}>
            {(w) => (
              <div class="mw-list-item" classList={{ active: w.id === activeId() }} onClick={() => setActiveWatchlist(w.id)}>
                <span class="mw-list-name">{w.name}</span>
                <span class="mw-list-count">{w.tokens.length}</span>
                <button class="icon-btn mw-del" title="Delete" onClick={(e) => { e.stopPropagation(); removeList(w.id) }}><Icon n="delete" /></button>
              </div>
            )}
          </For>
        </aside>

        <div class="mw-main">
          <div class="mw-search">
            <div class="search-box">
              <Icon n="search" />
              <input
                type="text"
                placeholder="Search NSE instruments to add…"
                value={q()}
                onInput={(e) => onSearch(e.currentTarget.value)}
                onFocus={() => results().length && setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
              />
            </div>
            <Show when={open() && results().length}>
              <div class="mw-results">
                <For each={results()}>
                  {(row) => (
                    <div class="mw-result" onClick={() => add(row)}>
                      <span class="mw-result-sym">{row.tradingsymbol}</span>
                      <span class="mw-result-name">{row.name}</span>
                      <span class="mw-result-ex">{row.exchange}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <MarketGrid
            tokens={active()?.tokens ?? []}
            metaOf={metaOf}
            onOpen={(name) => navigate('/analytics/' + name)}
            onRemove={(token) => removeTokenFromWatchlist(activeId(), token)}
          />
        </div>
      </div>
    </div>
  )
}

