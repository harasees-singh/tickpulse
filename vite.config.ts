import { defineConfig, loadEnv } from 'vite'
import solid from 'vite-plugin-solid'
import { kiteAuth } from './server/kiteAuth'

// POC uses postMessage (not SharedArrayBuffer), so no COOP/COEP headers are
// required here. When you move stats into a SharedArrayBuffer (see DESIGN.md
// §9), add the cross-origin-isolation headers back in.
export default defineConfig(({ mode }) => {
  // Empty prefix loads ALL vars (incl. non-VITE_ secrets) from .env / .env.local
  // for the dev-only auth plugin. These never reach the client bundle.
  const env = loadEnv(mode, process.cwd(), '')
  // Accept either API_KEY/API_SECRET or the KITE_-prefixed variants.
  const apiKey = env.API_KEY || env.KITE_API_KEY || ''
  const apiSecret = env.API_SECRET || env.KITE_API_SECRET || ''
  return {
    plugins: [solid(), kiteAuth({ apiKey, apiSecret })],
    // Match the registered redirect URL host so the session cookie lines up.
    server: { host: '127.0.0.1', port: 5173, open: true }
  }
})

