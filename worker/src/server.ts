import { AndroidManager } from './android-manager.js'
import { getConfig } from './config.js'
import { ProfileStore } from './store.js'
import { createApp } from './app.js'
const config = getConfig()
const manager = new AndroidManager(config, new ProfileStore(config.profileDir, config.encryptionKey))
await manager.init()
const server = createApp(config, manager).listen(config.port, config.host, () => {
  console.log(`Nexo Worker: http://${config.host}:${config.port}`)
  console.log(`Mode: ${config.dryRun ? 'SIMULATION (no real Android operations)' : 'devices'}`)
})
server.on('error', error => { console.error(error.message); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref() })
