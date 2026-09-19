import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AndroidManager } from '../src/android-manager.js'
import type { WorkerConfig } from '../src/config.js'
import { ProfileStore } from '../src/store.js'

test('creates, starts and stops an isolated profile in dry-run mode', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexo-worker-'))
  const config: WorkerConfig = {
    apiToken: 'a'.repeat(32), encryptionKey: 'b'.repeat(32), port: 8787, host: '127.0.0.1', dataDir,
    profileDir: path.join(dataDir, 'profiles'), logDir: path.join(dataDir, 'logs'),
    avdHome: path.join(dataDir, 'avd'), sdkRoot: '/opt/android-sdk',
    adbPath: '/opt/android-sdk/platform-tools/adb', emulatorPath: '/opt/android-sdk/emulator/emulator',
    avdManagerPath: '/opt/android-sdk/cmdline-tools/latest/bin/avdmanager',
    systemImage: 'system-images;android-35;google_apis_playstore;x86_64', deviceId: 'pixel_7_pro',
    platform: 'linux', headless: true, emulatorGpu: 'swiftshader_indirect', emulatorMemoryMb: 4096,
    emulatorCores: 4, emulatorHeapMb: 512, emulatorResolution: '720x1280', emulatorDensity: 320, dryRun: true,
  }
  const store = new ProfileStore(config.profileDir, config.encryptionKey)
  const manager = new AndroidManager(config, store)
  await manager.init()

  const created = await manager.create({ id: 'perfil-001', displayName: 'Perfil principal', proxy: { type: 'http', host: 'proxy.example', port: 8080, password: 'secret' } })
  assert.equal(created.status, 'created')
  assert.equal(created.proxy.password, '••••••••')

  const started = await manager.start('perfil-001')
  assert.equal(started.status, 'running')

  const stopped = await manager.stop('perfil-001')
  assert.equal(stopped.status, 'stopped')
  assert.equal((await manager.list()).length, 1)

  const stored = await fs.readFile(path.join(config.profileDir, 'perfil-001.json'), 'utf8')
  assert.equal(stored.includes('secret'), false)
  assert.equal(stored.includes('proxy.example'), false)
})
