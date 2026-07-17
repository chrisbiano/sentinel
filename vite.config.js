import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A unique id per build. Baked into the app bundle (__BUILD_ID__) and also
// written to /version.json, so a running client can tell when a newer build
// has shipped and reload itself. See src/lib/updater.js.
const BUILD_ID = String(Date.now())

// Emits dist/version.json alongside the bundle at build time.
function emitVersion() {
  return {
    name: 'emit-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: BUILD_ID }),
      })
    },
  }
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), emitVersion()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    allowedHosts: ['.trycloudflare.com']
  }
})
