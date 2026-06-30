import { Show } from 'solid-js'
import { authStatus, setMockEnabled } from '../../core/session'

const MESSAGES: Record<string, string> = {
  config: 'Broker API keys are not configured on the server.',
  denied: 'Sign-in was cancelled.',
  failed: 'Sign-in failed — please try again.',
  error: 'Something went wrong during sign-in.'
}

// Login gate — shown when there's no Zerodha session. Sign-in is a full-page
// redirect to Kite OAuth (server route). The "Demo" button is DEV-only.
export default function Login() {
  return (
    <div class="auth-screen">
      <div class="auth-card">
        <img class="auth-logo" src="/tickpulse-logo.svg" alt="TickPulse" />
        <h1>TickPulse</h1>
        <p class="auth-sub">Real-time NSE volume &amp; order-flow terminal.</p>

        <Show when={authStatus && MESSAGES[authStatus]}>
          <div class="auth-msg">{MESSAGES[authStatus!]}</div>
        </Show>

        <button class="btn-primary auth-btn" onClick={() => (window.location.href = '/auth/login')}>
          Sign in with Zerodha
        </button>
        <p class="auth-note">You'll be redirected to Zerodha Kite to authorize this session.</p>

        {import.meta.env.DEV && (
          <button class="ghost-btn auth-demo" onClick={() => setMockEnabled(true)} title="Enter with the simulated feed (developer only)">
            Continue in Demo mode (dev)
          </button>
        )}
      </div>
    </div>
  )
}

