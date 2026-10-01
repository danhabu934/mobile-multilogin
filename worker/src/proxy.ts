import http from 'node:http'
import type { ProxyConfig } from './types.js'
export function verifyProxy(proxy: ProxyConfig): Promise<{ ip: string; scope: string; latencyMs: number }> {
  if (proxy.type !== 'http') throw new Error('O teste aceita proxy HTTP; configure outros protocolos no motor externo')
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: proxy.host, port: proxy.port, method: 'GET', path: 'http://api.ipify.org?format=json',
      headers: { Host: 'api.ipify.org', ...(proxy.username ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64')}` } : {}) } }, response => {
      let body = ''; response.on('data', chunk => { body += chunk; if (body.length > 4096) response.destroy(new Error('Resposta do proxy excedeu o limite')) }); response.on('error', reject)
      response.on('end', () => { try {
        if (response.statusCode !== 200) throw new Error(`Proxy respondeu HTTP ${response.statusCode}`)
        const value = JSON.parse(body); if (typeof value.ip !== 'string' || !/^[a-fA-F0-9.:]+$/.test(value.ip)) throw new Error('IP de saída inválido')
        resolve({ ip: value.ip, scope: 'HTTP do worker pelo proxy; não valida DNS/UDP nem a rota de todos os apps', latencyMs: Date.now() - start })
      } catch (e) { reject(e) } })
    })
    request.setTimeout(10000, () => request.destroy(new Error('Proxy não respondeu em 10 segundos')))
    request.on('error', () => reject(new Error('Falha ao conectar ao proxy. Confira host, porta e autenticação.'))); request.end()
  })
}
