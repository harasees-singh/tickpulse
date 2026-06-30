import { createSignal } from 'solid-js'
import { Icon } from '../Icon'
import { useTerminal } from '../terminal'
import { getSettings, updateSettings, type Theme } from '../../core/settings'
import { useMock, setMockEnabled } from '../../core/session'

// Settings — appearance (theme) + breakout thresholds (DEV_PLAN §2.5/§2.6),
// persisted via settings.ts (theme also drives core/theme.ts live).
export default function Settings() {
  const t = useTerminal()
  const [theme, setTheme] = createSignal<Theme>(getSettings().theme)
  function pickTheme(next: Theme) {
    setTheme(next)
    updateSettings({ theme: next })
  }
  // Dev-only: flip the data source. Reload so the gate + Shell re-init cleanly.
  function switchSource(mock: boolean) {
    if (mock === useMock()) return
    setMockEnabled(mock)
    location.reload()
  }
  return (
    <div class="settings">
      <div class="content-head">
        <div>
          <h2 class="content-title">Appearance</h2>
          <p class="content-sub">Theme is saved in this browser and applies instantly.</p>
        </div>
      </div>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-label"><span>Theme</span><small>Obsidian (dark) is the default; Daylight is the light alternative.</small></div>
          <div class="setting-control">
            <button class="ghost-btn" classList={{ on: theme() === 'obsidian' }} onClick={() => pickTheme('obsidian')}>
              <Icon n="dark_mode" /> Obsidian
            </button>
            <button class="ghost-btn" classList={{ on: theme() === 'daylight' }} onClick={() => pickTheme('daylight')}>
              <Icon n="light_mode" /> Daylight
            </button>
          </div>
        </div>
      </div>

      <div class="content-head" style={{ 'margin-top': '24px' }}>
        <div>
          <h2 class="content-title">Breakout Settings</h2>
          <p class="content-sub">Define what counts as a volume breakout. These thresholds drive the alerts, row glows and the Recent Breakouts log — saved in this browser.</p>
        </div>
      </div>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-label"><span><span class="dot info" /> Watch (mild flag)</span><small>Slightly unusual volume.</small></div>
          <div class="setting-control">
            <input type="range" min="1" max="8" step="0.1" value={t.thInfo()} onInput={(e) => t.onTh('info', parseFloat(e.currentTarget.value))} />
            <span class="setting-val">{t.thInfo().toFixed(1)}σ</span>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-label"><span><span class="dot warn" /> High</span><small>Notable surge in volume.</small></div>
          <div class="setting-control">
            <input type="range" min="1" max="10" step="0.1" value={t.thWarn()} onInput={(e) => t.onTh('warn', parseFloat(e.currentTarget.value))} />
            <span class="setting-val">{t.thWarn().toFixed(1)}σ</span>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-label"><span><span class="dot crit" /> Spike (breakout)</span><small>Critical alert + toast.</small></div>
          <div class="setting-control">
            <input type="range" min="1" max="12" step="0.1" value={t.thCrit()} onInput={(e) => t.onTh('crit', parseFloat(e.currentTarget.value))} />
            <span class="setting-val">{t.thCrit().toFixed(1)}σ</span>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-label"><span>Alert cooldown</span><small>Minimum gap between alerts per symbol.</small></div>
          <div class="setting-control">
            <input type="range" min="0" max="30" step="1" value={t.thCool() / 1000} onInput={(e) => t.onCooldown(parseFloat(e.currentTarget.value))} />
            <span class="setting-val">{(t.thCool() / 1000).toFixed(0)}s</span>
          </div>
        </div>
        <div class="setting-actions">
          <span class="setting-note">A <b>breakout</b> fires when a symbol's latest per-tick volume is ≥ <b>{t.thCrit().toFixed(1)}σ</b> above its recent average (z-score). Watch / High are softer tiers.</span>
          <button class="ghost-btn" onClick={t.resetBreakout}><Icon n="restart_alt" /> Reset defaults</button>
        </div>
      </div>

      {import.meta.env.DEV && (
        <>
          <div class="content-head" style={{ 'margin-top': '24px' }}>
            <div>
              <h2 class="content-title">Developer</h2>
              <p class="content-sub">Local-only tools — excluded from production builds.</p>
            </div>
          </div>
          <div class="settings-card">
            <div class="setting-row">
              <div class="setting-label"><span>Data source</span><small>Live Zerodha websocket vs the simulated mock feed (reloads on change).</small></div>
              <div class="setting-control">
                <button class="ghost-btn" classList={{ on: !useMock() }} onClick={() => switchSource(false)}><Icon n="cloud" /> Live</button>
                <button class="ghost-btn" classList={{ on: useMock() }} onClick={() => switchSource(true)}><Icon n="science" /> Mock</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

