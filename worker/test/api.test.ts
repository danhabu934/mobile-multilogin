import assert from 'node:assert/strict'
import test from 'node:test'
import type { AddressInfo } from 'node:net'
import http from 'node:http'
import { fixture } from './helpers.js'
import { createApp } from '../src/app.js'
import { verifyProxy } from '../src/proxy.js'

test('HTTP API verifies auth, origin, validation, lifecycle, edit and deletion',async t=>{
  const {config,manager}=await fixture(t),server=createApp(config,manager).listen(0,'127.0.0.1')
  await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())))
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const headers={Authorization:`Bearer ${config.apiToken}`,'Content-Type':'application/json'}
  const request=(url:string,method='GET',body?:unknown)=>fetch(base+url,{method,headers,...(body?{body:JSON.stringify(body)}:{})})
  assert.equal((await fetch(base+'/health')).status,200)
  assert.equal((await fetch(base+'/v1/profiles')).status,401)
  assert.equal((await fetch(base+'/v1/profiles',{headers:{Authorization:`Bearer ${'é'.repeat(32)}`}})).status,401)
  assert.equal((await fetch(base+'/v1/profiles',{headers:{...headers,Origin:'https://untrusted.example'}})).status,403)
  assert.equal((await request('/v1/profiles','POST',{id:'../bad',displayName:'Bad'})).status,400)
  assert.equal((await request('/v1/profiles','POST',{id:'api-profile',displayName:'API Profile'})).status,201)
  assert.equal((await request('/v1/profiles/api-profile/start','POST')).status,202)
  assert.equal((await request('/v1/profiles/api-profile/input','POST',{kind:'key',code:'3'})).status,409)
  assert.equal((await request('/v1/profiles/api-profile/stop','POST')).status,200)
  assert.equal((await request('/v1/profiles/api-profile','PATCH',{displayName:'Updated'})).status,200)
  assert.equal((await request('/v1/profiles/api-profile','DELETE')).status,200)
  assert.equal((await request('/v1/profiles/api-profile')).status,404)
})
test('proxy test performs authenticated outbound request and reports failures',async t=>{
  let auth=''
  const server=http.createServer((req,res)=>{auth=req.headers['proxy-authorization']??'';assert.equal(req.url,'http://api.ipify.org?format=json');res.end(JSON.stringify({ip:'203.0.113.1'}))}).listen(0,'127.0.0.1')
  await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())))
  const result=await verifyProxy({type:'http',host:'127.0.0.1',port:(server.address() as AddressInfo).port,username:'user',password:'pass'})
  assert.equal(result.ip,'203.0.113.1');assert.ok(auth.startsWith('Basic '));assert.ok(result.scope.includes('não valida'))
})
