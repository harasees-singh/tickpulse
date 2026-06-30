import { Icon } from '../Icon'
import { session, useMock } from '../../core/session'

// Profile — the logged-in user's Zerodha session, and the single Logout.
export default function Profile() {
  const s = () => session()
  const status = () => (useMock() ? 'Demo (dev)' : s()?.connected ? 'Connected · Live' : 'Disconnected')
  return (
    <div class="settings">
      <div class="content-head">
        <div>
          <h2 class="content-title">Profile</h2>
          <p class="content-sub">Your Zerodha connection and session.</p>
        </div>
      </div>
      <div class="settings-card">
        <div class="setting-row">
          <div class="setting-label"><span>User</span><small>Signed-in account name.</small></div>
          <div class="setting-control"><span class="setting-val">{s()?.user_name ?? '—'}</span></div>
        </div>
        <div class="setting-row">
          <div class="setting-label"><span>Account ID</span></div>
          <div class="setting-control"><span class="setting-val">{s()?.user_id ?? '—'}</span></div>
        </div>
        <div class="setting-row">
          <div class="setting-label"><span>Broker</span></div>
          <div class="setting-control"><span class="setting-val">Zerodha Kite</span></div>
        </div>
        <div class="setting-row">
          <div class="setting-label"><span>Connection</span></div>
          <div class="setting-control"><span class="setting-val">{status()}</span></div>
        </div>
        <div class="setting-actions">
          <span class="setting-note">Signing out clears your Zerodha session cookie. Your saved settings stay in this browser.</span>
          <a class="ghost-btn" href="/auth/logout"><Icon n="logout" /> Logout</a>
        </div>
      </div>
    </div>
  )
}

