import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fixture } from './helpers.js'
import { getConfig } from '../src/config.js'

test('invalid numeric and GPU configuration fail early',()=>{
  process.env.WORKER_API_TOKEN='a'.repeat(32)
  process.env.ANDROID_EMULATOR_MEMORY_MB='NaN';assert.throws(()=>getConfig());delete process.env.ANDROID_EMULATOR_MEMORY_MB
  process.env.ANDROID_EMULATOR_GPU='invalid';assert.throws(()=>getConfig());delete process.env.ANDROID_EMULATOR_GPU
  process.env.ANDROID_DRY_RUN='yes';assert.throws(()=>getConfig());delete process.env.ANDROID_DRY_RUN
})
test('deletion removes only the associated AVD and leaves other devices and backups intact',async t=>{
  const {manager,config}=await fixture(t)
  const a=await manager.create({id:'delete-one',displayName:'Delete one'}),b=await manager.create({id:'keep-one',displayName:'Keep one'})
  for(const p of [a,b]){await fs.mkdir(path.join(config.avdHome,`${p.avdName}.avd`));await fs.writeFile(path.join(config.avdHome,`${p.avdName}.ini`),'ini')}
  await manager.delete(a.id)
  assert.ok(await fs.stat(path.join(config.avdHome,`${b.avdName}.avd`)))
  await assert.rejects(fs.stat(path.join(config.avdHome,`${a.avdName}.avd`)))
})
test('backups are scoped to a profile and path traversal is rejected before touching files',async t=>{
  const {manager,store}=await fixture(t)
  await manager.create({id:'scope-one',displayName:'Scope one'})
  await assert.rejects(manager.restore('scope-one','../../escape'))
  await assert.rejects(store.get('../escape'))
})
