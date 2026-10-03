import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import express, { type NextFunction, type Request, type Response } from 'express'
import { z, ZodError } from 'zod'
import { AndroidManager } from './android-manager.js'
import type { WorkerConfig } from './config.js'
import { createProfileSchema, profileIdSchema, proxySchema, updateProfileSchema, packageSchema, inputSchema } from './schemas.js'
import { verifyProxy } from './proxy.js'
export function createApp(config: WorkerConfig, manager: AndroidManager) {
  process.env.ADB_BIN ??= config.adbPath
  const app = express(); app.disable('x-powered-by')
  const origins = new Set((process.env.WORKER_ALLOWED_ORIGINS ?? 'https://mobile-multilogin.vercel.app,http://localhost:5173,http://127.0.0.1:5173').split(',').map(x => x.trim()).filter(Boolean))
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && !origins.has(origin)) return res.status(403).json({ error: 'Origem não autorizada. Configure WORKER_ALLOWED_ORIGINS.' })
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Private-Network', 'true') }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const actual = Buffer.from(req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? ''), expected = Buffer.from(config.apiToken)
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Unauthorized' })
    next()
  }
  app.get('/health', (_req, res) => res.json({ service: 'nexo-android-worker', version: '0.2.0', dryRun: config.dryRun }))
  app.use('/v1', authenticate)
  let activeUploads = 0
  app.post('/v1/profiles/:id/apk', async (req, res) => {
    const id = profileIdSchema.parse(req.params.id); await manager.require(id)
    if (config.dryRun) return res.status(409).json({ error: 'Instalação requer Android real' })
    if (activeUploads >= 2) return res.status(429).json({ error: 'Aguarde o upload atual terminar' })
    if (!req.is('application/vnd.android.package-archive') && !req.is('application/octet-stream')) return res.status(415).json({ error: 'Envie um APK binário' })
    const max = config.uploadLimitMb * 1024 ** 2
    if (Number(req.headers['content-length'] ?? 0) > max) return res.status(413).json({ error: 'APK excede o limite configurado' })
    const directory = path.join(config.dataDir, 'uploads'); await fsp.mkdir(directory, { recursive: true, mode: 0o700 })
    const filename = path.join(directory, `${crypto.randomUUID()}.apk`); activeUploads++; let bytes = 0
    try {
      await pipeline(req, new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > max ? new Error('APK excede o limite configurado') : null, chunk) } }), fs.createWriteStream(filename, { flags: 'wx', mode: 0o600 }))
      if (!bytes) throw new Error('APK vazio')
      await manager.deviceOperation(id, async p => { const result = await manager.adb(p, ['install', '-r', filename], false, 120000); if (!/Success/.test(String(result.stdout))) throw new Error(`Instalação não confirmada: ${String(result.stdout).slice(0,1000)}`) }); res.json({ installed: true })
    } finally { activeUploads--; await fsp.rm(filename, { force: true }) }
  })
  app.use(express.json({ limit: '3mb' }))
  app.post('/v1/devices/connect', async (req, res) => {
    const serial = z.string().regex(/^127\.0\.0\.1:\d{1,5}$/).parse(req.body.serial)
    const port = Number(serial.split(':')[1]); if (port < 1024 || port > 65535) throw new Error('Porta ADB inválida')
    if (config.dryRun) throw new Error('Esta operação requer Android real')
    const result = await promisify(execFile)(config.adbPath, ['connect', serial], {timeout:10000})
    if (!/connected to/.test(result.stdout)) throw new Error('Não foi possível conectar. Abra o BlueStacks e habilite ADB.')
    res.json({connected:true})
  })
  app.get('/v1/capabilities', async (_req, res) => res.json(await manager.catalogue()))
  app.get('/v1/profiles', async (_req, res) => res.json({ profiles: await manager.list(), warnings: manager.store.warnings }))
  app.post('/v1/profiles', async (req, res) => res.status(201).json({ profile: await manager.create(createProfileSchema.parse(req.body)) }))
  app.get('/v1/profiles/:id', async (req, res) => { const p = await manager.get(profileIdSchema.parse(req.params.id)); if (!p) return res.status(404).json({ error: 'Profile not found' }); res.json({ profile: p }) })
  app.patch('/v1/profiles/:id', async (req, res) => res.json({ profile: await manager.update(profileIdSchema.parse(req.params.id), updateProfileSchema.parse(req.body)) }))
  app.delete('/v1/profiles/:id', async (req, res) => res.json(await manager.delete(profileIdSchema.parse(req.params.id))))
  app.post('/v1/profiles/:id/start', async (req, res) => res.status(202).json({ profile: await manager.start(profileIdSchema.parse(req.params.id)) }))
  app.post('/v1/profiles/:id/stop', async (req, res) => res.json({ profile: await manager.stop(profileIdSchema.parse(req.params.id)) }))
  app.post('/v1/proxy/test', async (req, res) => res.json(await verifyProxy(proxySchema.parse(req.body))))
  app.post('/v1/profiles/:id/proxy/test', async (req, res) => { const p = await manager.require(profileIdSchema.parse(req.params.id)); res.json(await verifyProxy(p.proxy)) })
  app.get('/v1/profiles/:id/logs', async (req, res) => res.json({ text: await manager.log(profileIdSchema.parse(req.params.id)) }))
  app.get('/v1/profiles/:id/backups', async (req, res) => res.json({ backups: await manager.backups(profileIdSchema.parse(req.params.id)) }))
  app.post('/v1/profiles/:id/backups', async (req, res) => res.status(201).json(await manager.backup(profileIdSchema.parse(req.params.id))))
  app.post('/v1/profiles/:id/restore', async (req, res) => res.json(await manager.restore(profileIdSchema.parse(req.params.id), z.string().regex(/^backup-[\w-]+$/).parse(req.body.backup))))
  app.get('/v1/profiles/:id/screen', async (req, res) => { const result = await manager.deviceOperation(profileIdSchema.parse(req.params.id), p => manager.adb(p, ['exec-out', 'screencap', '-p'], true)); res.type('png').send(result.stdout) })
  app.post('/v1/profiles/:id/input', async (req, res) => {
    const input = inputSchema.parse(req.body)
    const args = input.kind === 'tap' ? ['tap', String(input.x), String(input.y)] : input.kind === 'key' ? ['keyevent', input.code] : ['swipe', String(input.x), String(input.y), String(input.toX), String(input.toY), '300']
    await manager.deviceOperation(profileIdSchema.parse(req.params.id), p => manager.adb(p, ['shell', 'input', ...args])); res.json({ ok: true })
  })
  app.post('/v1/profiles/:id/open-url', async (req, res) => {
    const url = z.string().url().max(4096).parse(req.body.url)
    if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Use uma URL HTTP ou HTTPS')
    await manager.deviceOperation(profileIdSchema.parse(req.params.id), p => manager.adb(p, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${url.replaceAll("'", "'\\''")}'`])); res.json({ opened: true })
  })
  app.post('/v1/profiles/:id/mirror', async (req, res) => res.json(await manager.mirror(profileIdSchema.parse(req.params.id))))
  app.get('/v1/profiles/:id/apps', async (req, res) => {
    const apps = await manager.deviceOperation(profileIdSchema.parse(req.params.id), async p => { const result = await manager.adb(p, ['shell', 'pm', 'list', 'packages', '-3']); return String(result.stdout).split(/\r?\n/).filter(l => l.startsWith('package:')).map(l => l.slice(8)) }); res.json({ apps })
  })
  app.post('/v1/profiles/:id/apps/:package/open', async (req, res) => { const pkg = packageSchema.parse(req.params.package); await manager.deviceOperation(profileIdSchema.parse(req.params.id), p => manager.adb(p, ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'])); res.json({ opened: pkg }) })
  app.get('/v1/profiles/:id/apps/:package/diagnostics', async (req, res) => {
    const pkg = packageSchema.parse(req.params.package)
    const report = await manager.deviceOperation(profileIdSchema.parse(req.params.id), async p => {
      const result = String((await manager.adb(p, ['shell', 'dumpsys', 'package', pkg])).stdout)
      const prop = (key: string) => result.match(new RegExp(`${key}=([^\\s]+)`))?.[1] ?? null
      return { package:pkg, installed:result.includes('versionCode='), versionName:prop('versionName'), versionCode:prop('versionCode'), targetSdk:prop('targetSdk'), primaryCpuAbi:prop('primaryCpuAbi'), secondaryCpuAbi:prop('secondaryCpuAbi'), diagnosis:'Compare esta versão e arquitetura com a instância que funciona. Não é um resultado de Play Integrity.' }
    })
    res.json(report)
  })
  app.get('/v1/profiles/:id/diagnostics', async (req, res) => {
    const values = await manager.deviceOperation(profileIdSchema.parse(req.params.id), async p => {
      const result = await manager.adb(p, ['shell', 'getprop']), packages = await manager.adb(p, ['shell', 'pm', 'list', 'packages']), disk = await manager.adb(p, ['shell', 'df', '-k', '/data'])
      const props = Object.fromEntries([...String(result.stdout).matchAll(/\[([^\]]+)\]: \[([^\]]*)\]/g)].map(m => [m[1], m[2]]))
      return { serial: manager.serial(p), model: props['ro.product.model'], android: props['ro.build.version.release'], api: props['ro.build.version.sdk'], abi: props['ro.product.cpu.abilist'], securityPatch: props['ro.build.version.security_patch'], buildType: props['ro.build.type'], buildTags: props['ro.build.tags'], debuggable: props['ro.debuggable'], verifiedBoot: props['ro.boot.verifiedbootstate'], playServices: String(packages.stdout).includes('package:com.google.android.gms'), playStore: String(packages.stdout).includes('package:com.android.vending'), webViewPackages: String(packages.stdout).split(/\r?\n/).filter(x => /webview/i.test(x)), storage: String(disk.stdout), integrity: 'Não avaliada: estes dados não comprovam certificação nem o resultado do Play Integrity de um app.' }
    }); res.json(values)
  })
  app.post('/v1/hydrate', async (req, res) => {
    const input = z.object({
      profileId: profileIdSchema,
      // Aceita array de cookies, objeto com .cookies, ou string bruta (JSON / Netscape / linhas)
      cookies: z.union([z.array(z.unknown()).min(1), z.record(z.string(), z.unknown()), z.string().min(1)]),
      serial: z.string().optional(),
    }).parse(req.body)
    const result = await manager.deviceOperation(input.profileId, async p => {
      if (input.serial && input.serial !== manager.serial(p)) throw new Error('Serial não pertence ao perfil')
      const require = createRequire(import.meta.url)
      const module = require(fileURLToPath(new URL('../dist/cookie-hydrator.cjs', import.meta.url))) as {
        hydrateSerialGuarded: (cookies: unknown, opts: { serial: string }) => Promise<unknown>
      }
      return module.hydrateSerialGuarded(input.cookies, { serial: manager.serial(p) })
    })
    res.json(result)
  })
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({ error: 'Invalid request', details: error.issues })
    if ((error as { type?: string })?.type === 'entity.too.large') return res.status(413).json({ error: 'Payload excede 3 MB' })
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'JSON inválido' })
    const message = error instanceof Error ? error.message : 'Internal worker error'
    const status = message === 'Profile not found' ? 404 : /Profile already exists|Feche outro|Memória livre|Desligue|requer Android|simulação|ocupada|já está associado|Aguarde/.test(message) ? 409 : 500
    res.status(status).json({ error: message })
  })
  return app
}
