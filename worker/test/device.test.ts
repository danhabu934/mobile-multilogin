import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import type { AddressInfo } from 'node:net'
import { fixture } from './helpers.js'
import { createApp } from '../src/app.js'

test('device operations execute scoped ADB commands; full disk backup restores data and settings', {skip:process.platform==='win32'}, async t=>{
  const {config,store,manager,dataDir}=await fixture(t)
  const p=await manager.create({id:'device-profile',displayName:'Device',proxy:{type:'none'}})
  const adb=path.join(dataDir,'fake-adb'),state=path.join(dataDir,'state.json'),calls=path.join(dataDir,'calls.jsonl')
  await fs.writeFile(state,JSON.stringify({running:true,name:p.avdName}))
  await fs.writeFile(adb,`#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
const file=${JSON.stringify(state)},state=JSON.parse(fs.readFileSync(file));const cmd=args.slice(2).join(' ');
if(cmd==='emu avd name'){if(!state.running)process.exit(1);console.log(state.name+'\\nOK');}
else if(cmd==='emu kill'){state.running=false;fs.writeFileSync(file,JSON.stringify(state));}
else if(cmd==='shell getprop sys.boot_completed'){if(!state.running)process.exit(1);console.log('1');}
else if(cmd==='exec-out screencap -p'){process.stdout.write(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4KkAAAAASUVORK5CYII=','base64'));}
else if(cmd.startsWith('shell pm list packages'))console.log('package:com.example.app\\npackage:com.google.android.gms\\npackage:com.android.vending');
else if(cmd==='shell getprop')console.log('[ro.product.model]: [Test Phone]\\n[ro.build.version.release]: [15]\\n[ro.product.cpu.abilist]: [x86_64]');
else if(cmd.startsWith('install '))console.log('Success');
else console.log('OK');
`,{mode:0o755})
  config.dryRun=false;config.adbPath=adb
  const avd=path.join(config.avdHome,`${p.avdName}.avd`);await fs.mkdir(avd);await fs.writeFile(path.join(avd,'userdata.img'),'original-data');await fs.writeFile(path.join(config.avdHome,`${p.avdName}.ini`),`path=${avd}`)
  const server=createApp(config,manager).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())))
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/profiles/${p.id}`
  const headers={Authorization:`Bearer ${config.apiToken}`,'Content-Type':'application/json'}
  const request=(suffix:string,method='GET',body?:unknown)=>fetch(base+suffix,{method,headers,...(body?{body:JSON.stringify(body)}:{})})
  assert.equal((await manager.get(p.id))?.status,'running')
  const screen=await request('/screen');assert.equal(screen.headers.get('Content-Type'),'image/png');assert.equal(new Uint8Array(await screen.arrayBuffer())[0],137)
  assert.equal((await request('/input','POST',{kind:'tap',x:20,y:30})).status,200)
  assert.equal((await request('/input','POST',{kind:'key',code:';bad'})).status,400)
  assert.ok((await (await request('/apps')).json()).apps.includes('com.example.app'))
  assert.equal((await request('/apps/com.example.app/open','POST')).status,200)
  assert.equal((await (await request('/diagnostics')).json()).model,'Test Phone')
  const upload=await fetch(base+'/apk',{method:'POST',headers:{Authorization:headers.Authorization,'Content-Type':'application/octet-stream'},body:Buffer.from('test-apk')});assert.equal(upload.status,200)
  const backup=await manager.backup(p.id);assert.equal((await store.get(p.id))?.status,'stopped')
  await fs.writeFile(path.join(avd,'userdata.img'),'changed-data');await manager.update(p.id,{settings:{...p.settings,memoryMb:2048}})
  await manager.restore(p.id,backup.backup)
  assert.equal(await fs.readFile(path.join(avd,'userdata.img'),'utf8'),'original-data');assert.equal((await store.get(p.id))?.settings?.memoryMb,p.settings.memoryMb)
  const recorded=(await fs.readFile(calls,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as string[])
  assert.ok(recorded.every(args=>args[0]==='-s'&&args[1]===`emulator-${p.emulatorPort}`));assert.ok(recorded.some(args=>args.includes('install')))
  assert.equal((await fs.readdir(path.join(config.dataDir,'uploads'))).length,0)
})
