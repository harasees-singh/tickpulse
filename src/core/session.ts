// Auth/session state (UI-only — never imported by the node test graph, so
// `import.meta.env` is safe here). Owns the ONE `/auth/session` fetch and the
// dev-only mock-feed flag. In production builds `import.meta.env.DEV` is
// statically false, so the entire mock path tree-shakes away.

import { createSignal } from 'solid-js'
import { getSettings, updateSettings, saveSettings, subscribeSettings } from './settings'

export interface SessionInfo {
  connected: boolean
  api_key?: string
  access_token?: string
  user_id?: string
  user_name?: string
  reason?: string
}

const [session, setSession] = createSignal<SessionInfo | undefined>(undefined) // undefined = loading
export { session }

// The OAuth redirect leaves a `?auth=<status>` marker — capture it once at load,
// before we strip it from the URL.
export const authStatus = new URLSearchParams(window.location.search).get('auth')

let inflight: Promise<void> | null = null
/** Fetch the Zerodha session once (deduped). */
export function loadSession(): Promise<void> {
  if (inflight) return inflight
  inflight = fetch('/auth/session', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((s: SessionInfo) => {
      setSession(s)
    })
    .catch(() => {
      setSession({ connected: false })
    })
  return inflight
}

/** Strip the post-OAuth `?auth=…` query without a navigation. */
export function cleanupAuthParam(): void {
  if (window.location.search.includes('auth=')) {
    history.replaceState({}, '', window.location.pathname)
  }
}

export function isAuthed(): boolean {
  const s = session()
  return !!s?.connected && !!s?.access_token
}

// --- dev-only mock feed ---------------------------------------------------
export const DEV = import.meta.env.DEV
const [mockEnabled, setMockSignal] = createSignal(getSettings().devMock)
export { mockEnabled }
subscribeSettings((s) => setMockSignal(s.devMock))

/** True only in dev AND when the dev chose the simulated feed. */
export function useMock(): boolean {
  return DEV && mockEnabled()
}

export function setMockEnabled(on: boolean): void {
  updateSettings({ devMock: on })
  saveSettings()
  setMockSignal(on)
}

/** Can the user enter the app? Authenticated, or a dev running the mock feed. */
export function canEnter(): boolean {
  return isAuthed() || useMock()
}

// Hydrate the session once at module load.
loadSession()

