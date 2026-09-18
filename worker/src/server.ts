import crypto from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import { ZodError } from 'zod'
import { AndroidManager } from './android-manager.js'
import { getConfig } from './config.js'
import { createProfileSchema, profileIdSchema } from './schemas.js'
import { ProfileStore } from './store.js'

const config = getConfig()
const store = new ProfileStore(config.profileDir, config.encryptionKey)
const manager = new AndroidManager(config, store)
await manager.init()

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))

function authenticate(req: Request, res: Response, next: NextFunction) {
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? ''
  const validLength = supplied.length === config.apiToken.length
  const valid = validLength && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(config.apiToken))
  if (!valid) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

app.get('/health', async (_req, res) => {
  const capabilities = await manager.capabilities()
  res.status(capabilities.ready ? 200 : 503).json({ service: 'nexo-android-worker', version: '0.1.0', capabilities })
})

app.use('/v1', authenticate)

app.get('/v1/profiles', async (_req, res) => res.json({ profiles: await manager.list() }))

app.post('/v1/profiles', async (req, res) => {
  const input = createProfileSchema.parse(req.body)
  res.status(201).json({ profile: await manager.create(input) })
})

app.get('/v1/profiles/:id', async (req, res) => {
  const id = profileIdSchema.parse(req.params.id)
  const profile = await manager.get(id)
  if (!profile) return res.status(404).json({ error: 'Profile not found' })
  res.json({ profile })
})

app.post('/v1/profiles/:id/start', async (req, res) => {
  const id = profileIdSchema.parse(req.params.id)
  res.status(202).json({ profile: await manager.start(id) })
})

app.post('/v1/profiles/:id/stop', async (req, res) => {
  const id = profileIdSchema.parse(req.params.id)
  res.json({ profile: await manager.stop(id) })
})

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) return res.status(400).json({ error: 'Invalid request', details: error.issues })
  const message = error instanceof Error ? error.message : 'Internal worker error'
  const status = message === 'Profile not found' ? 404 : message === 'Profile already exists' ? 409 : 500
  res.status(status).json({ error: message })
})

app.listen(config.port, config.host, () => {
  console.log(`Nexo Android Worker listening on http://${config.host}:${config.port}`)
  console.log(`Mode: ${config.dryRun ? 'dry-run' : 'android'}`)
})
