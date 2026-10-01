import { copyFileSync, mkdirSync } from 'node:fs'
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true })
// Keep the existing CommonJS cookie routine unchanged and load it only on demand.
copyFileSync(new URL('../src/cookie-hydrator.js', import.meta.url), new URL('../dist/cookie-hydrator.cjs', import.meta.url))
