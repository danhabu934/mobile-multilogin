import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AndroidProfile } from './types.js'

export class ProfileStore {
  private readonly key: Buffer

  constructor(private readonly profileDir: string, encryptionSecret: string) {
    this.key = crypto.scryptSync(encryptionSecret, 'nexo-profile-store-v1', 32)
  }

  async init() {
    await fs.mkdir(this.profileDir, { recursive: true, mode: 0o700 })
  }

  private file(id: string) {
    return path.join(this.profileDir, `${id}.json`)
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
    const profiles = await Promise.all(files.map(file => fs.readFile(path.join(this.profileDir, file), 'utf8').then(value => this.decrypt(value))))
    return profiles.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async save(profile: AndroidProfile) {
    const destination = this.file(profile.id)
    const temporary = `${destination}.${process.pid}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(this.encrypt(profile))}\n`, { mode: 0o600 })
    await fs.rename(temporary, destination)
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
    return JSON.parse(plaintext.toString('utf8')) as AndroidProfile
  }
}
