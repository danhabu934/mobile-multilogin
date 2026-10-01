import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { SerialQueue } from './queue.js'
import { profileIdSchema } from './schemas.js'
import type { AndroidProfile } from './types.js'

export class ProfileStore {
  private readonly queue = new SerialQueue()
  readonly warnings: string[] = []
  private readonly key: Buffer

  constructor(private readonly profileDir: string, encryptionSecret: string) {
    this.key = crypto.scryptSync(encryptionSecret, 'nexo-profile-store-v1', 32)
  }

  async init() {
    await fs.mkdir(this.profileDir, { recursive: true, mode: 0o700 })
  }

  private file(id: string) {
    return path.join(this.profileDir, `${profileIdSchema.parse(id)}.json`)
  }

  async get(id: string): Promise<AndroidProfile | null> {
    try {
      return this.decrypt(await fs.readFile(this.file(id), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async list(): Promise<AndroidProfile[]> {
    const files = (await fs.readdir(this.profileDir)).filter(file => file.endsWith('.json'))
    this.warnings.length = 0
    const results = await Promise.allSettled(files.map(file => fs.readFile(path.join(this.profileDir, file), 'utf8').then(value => this.decrypt(value))))
    const profiles: AndroidProfile[] = []
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') profiles.push(result.value)
      else this.warnings.push(`Perfil ${files[i]} não pôde ser lido. Verifique a chave e restaure seu backup; o arquivo foi preservado.`)
    })
    return profiles.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async save(profile: AndroidProfile) {
    return this.queue.run(async () => {
      const destination = this.file(profile.id)
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`
      try {
        const handle = await fs.open(temporary, 'wx', 0o600)
        try { await handle.writeFile(`${JSON.stringify(this.encrypt(profile))}\n`); await handle.sync() } finally { await handle.close() }
        await fs.rename(temporary, destination)
      } finally { await fs.rm(temporary, { force: true }) }
    })
  }

  async delete(id: string) {
    return this.queue.run(() => fs.rm(this.file(id), { force: true }))
  }

  readBackup(serialized: string, id: string) {
    const p = this.decrypt(serialized)
    if (p.id !== id) throw new Error('Backup pertence a outro perfil')
    return p
  }

  private encrypt(profile: AndroidProfile) {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(profile), 'utf8'), cipher.final()])
    return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
  }

  private decrypt(serialized: string): AndroidProfile {
    const envelope = JSON.parse(serialized) as { version: number; iv: string; tag: string; ciphertext: string }
    if (envelope.version !== 1) throw new Error('Unsupported profile storage version')
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
    const profile = JSON.parse(plaintext.toString('utf8')) as AndroidProfile
    profileIdSchema.parse(profile.id)
    if (profile.avdName !== `nexo_${profile.id}`) throw new Error('Invalid AVD association')
    return profile
  }
}

