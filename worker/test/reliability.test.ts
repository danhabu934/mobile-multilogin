import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import test from 'node:test'
import { fixture } from './helpers.js'
import { resourceBudget, portAvailable } from '../src/android-manager.js'
import { createProfileSchema } from '../src/schemas.js'
import { createRequire } from 'node:module'
const input=(id:string)=>({id,displayName:id,proxy:{type:'none' as const}})

test('concurrent creation reserves unique ports, including former hash collisions',async t=>{
  const {manager}=await fixture(t)
  const profiles=await Promise.all(Array.from({length:40},(_,n)=>manager.create(input(`profile-${n}`))))
  assert.equal(new Set(profiles.map(p=>p.emulatorPort)).size,40)
  const duplicate=await Promise.allSettled([manager.create(input('duplicate')),manager.create(input('duplicate'))])
  assert.equal(duplicate.filter(x=>x.status==='fulfilled').length,1)
})
test('concurrent starts obey capacity and rejected operations do not poison queue',async t=>{
  const {manager}=await fixture(t)
  await Promise.all([manager.create(input('first')),manager.create(input('second'))])
  const starts=await Promise.allSettled([manager.start('first'),manager.start('second')])
  assert.equal(starts.filter(x=>x.status==='fulfilled').length,1)
  await manager.stop('first');assert.equal((await manager.start('second')).status,'running')
})
test('parallel writes are complete, encrypted and leave no temporary files',async t=>{
  const {manager,store,config}=await fixture(t)
  await manager.create(input('profile-save'))
  const profile=(await store.get('profile-save'))!
  await Promise.all(Array.from({length:50},(_,n)=>store.save({...profile,displayName:`version-${n}`,proxy:{type:'http',host:'proxy.example',port:8080,password:'private-value'}})))
  assert.equal((await store.get(profile.id))?.displayName,'version-49')
  const raw=await fs.readFile(path.join(config.profileDir,`${profile.id}.json`),'utf8')
  assert.ok(!raw.includes('private-value')); assert.ok(!raw.includes('proxy.example'))
  assert.equal((await fs.readdir(config.profileDir)).filter(x=>x.endsWith('.tmp')).length,0)
})
test('corrupt profiles are preserved and reported without hiding healthy profiles',async t=>{
  const {manager,store,config}=await fixture(t)
  await manager.create(input('healthy')); await fs.writeFile(path.join(config.profileDir,'broken.json'),'broken')
  assert.equal((await manager.list()).length,1);assert.equal(store.warnings.length,1)
  assert.equal(await fs.readFile(path.join(config.profileDir,'broken.json'),'utf8'),'broken')
  await assert.rejects(manager.create(input('new-one')),/ilegíveis/)
})
test('settings, image and model are applied per profile and updated when stopped',async t=>{
  const {manager}=await fixture(t)
  const settings={...manager.defaults(),memoryMb:2048,cores:2,cameraFront:'webcam0'}
  const p=await manager.create({...input('configured'),deviceId:'pixel_8',systemImage:'system-images;android-34;google_apis_playstore;x86_64',settings,group:'Videos'})
  assert.equal(p.settings.memoryMb,2048);assert.equal(p.deviceId,'pixel_8');assert.equal(p.group,'Videos')
  await manager.start(p.id);await assert.rejects(manager.update(p.id,{settings}),/Desligue/)
  await manager.stop(p.id);await manager.update(p.id,{displayName:'Edited'});assert.equal((await manager.get(p.id))?.displayName,'Edited')
})
test('external profiles cannot share devices, change network or delete physical storage',async t=>{
  const {manager}=await fixture(t)
  await manager.create({...input('external-one'),engine:'bluestacks',serial:'127.0.0.1:5555'})
  await assert.rejects(manager.create({...input('external-two'),engine:'physical',serial:'127.0.0.1:5555'}),/associado/)
  await assert.rejects(manager.update('external-one',{settings:manager.defaults()}),/motor externo/)
  await manager.delete('external-one');assert.equal(await manager.get('external-one'),null)
})
test('resource budget leaves host reserve and detects occupied ports',async()=>{
  assert.equal(resourceBudget(16384,5031,4096).allowed,false)
  assert.equal(resourceBudget(16384,5031,3072).allowed,true)
  const server=net.createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
  const port=(server.address() as net.AddressInfo).port
  try{assert.equal(await portAvailable(port),false)}finally{await new Promise<void>(r=>server.close(()=>r()))}
})
test('schema rejects unsupported proxies and command-like profile inputs',()=>{
  assert.equal(createProfileSchema.safeParse({...input('../escape')}).success,false)
  assert.equal(createProfileSchema.safeParse({...input('socks'),proxy:{type:'socks5',host:'host',port:1080}}).success,false)
  assert.equal(createProfileSchema.safeParse({...input('evil'),deviceId:'pixel & command'}).success,false)
})
test('CommonJS asset loads from compiled output and SQLite binary works',()=>{
  const require=createRequire(import.meta.url)
  const module=require('../dist/cookie-hydrator.cjs')
  assert.equal(typeof module.hydrateSerialGuarded,'function')
  const Database=require('better-sqlite3'), db=new Database(':memory:')
  assert.equal(db.prepare('SELECT 1 AS ok').get().ok,1);db.close()
})
