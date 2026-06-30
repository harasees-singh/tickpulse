import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { symbols, ltp, chgPct, rvol, vwap, cumVol, depth, type SymMeta, type SortKey, type SortDir } from '../core/store'
import { register, unregister, type RowRefs } from '../core/render'
import { fmtPrice, fmtTurnover, fmtQty } from '../core/format'
import { helpText, type HelpId } from '../core/help'

const ROW_H = 56
const OVERSCAN = 6
const SPARK_H = 30

// Depth popover — one shared anchor (only one row is hovered at a time).
interface DepthPop { idx: number; x: number; y: number; above: boolean }
const [depthPop, setDepthPop] = createSignal<DepthPop | null>(null)

// Lightweight custom virtualization: only ~viewport rows exist in the DOM, each
// absolutely positioned. Keyed by stable SymMeta refs so scrolling reuses nodes.
export default function SymbolTable(props: { order: number[]; sort: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void; onOpen?: (meta: SymMeta) => void }) {
  let scroller!: HTMLDivElement
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewH, setViewH] = createSignal(560)

  onMount(() => {
    const ro = new ResizeObserver(() => setViewH(scroller.clientHeight))
    ro.observe(scroller)
    setViewH(scroller.clientHeight)
    onCleanup(() => ro.disconnect())
  })

  const total = () => props.order.length
  const start = createMemo(() => Math.max(0, Math.floor(scrollTop() / ROW_H) - OVERSCAN))
  const end = createMemo(() => Math.min(total(), Math.ceil((scrollTop() + viewH()) / ROW_H) + OVERSCAN))
  const visMetas = createMemo(() => {
    const o = props.order
    const s = start()
    const e = end()
    const arr: SymMeta[] = []
    for (let i = s; i < e; i++) arr.push(symbols[o[i]])
    return arr
  })

  // Cap visible height so the bento widgets sit below without a huge gap.
  const bodyHeight = () => Math.min(total() * ROW_H, 9 * ROW_H)

  // Sortable column header. key=null → not sortable (e.g. the Spark viz).
  const th = (label: string, key: SortKey | null, help: HelpId, num = false) => (
    <div
      class={num ? 'num' : undefined}
      classList={{ sortable: !!key, active: key !== null && props.sort === key }}
      title={helpText(help)}
      onClick={key ? () => props.onSort(key) : undefined}
    >
      {label}
      {key !== null && <span class="sort-caret">{props.sort === key ? (props.sortDir === 'asc' ? '▲' : '▼') : ''}</span>}
    </div>
  )

  return (
    <div class="lb">
      <div class="thead">
        {th('Symbol', 'symbol', 'col.symbol')}
        {th('LTP', 'price', 'col.ltp', true)}
        {th('Chg%', 'change', 'col.chg')}
        {th('Spark', null, 'col.price')}
        {th('Vol Surge · Flow', 'rvol', 'col.flow')}
        {th('Turnover', 'turnover', 'col.turnover', true)}
        {th('Day Range', 'vwapDist', 'col.dayRange')}
        {th('Depth', 'imbalance', 'col.depth')}
        {th('Fresh', 'fresh', 'col.fresh', true)}
      </div>
      <div class="tbody" ref={scroller} style={{ height: bodyHeight() + 'px', 'overflow-y': 'auto' }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div class="spacer" style={{ height: total() * ROW_H + 'px' }}>
          <For each={visMetas()}>
            {(meta, i) => <SymbolRow meta={meta} top={() => (start() + i()) * ROW_H} onOpen={props.onOpen} />}
          </For>
        </div>
      </div>
      <Show when={depthPop()}>{(p) => <DepthPopover pop={p()} />}</Show>
    </div>
  )
}

function SymbolRow(props: { meta: SymMeta; top: () => number; onOpen?: (meta: SymMeta) => void }) {
  let root!: HTMLDivElement
  let ltpEl!: HTMLDivElement
  let chgEl!: HTMLSpanElement
  let surgeEl!: HTMLSpanElement
  let surgeNum!: HTMLSpanElement
  let surgeArrow!: HTMLSpanElement
  let surgeBuy!: HTMLSpanElement
  let surgeSell!: HTMLSpanElement
  let turnoverEl!: HTMLDivElement
  let ltpDot!: HTMLSpanElement
  let vwapTick!: HTMLSpanElement
  let openTick!: HTMLSpanElement
  let depthBuy!: HTMLSpanElement
  let freshDot!: HTMLSpanElement
  let freshEl!: HTMLSpanElement
  let priceCanvas!: HTMLCanvasElement

  const i = props.meta.idx

  onMount(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const priceCtx = priceCanvas.getContext('2d')!

    // seed initial text so the first paint isn't blank (range/depth/fresh fill on
    // the first rAF frame).
    ltpEl.textContent = fmtPrice(ltp[i])
    const c = chgPct[i]
    chgEl.textContent = (c > 0 ? '+' : '') + c.toFixed(2) + '%'
    chgEl.className = 'chg-pill ' + (c > 0.01 ? 'up' : c < -0.01 ? 'down' : 'flat')
    surgeNum.textContent = rvol[i].toFixed(2) + 'x'
    turnoverEl.textContent = fmtTurnover(vwap[i] * cumVol[i])

    const refs: RowRefs = {
      idx: i, root, ltpEl, chgEl, surgeEl, surgeNum, surgeArrow, surgeBuy, surgeSell, turnoverEl,
      ltpDot, vwapTick, openTick, depthBuy, freshDot, freshEl,
      priceCtx, priceW: 80, priceH: SPARK_H,
      lastLtp: NaN, lastTurnover: NaN, lastTier: -1, lastFresh: '', lastAgeText: ''
    }

    // Responsive Spark canvas fills its (flexible) column.
    const sizeCanvas = () => {
      const w = Math.max(40, Math.round(priceCanvas.clientWidth))
      priceCanvas.width = w * dpr
      priceCanvas.height = SPARK_H * dpr
      priceCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      refs.priceW = w
      refs.priceH = SPARK_H
    }
    const ro = new ResizeObserver(sizeCanvas)
    ro.observe(priceCanvas)

    register(refs)
    onCleanup(() => {
      ro.disconnect()
      unregister(i)
    })
  })

  return (
    <div class="trow clickable" ref={root} onClick={() => props.onOpen?.(props.meta)} style={{ transform: `translateY(${props.top()}px)` }}>
      <div class="cell sym">
        <span class="sym-name">{props.meta.name}</span>
        <span class="sym-sub">{props.meta.exch} • EQ</span>
      </div>
      <div class="cell num ltp" ref={ltpEl} />
      <div class="cell"><span class="chg-pill flat" ref={chgEl} /></div>
      <div class="cell spark">
        <canvas ref={priceCanvas} style={{ width: '100%', height: SPARK_H + 'px' }} />
      </div>
      <div class="cell flow">
        <span class="surge-val up" ref={surgeEl}><span class="surge-num" ref={surgeNum} /><span class="surge-arrow" ref={surgeArrow} /></span>
        <span class="flow-track"><span class="flow-buy" ref={surgeBuy} /><span class="flow-sell" ref={surgeSell} /></span>
      </div>
      <div class="cell num turnover" ref={turnoverEl} />
      <div class="cell range">
        <span class="range-base" />
        <span class="range-open" ref={openTick} />
        <span class="range-vwap" ref={vwapTick} />
        <span class="range-ltp" ref={ltpDot} />
      </div>
      <div class="cell depth"
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const above = r.bottom > window.innerHeight - 180
          setDepthPop({ idx: i, x: r.left, y: above ? r.top : r.bottom, above })
        }}
        onMouseLeave={() => setDepthPop(null)}
        onClick={(e) => e.stopPropagation()}>
        <span class="depth-bar"><span class="depth-buy" ref={depthBuy} /></span>
      </div>
      <div class="cell num fresh">
        <span class="fresh-dot stale" ref={freshDot} />
        <span class="fresh-age" ref={freshEl} />
      </div>
    </div>
  )
}

// 5-level bid/ask ladder shown on Depth-cell hover. Reads the live depth[idx]
// snapshot, refreshed a few times a second WHILE OPEN only (never per frame).
function DepthPopover(props: { pop: DepthPop }) {
  const [refresh, setRefresh] = createSignal(0)
  onMount(() => {
    const id = setInterval(() => setRefresh((r) => r + 1), 300)
    onCleanup(() => clearInterval(id))
  })
  const book = () => {
    refresh() // track for live updates
    return depth[props.pop.idx]
  }
  return (
    <div class="depth-pop" classList={{ above: props.pop.above }} style={{ left: props.pop.x + 'px', top: props.pop.y + 'px' }}>
      <div class="depth-pop-head">{symbols[props.pop.idx].name} · Order Depth</div>
      <Show when={book()} fallback={<div class="depth-pop-empty">No depth data yet.</div>}>
        <div class="depth-pop-grid">
          <div class="dp-col">
            <div class="dp-th">Bids</div>
            <For each={book()!.buy.slice(0, 5)}>
              {(lvl) => <div class="dp-row"><span class="dp-q">{fmtQty(lvl.quantity)}</span><span class="dp-p up">{fmtPrice(lvl.price)}</span></div>}
            </For>
          </div>
          <div class="dp-col">
            <div class="dp-th">Asks</div>
            <For each={book()!.sell.slice(0, 5)}>
              {(lvl) => <div class="dp-row"><span class="dp-p down">{fmtPrice(lvl.price)}</span><span class="dp-q">{fmtQty(lvl.quantity)}</span></div>}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

