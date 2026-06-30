import { Router, Route, Navigate } from '@solidjs/router'
import { Show, onMount } from 'solid-js'
import Shell from './Shell'
import Scanner from './pages/Scanner'
import Dashboard from './pages/Dashboard'
import Marketwatch from './pages/Marketwatch'
import Analytics from './pages/Analytics'
import Alerts from './pages/Alerts'
import Settings from './pages/Settings'
import Profile from './pages/Profile'
import Login from './pages/Login'
import { getSettings } from '../core/settings'
import { session, canEnter, useMock, cleanupAuthParam } from '../core/session'

// App = auth gate + route table. The user must be authenticated (Zerodha) to
// reach the app; unauthenticated users see <Login>. `Shell` is the persistent
// layout (Router root) that owns the data wiring; pages render inside it.
export default function App() {
  onMount(cleanupAuthParam)
  return (
    <Show when={session() !== undefined || useMock()} fallback={<div class="auth-screen"><div class="auth-splash">Connecting…</div></div>}>
      <Show when={canEnter()} fallback={<Login />}>
        <Router root={Shell}>
          <Route path="/" component={() => <Navigate href={'/' + (getSettings().activeSection || 'scanner')} />} />
          <Route path="/scanner" component={Scanner} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/marketwatch" component={Marketwatch} />
          <Route path="/analytics/:symbol?" component={Analytics} />
          <Route path="/alerts" component={Alerts} />
          <Route path="/profile" component={Profile} />
          <Route path="/settings" component={Settings} />
          <Route path="*" component={() => <Navigate href="/scanner" />} />
        </Router>
      </Show>
    </Show>
  )
}
