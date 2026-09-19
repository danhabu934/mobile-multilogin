import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { WorkerConfig } from './config.js'
import { ProfileStore } from './store.js'
import type { AndroidProfile, CommandResult, ProxyConfig } from './types.js'

const now = () => new Date().toISOString()

function safeAvdName(id: string) {
  return `nexo_${id}`
}

function allocatePort(id: string) {
  let hash = 0
  for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return 5554 + (Math.abs(hash) % 32) * 2
}

export class AndroidManager {
  constructor(private readonly config: WorkerConfig, private readonly store: ProfileStore) {}

  async init() {
    await this.store.init()
    await fsp.mkdir(this.config.logDir, { recursive: true, mode: 0o700 })
    await fsp.mkdir(this.config.avdHome, { recursive: true, mode: 0o700 })
  }

  async capabilities() {
    const kvm = this.config.platform === 'linux' && fs.existsSync('/dev/kvm')
    const emulator = fs.existsSync(this.config.emulatorPath)
    const adb = fs.existsSync(this.config.adbPath)
    const avdManager = fs.existsSync(this.config.avdManagerPath)
    let acceleration = kvm
    let accelerationDetails = kvm ? '/dev/kvm' : 'unavailable'

    if (this.config.platform === 'win32' && emulator) {
      const result = spawnSync(this.config.emulatorPath, ['-accel-check'], { timeout: 15_000, encoding: 'utf8' })
      acceleration = result.status === 0
      accelerationDetails = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim() || `exit ${result.status}`
    }

    return {
      platform: this.config.platform,
      acceleration,
      accelerationDetails,
      kvm,
      emulator,
      adb,
      avdManager,
      dryRun: this.config.dryRun,
      ready: this.config.dryRun || (acceleration && emulator && adb && avdManager),
    }
  }

  async create(input: { id: string; displayName: string; proxy: ProxyConfig }) {
    if (await this.store.get(input.id)) throw new Error('Profile already exists')
    const timestamp = now()
    const profile: AndroidProfile = {
      id: input.id,
      displayName: input.displayName,
      avdName: safeAvdName(input.id),
      deviceId: this.config.deviceId,
      systemImage: this.config.systemImage,
      emulatorPort: allocatePort(input.id),
      proxy: input.proxy,
      status: 'created',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.ensureAvd(profile)
    await this.store.save(profile)
    return this.sanitize(profile)
  }

  async list() {
    const profiles = await this.store.list()
    return Promise.all(profiles.map(profile => this.refresh(profile)))
  }

  async get(id: string) {
    const profile = await this.store.get(id)
    if (!profile) return null
    return this.refresh(profile)
  }

  async start(id: string) {
    const profile = await this.require(id)
    if ((await this.refresh(profile)).status === 'running') return this.sanitize(profile)

    const capabilities = await this.capabilities()
    if (!capabilities.ready) throw new Error('Worker is missing hardware acceleration or Android SDK components')
    if (profile.proxy.type === 'socks5') throw new Error('SOCKS5 requires the network tunnel module and is not enabled in this worker version')

    profile.status = 'starting'
    profile.updatedAt = now()
    profile.lastError = undefined
    await this.store.save(profile)

    const args = [
      '-avd', profile.avdName,
      '-port', String(profile.emulatorPort),
      '-no-boot-anim',
      '-gpu', this.config.emulatorGpu,
      '-accel', 'on',
      '-memory', String(this.config.emulatorMemoryMb),
      '-cores', String(this.config.emulatorCores),
      '-netdelay', 'none',
      '-netspeed', 'full',
    ]
    if (this.config.headless) args.push('-no-window', '-no-audio')
    const proxy = this.proxyArgument(profile.proxy)
    if (proxy) args.push('-http-proxy', proxy)

    if (this.config.dryRun) {
      profile.status = 'running'
      profile.pid = 99999
      profile.updatedAt = now()
      await this.store.save(profile)
      return this.sanitize(profile)
    }

    const logPath = path.join(this.config.logDir, `${profile.id}.log`)
    const logFd = fs.openSync(logPath, 'a', 0o600)
    const child = spawn(this.config.emulatorPath, args, {
      detached: true,
      windowsHide: this.config.platform === 'win32',
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, ANDROID_AVD_HOME: this.config.avdHome, ANDROID_SDK_ROOT: this.config.sdkRoot },
    })
    child.unref()
    fs.closeSync(logFd)
    profile.pid = child.pid
    profile.updatedAt = now()
    await this.store.save(profile)
    return this.sanitize(profile)
  }

  async stop(id: string) {
    const profile = await this.require(id)
    if (!this.config.dryRun) {
      const serial = `emulator-${profile.emulatorPort}`
      spawnSync(this.config.adbPath, ['-s', serial, 'emu', 'kill'], { timeout: 10_000, encoding: 'utf8' })
      if (profile.pid && this.processAlive(profile.pid)) {
        try { process.kill(profile.pid, 'SIGTERM') } catch { /* already stopped */ }
      }
    }
    profile.status = 'stopped'
    profile.pid = undefined
    profile.updatedAt = now()
    await this.store.save(profile)
    return this.sanitize(profile)
  }

  private async ensureAvd(profile: AndroidProfile): Promise<CommandResult> {
    const avdIni = path.join(this.config.avdHome, `${profile.avdName}.ini`)
    if (fs.existsSync(avdIni)) return { command: this.config.avdManagerPath, args: [], code: 0, stdout: 'already exists', stderr: '' }
    const args = ['create', 'avd', '--force', '--name', profile.avdName, '--package', profile.systemImage, '--device', profile.deviceId]
    if (this.config.dryRun) return { command: this.config.avdManagerPath, args, code: 0, stdout: 'dry run', stderr: '' }
    const result = spawnSync(this.config.avdManagerPath, args, {
      input: 'no\n',
      encoding: 'utf8',
      timeout: 120_000,
      shell: this.config.platform === 'win32',
      env: { ...process.env, ANDROID_AVD_HOME: this.config.avdHome, ANDROID_SDK_ROOT: this.config.sdkRoot },
    })
    if (result.status !== 0) throw new Error(`AVD creation failed: ${result.stderr || result.stdout}`)
    return { command: this.config.avdManagerPath, args, code: result.status ?? 0, stdout: result.stdout, stderr: result.stderr }
  }

  private proxyArgument(proxy: ProxyConfig) {
    if (proxy.type === 'none' || !proxy.host || !proxy.port) return null
    const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@` : ''
    return `${proxy.type === 'https' ? 'http' : proxy.type}://${auth}${proxy.host}:${proxy.port}`
  }

  private async refresh(profile: AndroidProfile) {
    if (this.config.dryRun) return this.sanitize(profile)
    if (profile.pid && this.processAlive(profile.pid)) {
      const serial = `emulator-${profile.emulatorPort}`
      const result = spawnSync(this.config.adbPath, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { timeout: 4_000, encoding: 'utf8' })
      profile.status = result.stdout.trim() === '1' ? 'running' : 'starting'
    } else if (profile.status === 'running' || profile.status === 'starting') {
      profile.status = 'stopped'
      profile.pid = undefined
    }
    profile.updatedAt = now()
    await this.store.save(profile)
    return this.sanitize(profile)
  }

  private processAlive(pid: number) {
    try { process.kill(pid, 0); return true } catch { return false }
  }

  private async require(id: string) {
    const profile = await this.store.get(id)
    if (!profile) throw new Error('Profile not found')
    return profile
  }

  private sanitize(profile: AndroidProfile) {
    return { ...profile, proxy: { ...profile.proxy, password: profile.proxy.password ? '••••••••' : undefined } }
  }
}
