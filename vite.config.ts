import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// POC uses postMessage (not SharedArrayBuffer), so no COOP/COEP headers are
// required here. When you move stats into a SharedArrayBuffer (see DESIGN.md
// §9), add the cross-origin-isolation headers back in.
export default defineConfig({
  plugins: [solid()],
  server: { port: 5173, open: true }
})

