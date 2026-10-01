import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { getConfig } from '../src/config.js'
import { AndroidManager } from '../src/android-manager.js'
import { ProfileStore } from '../src/store.js'
export async function fixture(t: TestContext, dryRun = true) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexo-test-'))
  t.after(() => fs.rm(dataDir, {recursive:true, force:true}))
  process.env.WORKER_API_TOKEN = 'a'.repeat(32)
  const config = { ...getConfig(), encryptionKey:'b'.repeat(32), dataDir, profileDir:path.join(dataDir,'profiles'), logDir:path.join(dataDir,'logs'), avdHome:path.join(dataDir,'avd'), sdkRoot:path.join(dataDir,'sdk'), dryRun }
  const store = new ProfileStore(config.profileDir,config.encryptionKey), manager = new AndroidManager(config,store)
  await manager.init()
  return {config,store,manager,dataDir}
}
