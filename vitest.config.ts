import { defineConfig } from 'vitest/config'

// Standalone test config (does NOT load the app's vite.config plugins) — the
// modules under test are plain TS, so esbuild + a node environment is enough.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})

