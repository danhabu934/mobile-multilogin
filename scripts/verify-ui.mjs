import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const {getConfig}=await import(root+'/worker/dist/config.js'),{AndroidManager}=await import(root+'/worker/dist/android-manager.js'),{ProfileStore}=await import(root+'/worker/dist/store.js'),{createApp}=await import(root+'/worker/dist/app.js')
process.env.WORKER_API_TOKEN='a'.repeat(32)
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'nexo-ui-')),image='system-images;android-35;google_apis_playstore;x86_64'
const config={...getConfig(),emulatorPath:path.join(tmp,'missing-emulator'),adbPath:path.join(tmp,'missing-adb'),avdManagerPath:path.join(tmp,'missing-avdmanager'),dataDir:tmp,profileDir:path.join(tmp,'profiles'),avdHome:path.join(tmp,'avd'),logDir:path.join(tmp,'logs'),sdkRoot:path.join(tmp,'sdk'),dryRun:true}
await fs.mkdir(path.join(config.sdkRoot,...image.split(';')),{recursive:true});await fs.writeFile(path.join(config.sdkRoot,...image.split(';'),'package.xml'),'test')
const manager=new AndroidManager(config,new ProfileStore(config.profileDir,config.encryptionKey));await manager.init()
const worker=createApp(config,manager).listen(0,'127.0.0.1');await new Promise(r=>worker.once('listening',r))
const vite=spawn(process.execPath,[root+'/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{cwd:root,stdio:'pipe'})
let browser
try {
  let ready=false;for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:5173');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,'Vite must start')
  browser=await chromium.launch({executablePath:process.env.NEXO_UI_TEST_EXECUTABLE_PATH || undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']})
  const page=await browser.newPage(), errors=[];page.setDefaultTimeout(10000);page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()));page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(({url,token})=>{localStorage.setItem('nexo-worker-url',url);sessionStorage.setItem('nexo-worker-token',token)}, {url:`http://127.0.0.1:${worker.address().port}`,token:config.apiToken})
  await page.goto('http://127.0.0.1:5173',{waitUntil:'domcontentloaded'});await page.getByText('Conectado',{exact:true}).waitFor()
  assert.ok((await page.locator('body').innerText()).includes('Modo de simulação'))
  await page.getByRole('button',{name:'Novo perfil',exact:true}).click()
  await page.getByLabel('Nome',{exact:true}).fill('Teste de interface')
  await page.getByLabel('RAM (MB)',{exact:true}).fill('2048')
  await page.getByRole('button',{name:'Criar Android',exact:true}).click()
  await page.getByRole('button',{name:/Teste de interface/}).waitFor()
  const profiles=await manager.list();assert.equal(profiles.length,1);assert.equal(profiles[0].settings.memoryMb,2048)
  await page.getByRole('button',{name:/Teste de interface/}).click()
  await page.getByRole('button',{name:'Configuração',exact:true}).click()
  await page.getByLabel('Nome',{exact:true}).fill('Nome atualizado')
  await page.getByRole('button',{name:'Salvar com Android desligado',exact:true}).click()
  await page.getByText('Configuração salva.',{exact:true}).waitFor()
  assert.equal((await manager.list())[0].displayName,'Nome atualizado')
  await page.getByRole('button',{name:'Backups',exact:true}).click()
  await page.getByRole('button',{name:'Listar backups',exact:true}).click()
  await page.getByRole('button',{name:'Diagnóstico',exact:true}).click()
  await page.getByRole('button',{name:'Ver logs',exact:true}).click()
  await page.getByText('Nenhum log disponível',{exact:true}).waitFor()
  await page.screenshot({path:path.join(tmp,'desktop.png'),fullPage:true})
  await page.locator('.drawer-head .icon-button').click()
  await page.getByRole('button',{name:'Novo perfil',exact:true}).click()
  await page.getByLabel('Motor').selectOption('bluestacks')
  assert.equal(await page.getByLabel('Imagem instalada',{exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'Conectar ADB local',exact:true}).count(),1)
  await page.locator('.modal-head .icon-button').click()
  await page.setViewportSize({width:390,height:844})
  await page.waitForFunction(()=>document.querySelector('aside').getBoundingClientRect().right <= 0);await page.screenshot({path:path.join(tmp,'mobile.png'),fullPage:true})
  assert.equal(await page.locator('vite-error-overlay').count(),0);assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:true,checks:['worker connection','simulation disclosure','profile creation with actual RAM','profile editing','backup list','logs','external-engine form','mobile rendering','no React errors']}))
}catch(e){console.error(e);if(browser){for(const c of browser.contexts())for(const p of c.pages()){console.log('FAILURE BODY',await p.locator('body').innerText());await p.screenshot({path:path.join(tmp,'failure.png'),timeout:5000}).catch(()=>undefined)}}throw e}finally{if(browser)await browser.close();vite.kill();await new Promise(r=>worker.close(r));await fs.rm(tmp,{recursive:true,force:true})}
