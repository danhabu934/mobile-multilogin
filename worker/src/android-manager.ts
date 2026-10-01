import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { execFile, spawn } from 'node:child_process'
import type { WorkerConfig } from './config.js'
import { ProfileStore } from './store.js'
import { SerialQueue } from './queue.js'
import { createProfileSchema, updateProfileSchema, profileIdSchema } from './schemas.js'
import type { AndroidProfile, DeviceSettings, ProxyConfig } from './types.js'
import type { z } from 'zod'
const exec = promisify(execFile)
const now = () => new Date().toISOString()
const fileExists = (p: string) => fs.existsSync(p)

export function resourceBudget(totalMb: number, freeMb: number, requestedMb: number) {
  const reserveMb = Math.max(1024, Math.min(2048, Math.floor(totalMb * 0.1)))
  return { reserveMb, requiredMb: requestedMb + reserveMb, freeMb, allowed: freeMb >= requestedMb + reserveMb }
}
export async function portAvailable(port: number) {
  return new Promise<boolean>(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}
export class AndroidManager {
  private readonly queue = new SerialQueue()
  constructor(readonly config: WorkerConfig, readonly store: ProfileStore) {}
  async init() {
    await this.store.init()
    for (const dir of [this.config.logDir, this.config.avdHome, path.join(this.config.dataDir, 'backups')]) await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
  }
  defaults(): DeviceSettings {
    return { memoryMb: this.config.emulatorMemoryMb, cores: this.config.emulatorCores, heapMb: this.config.emulatorHeapMb,
      resolution: this.config.emulatorResolution, density: this.config.emulatorDensity,
      gpu: this.config.emulatorGpu as DeviceSettings['gpu'], cameraFront: 'none', cameraBack: 'emulated' }
  }
  async capabilities() {
    const emulator = fileExists(this.config.emulatorPath), adb = fileExists(this.config.adbPath), avdManager = fileExists(this.config.avdManagerPath)
    let acceleration = false, accelerationDetails = 'Emulator unavailable'
    if (emulator) {
      try { const result = await exec(this.config.emulatorPath, ['-accel-check'], { timeout: 15000 }); acceleration = true; accelerationDetails = `${result.stdout}\n${result.stderr}`.trim() }
      catch (e) { const err = e as Error & { stdout?: string; stderr?: string }; accelerationDetails = `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim() || err.message }
    }
    const imagesDir = path.join(this.config.sdkRoot, 'system-images')
    const installedImages: string[] = []
    for (const api of await fsp.readdir(imagesDir).catch(() => [] as string[])) {
      for (const vendor of await fsp.readdir(path.join(imagesDir, api)).catch(() => [] as string[])) {
        for (const arch of await fsp.readdir(path.join(imagesDir, api, vendor)).catch(() => [] as string[])) {
          if (fileExists(path.join(imagesDir, api, vendor, arch, 'package.xml'))) installedImages.push(`system-images;${api};${vendor};${arch}`)
        }
      }
    }
    let devices: { serial: string; state: string }[] = []
    if (adb && !this.config.dryRun) {
      try { const result = await exec(this.config.adbPath, ['devices'], { timeout: 5000 }); devices = result.stdout.split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/)).filter(parts => parts.length >= 2).map(parts => ({ serial: parts[0], state: parts[1] })) } catch { /* diagnostics show no connected devices */ }
    }
    const disk = await fsp.statfs(this.config.dataDir).catch(() => null)
    const ready = adb // API can manage external engines without emulator/KVM.
    return { platform: this.config.platform, hostArch:process.arch, acceleration, accelerationDetails, kvm: this.config.platform === 'linux' && fileExists('/dev/kvm'),
      emulator, adb, avdManager, installedImages, devices, dryRun: this.config.dryRun, ready,
      emulatorReady: adb && emulator && avdManager && acceleration && installedImages.length > 0,
      memory: { totalMb: Math.floor(os.totalmem() / 1048576), freeMb: Math.floor(os.freemem() / 1048576) },
      disk: disk ? { totalBytes: disk.blocks * disk.bsize, freeBytes: disk.bavail * disk.bsize } : null,
      defaults: this.defaults(), systemImage: this.config.systemImage, deviceId: this.config.deviceId,
      maxActiveEmulators: this.config.maxActiveEmulators, blueStacksLauncher: !!this.config.blueStacksPlayer && fileExists(this.config.blueStacksPlayer),
      warnings: this.store.warnings, engines: ['android-emulator', 'bluestacks', 'physical'] }
  }
  async catalogue() {
    const capabilities = await this.capabilities()
    let devices: { id: string; name: string }[] = []
    if (!this.config.dryRun && capabilities.avdManager) {
      try {
        const result = await exec(this.config.avdManagerPath, ['list', 'device'], { timeout: 15000, shell: this.config.platform === 'win32' })
        devices = [...result.stdout.matchAll(/id:\s*\d+\s+or\s+"([\w-]+)"[\s\S]*?Name:\s*([^\r\n]+)/g)].map(m => ({ id: m[1], name: m[2].trim() }))
      } catch { /* use configured device only */ }
    }
    if (!devices.some(d => d.id === this.config.deviceId)) devices.push({ id: this.config.deviceId, name: this.config.deviceId.replaceAll('_', ' ') })
    return { ...capabilities, deviceDefinitions: devices }
  }
  async create(raw: z.input<typeof createProfileSchema>) {
    const input = createProfileSchema.parse(raw)
    return this.queue.run(async () => {
      if (await this.store.get(input.id)) throw new Error('Profile already exists')
      const profiles = await this.store.list()
      if (this.store.warnings.length) throw new Error('Recupere os perfis ilegíveis antes de criar novos aparelhos')
      const engine = input.engine
      if (engine !== 'android-emulator' && profiles.some(p => this.serial(p) === input.serial)) throw new Error('Este dispositivo já está associado a outro perfil')
      let port = 0
      if (engine === 'android-emulator') {
        for (let candidate = 5554; candidate <= 5680; candidate += 2) {
          if (!profiles.some(p => p.emulatorPort === candidate) && (this.config.dryRun || await portAvailable(candidate) && await portAvailable(candidate + 1))) { port = candidate; break }
        }
        if (!port) throw new Error('Nenhuma porta de emulador disponível')
      }
      const timestamp = now()
      const profile: AndroidProfile = { id: input.id, displayName: input.displayName, avdName: `nexo_${input.id}`,
        deviceId: input.deviceId ?? this.config.deviceId, systemImage: input.systemImage ?? this.config.systemImage,
        emulatorPort: port, engine, serial: input.serial, instanceName: input.instanceName,
        group: input.group, notes: input.notes, settings: input.settings ?? this.defaults(), proxy: input.proxy,
        status: 'created', createdAt: timestamp, updatedAt: timestamp }
      if (engine === 'android-emulator') await this.ensureAvd(profile)
      else if (!this.config.dryRun) profile.deviceId = String((await this.adb(profile, ['shell', 'getprop', 'ro.product.model'])).stdout).trim() || engine
      await this.store.save(profile)
      return this.sanitize(profile)
    })
  }
  async list() { return this.queue.run(async () => { const profiles = await this.store.list(); return Promise.all(profiles.map(p => this.refresh(p))) }) }
  async get(id: string) { return this.queue.run(async () => { const p = await this.store.get(id); return p ? this.refresh(p) : null }) }
  async update(id: string, raw: z.input<typeof updateProfileSchema>) {
    const input = updateProfileSchema.parse(raw)
    return this.queue.run(async () => {
      const p = await this.require(id); await this.refresh(p)
      if ((p.status === 'running' || p.status === 'starting') && (input.settings || input.proxy)) throw new Error('Desligue o Android antes de editar sua configuração')
      if ((p.engine ?? 'android-emulator') !== 'android-emulator' && (input.settings || input.proxy?.type !== undefined && input.proxy.type !== 'none')) throw new Error('Configure hardware e rede diretamente no motor externo')
      if (input.proxy && input.proxy.type !== 'none' && input.proxy.type !== 'http') throw new Error('Somente proxy HTTP está disponível neste motor')
      Object.assign(p, input, { updatedAt: now() }); await this.store.save(p); return this.sanitize(p)
    })
  }
  async start(id: string) { return this.queue.run(() => this.startInternal(id)) }
  private async startInternal(id: string) {
    const p = await this.require(id); await this.refresh(p)
    if (p.status === 'running' || p.status === 'starting') return this.sanitize(p)
    if ((p.engine ?? 'android-emulator') !== 'android-emulator') {
      if (p.engine === 'bluestacks' && p.instanceName && this.config.blueStacksPlayer) {
        await this.launch(this.config.blueStacksPlayer, ['--instance', p.instanceName], undefined)
        p.status = 'starting'; p.startedAt = now(); p.updatedAt = now(); await this.store.save(p); return this.sanitize(p)
      }
      await this.adb(p, ['shell', 'getprop', 'sys.boot_completed'])
      p.status = 'running'; p.updatedAt = now(); await this.store.save(p); return this.sanitize(p)
    }
    const profiles = await this.store.list()
    if (this.store.warnings.length) throw new Error('Recupere os perfis ilegíveis antes de iniciar novos aparelhos')
    const active = (await Promise.all(profiles.filter(x => x.id !== id).map(x => this.refresh(x)))).filter(x => (x.engine ?? 'android-emulator') === 'android-emulator' && ['running', 'starting'].includes(x.status))
    if (active.length >= this.config.maxActiveEmulators) throw new Error(`Feche outro Android antes de iniciar este (limite de ${this.config.maxActiveEmulators})`)
    const settings = p.settings ?? this.defaults()
    if (!this.config.dryRun) {
      const budget = resourceBudget(os.totalmem() / 1048576, Math.floor(os.freemem() / 1048576), settings.memoryMb)
      if (!budget.allowed) throw new Error(`Memória livre insuficiente: ${budget.freeMb} MB livres; este perfil requer ${budget.requiredMb} MB. Reduza a RAM do perfil ou feche outros programas.`)
      const cap = await this.capabilities()
      if (!cap.emulatorReady) throw new Error('Instale SDK, imagem Android e aceleração; consulte o diagnóstico')
      if (!await portAvailable(p.emulatorPort) || !await portAvailable(p.emulatorPort + 1)) throw new Error('A porta deste perfil está ocupada. Feche o processo que a utiliza antes de iniciar.')
      const disk = await fsp.statfs(this.config.dataDir)
      if (disk.bavail * disk.bsize < 2 * 1024 ** 3) throw new Error('Libere pelo menos 2 GB no disco antes de iniciar')
    }
    if (p.proxy.type !== 'none' && p.proxy.type !== 'http') throw new Error('Somente proxy HTTP está disponível; configure um túnel externo para outros protocolos')
    p.status = 'starting'; p.startedAt = now(); p.updatedAt = now(); p.lastError = undefined
    await this.store.save(p)
    try {
      await this.ensureAvd(p); await this.tuneAvd(p)
      const gpu = settings.gpu === 'software' ? 'software' : settings.gpu
      const args = ['-avd', p.avdName, '-port', String(p.emulatorPort), '-no-boot-anim', '-gpu', gpu,
        '-accel', 'on', '-memory', String(settings.memoryMb), '-cores', String(settings.cores), '-netdelay', 'none', '-netspeed', 'full']
      if (this.config.coldBoot) args.push('-no-snapshot-load')
      if (this.config.headless) args.push('-no-window') // keep audio available for native mirroring
      const proxy = this.proxyArgument(p.proxy); if (proxy) args.push('-http-proxy', proxy)
      if (this.config.dryRun) { p.status = 'running'; p.pid = 99999 }
      else p.pid = await this.launch(this.config.emulatorPath, args, path.join(this.config.logDir, `${p.id}.log`))
      await this.store.save(p); return this.sanitize(p)
    } catch (e) { p.status = 'error'; p.lastError = e instanceof Error ? e.message : 'Android start failed'; await this.store.save(p); throw e }
  }
  private async launch(executable: string, args: string[], log?: string) {
    const fd = log ? fs.openSync(log, 'a', 0o600) : undefined
    try {
      const child = spawn(executable, args, { detached: true, windowsHide: false, stdio: fd === undefined ? 'ignore' : ['ignore', fd, fd],
        env: { ...process.env, ANDROID_AVD_HOME: this.config.avdHome, ANDROID_SDK_ROOT: this.config.sdkRoot, ANDROID_HOME: this.config.sdkRoot, ADB: this.config.adbPath } })
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) }); child.unref(); return child.pid
    } finally { if (fd !== undefined) fs.closeSync(fd) }
  }
  async stop(id: string) { return this.queue.run(async () => { const p = await this.require(id); await this.stopInternal(p); return this.sanitize(p) }) }
  private async stopInternal(p: AndroidProfile) {
    if ((p.engine ?? 'android-emulator') !== 'android-emulator') throw new Error('Desligue a instância no BlueStacks ou no aparelho; o Nexo não encerra motores externos')
    if (!this.config.dryRun) {
      const identity = await this.avdIdentity(p)
      if (identity && identity !== p.avdName) throw new Error('Outro Android está usando esta porta; nenhuma ação foi executada')
      if (identity) {
        await this.adb(p, ['emu', 'kill'])
        const deadline = Date.now() + 10000
        while (await this.avdIdentity(p)) {
          if (Date.now() > deadline) throw new Error('Android ainda está desligando; tente novamente em alguns segundos')
          await new Promise(r => setTimeout(r, 200))
        }
      } else if (p.pid && this.processAlive(p.pid)) throw new Error('Não foi possível confirmar a identidade do Android. Feche sua janela antes de continuar.')
    }
    p.status = 'stopped'; p.pid = undefined; p.startedAt = undefined; p.updatedAt = now(); await this.store.save(p)
  }
  async delete(id: string) {
    return this.queue.run(async () => {
      const p = await this.require(id)
      if ((p.engine ?? 'android-emulator') === 'android-emulator') {
        await this.stopInternal(p)
        await fsp.rm(path.join(this.config.avdHome, `${p.avdName}.avd`), { recursive: true, force: true })
        await fsp.rm(path.join(this.config.avdHome, `${p.avdName}.ini`), { force: true })
      }
      await this.store.delete(id) // detach external device; never delete its files
      return { deleted: id }
    })
  }
  private imageDir(p: AndroidProfile) { return path.join(this.config.sdkRoot, ...p.systemImage.split(';')) }
  private async ensureAvd(p: AndroidProfile) {
    if (this.config.dryRun) return
    if ((p.systemImage.endsWith(';arm64-v8a') && process.arch !== 'arm64') || (p.systemImage.endsWith(';x86_64') && process.arch !== 'x64')) throw new Error('A arquitetura da imagem não corresponde ao computador. Use x86_64 em PCs Intel/AMD ou arm64-v8a em computadores ARM64.')
    if (!fileExists(path.join(this.imageDir(p), 'package.xml'))) throw new Error(`Imagem Android não instalada: ${p.systemImage}`)
    const ini = path.join(this.config.avdHome, `${p.avdName}.ini`)
    if (fileExists(ini)) return
    // Do not use --force: existing user disks must never be overwritten by provisioning.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.config.avdManagerPath, ['create', 'avd', '--name', p.avdName, '--package', p.systemImage, '--device', p.deviceId], {
        shell: this.config.platform === 'win32', env: { ...process.env, ANDROID_AVD_HOME: this.config.avdHome, ANDROID_SDK_ROOT: this.config.sdkRoot, ANDROID_HOME: this.config.sdkRoot, ADB: this.config.adbPath }, stdio: ['pipe', 'pipe', 'pipe'] })
      let output = ''; const timeout = setTimeout(() => { child.kill(); reject(new Error('AVD creation timed out')) }, 120000)
      child.stdout.on('data', d => { output = (output + d).slice(-16000) }); child.stderr.on('data', d => { output = (output + d).slice(-16000) })
      child.once('error', e => { clearTimeout(timeout); reject(e) }); child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`AVD creation failed: ${output}`)) })
      child.stdin.on('error', () => undefined); child.stdin.end('no\n')
    })
    await this.tuneAvd(p)
  }
  private async tuneAvd(p: AndroidProfile) {
    if (this.config.dryRun) return
    const filename = path.join(this.config.avdHome, `${p.avdName}.avd`, 'config.ini')
    const s = p.settings ?? this.defaults(), [width, height] = s.resolution.split('x').map(Number)
    const values: Record<string, string> = { 'hw.cpu.ncore': String(s.cores), 'hw.ramSize': String(s.memoryMb), 'vm.heapSize': String(s.heapMb),
      'hw.gpu.enabled': 'yes', 'hw.gpu.mode': s.gpu, 'hw.lcd.width': String(width), 'hw.lcd.height': String(height),
      'hw.lcd.density': String(s.density), 'hw.keyboard': 'yes', 'hw.camera.front': s.cameraFront, 'hw.camera.back': s.cameraBack }
    const original = await fsp.readFile(filename, 'utf8'), remaining = new Set(Object.keys(values))
    const lines = original.split(/\r?\n/).map(line => { const key = line.split('=')[0].trim(); if (!(key in values)) return line; remaining.delete(key); return `${key}=${values[key]}` })
    for (const key of remaining) lines.push(`${key}=${values[key]}`)
    await fsp.writeFile(filename, `${lines.filter(Boolean).join('\n')}\n`)
  }
  private proxyArgument(p: ProxyConfig) {
    if (p.type === 'none') return null
    const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@` : ''
    return `http://${auth}${p.host}:${p.port}`
  }
  serial(p: AndroidProfile) { return p.serial ?? `emulator-${p.emulatorPort}` }
  async require(id: string) { profileIdSchema.parse(id); const p = await this.store.get(id); if (!p) throw new Error('Profile not found'); return p }
  async adb(p: AndroidProfile, args: string[], binary = false, timeout = 15000) {
    if (this.config.dryRun) throw new Error('Esta operação requer Android real; o worker está em simulação')
    return exec(this.config.adbPath, ['-s', this.serial(p), ...args], { timeout, maxBuffer: 16 * 1024 ** 2, encoding: binary ? 'buffer' : 'utf8' })
  }
  async deviceOperation<T>(id: string, operation: (profile: AndroidProfile) => Promise<T>) {
    return this.queue.run(async () => {
      const p = await this.require(id)
      if (this.config.dryRun) throw new Error('Esta operação requer Android real; o worker está em simulação')
      await this.refresh(p)
      if (p.status !== 'running') throw new Error('Aguarde o Android ficar em execução antes desta operação')
      return operation(p)
    })
  }
  async mirror(id: string) {
    if (this.config.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error('Espelhamento nativo requer desktop no computador do worker. Use a prévia de tela ou acesso remoto ao desktop.')
    return this.deviceOperation(id, async p => {
      await this.launch(this.config.scrcpyPath, ['--serial', this.serial(p), '--window-title', `Nexo - ${p.displayName}`], undefined)
      return { opened: true, mode: 'native', audio: 'Depende do Android e da versão do scrcpy instalada' }
    })
  }
  private async avdIdentity(p: AndroidProfile) {
    try { const result = await this.adb(p, ['emu', 'avd', 'name']); return String(result.stdout).split(/\r?\n/)[0].trim() } catch { return null }
  }
  private async refresh(p: AndroidProfile) {
    if (this.config.dryRun) return this.sanitize(p)
    const previous = `${p.status}|${p.lastError}`
    if ((p.engine ?? 'android-emulator') === 'android-emulator') {
      const identity = await this.avdIdentity(p)
      if (identity && identity !== p.avdName) { p.status = 'error'; p.lastError = 'Conflito de porta: dispositivo ADB pertence a outro perfil' }
      else if (identity || p.pid && this.processAlive(p.pid)) await this.bootStatus(p)
      else if (['running', 'starting'].includes(p.status)) { p.status = 'error'; p.lastError = 'Android encerrou antes de concluir a operação; consulte os logs'; p.pid = undefined }
    } else {
      try { await this.bootStatus(p, true) } catch { p.status = p.startedAt && Date.now() - Date.parse(p.startedAt) < this.config.bootTimeoutMs ? 'starting' : 'stopped' }
    }
    if (previous !== `${p.status}|${p.lastError}`) { p.updatedAt = now(); await this.store.save(p) }
    return this.sanitize(p)
  }
  private async bootStatus(p: AndroidProfile, external = false) {
    let boot = false
    try { boot = String((await this.adb(p, ['shell', 'getprop', 'sys.boot_completed'])).stdout).trim() === '1' } catch (e) { if (external) throw e }
    if (boot) { p.status = 'running'; p.lastError = undefined }
    else if (p.startedAt && Date.now() - Date.parse(p.startedAt) > this.config.bootTimeoutMs) { p.status = 'error'; p.lastError = 'Tempo máximo de inicialização excedido. Consulte diagnóstico e logs.' }
    else p.status = 'starting'
  }
  private processAlive(pid: number) { try { process.kill(pid, 0); return true } catch { return false } }
  private sanitize(p: AndroidProfile) { return { ...p, engine: p.engine ?? 'android-emulator', settings: p.settings ?? this.defaults(), proxy: { ...p.proxy, password: p.proxy.password ? '••••••••' : undefined } } }
  async log(id: string) {
    await this.require(id)
    const filename = path.join(this.config.logDir, `${id}.log`)
    const handle = await fsp.open(filename, 'r').catch(() => null)
    if (!handle) return 'Nenhum log disponível'
    try { const stat = await handle.stat(); const buffer = Buffer.alloc(Math.min(stat.size, 32000)); await handle.read(buffer, 0, buffer.length, Math.max(0, stat.size - buffer.length));
      return buffer.toString().replace(/https?:\/\/[^\s@]+@/g, 'http://[credenciais]@') } finally { await handle.close() }
  }
  async backups(id: string) {
    await this.require(id)
    const directory = path.join(this.config.dataDir, 'backups', id)
    return (await fsp.readdir(directory).catch(() => [] as string[])).filter(x => /^backup-[\w-]+$/.test(x))
  }
  async backup(id: string) {
    return this.queue.run(async () => {
      const p = await this.require(id)
      if ((p.engine ?? 'android-emulator') !== 'android-emulator' || this.config.dryRun) throw new Error('Backup completo disponível somente para Android Emulator real')
      await this.stopInternal(p)
      const source = path.join(this.config.avdHome, `${p.avdName}.avd`)
      const size = async (dir: string): Promise<number> => { let bytes = 0; for (const entry of await fsp.readdir(dir, { withFileTypes: true })) { const filename = path.join(dir, entry.name); if (entry.isDirectory()) bytes += await size(filename); else if (entry.isFile()) bytes += (await fsp.stat(filename)).size } return bytes }
      const disk = await fsp.statfs(this.config.dataDir)
      if (disk.bavail * disk.bsize < await size(source) + 1024 ** 3) throw new Error('Espaço insuficiente para backup completo do aparelho')
      const name = `backup-${Date.now()}-${crypto.randomUUID()}`
      const destination = path.join(this.config.dataDir, 'backups', id, name)
      await fsp.mkdir(destination, { recursive: true, mode: 0o700 })
      try {
        await fsp.cp(source, path.join(destination, 'avd'), { recursive: true, filter: src => !src.endsWith('.lock') })
        await fsp.copyFile(path.join(this.config.avdHome, `${p.avdName}.ini`), path.join(destination, 'avd.ini'))
        await fsp.copyFile(path.join(this.config.profileDir, `${id}.json`), path.join(destination, 'profile.json'))
        await fsp.writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ version: 1, id, avdName: p.avdName, createdAt: now() }))
        return { backup: name, stopped: true }
      } catch (e) { await fsp.rm(destination, { recursive: true, force: true }); throw e }
    })
  }
  async restore(id: string, name: string) {
    return this.queue.run(async () => {
      const p = await this.require(id)
      if ((p.engine ?? 'android-emulator') !== 'android-emulator' || this.config.dryRun) throw new Error('Restauração requer Android Emulator real')
      if (!(await this.backups(id)).includes(name)) throw new Error('Backup não encontrado')
      await this.stopInternal(p)
      const backup = path.join(this.config.dataDir, 'backups', id, name)
      const restoredProfile = this.store.readBackup(await fsp.readFile(path.join(backup, 'profile.json'), 'utf8'), id)
      const manifest = JSON.parse(await fsp.readFile(path.join(backup, 'manifest.json'), 'utf8'))
      if (manifest.id !== id || manifest.avdName !== p.avdName) throw new Error('Backup pertence a outro perfil')
      const destination = path.join(this.config.avdHome, `${p.avdName}.avd`), stage = `${destination}.restore-${crypto.randomUUID()}`, old = `${destination}.previous-${crypto.randomUUID()}`
      try {
        await fsp.cp(path.join(backup, 'avd'), stage, { recursive: true })
        await fsp.rename(destination, old)
        try { await fsp.rename(stage, destination) } catch (e) { await fsp.rename(old, destination); throw e }
        restoredProfile.status = 'stopped'; restoredProfile.pid = undefined; restoredProfile.startedAt = undefined; restoredProfile.updatedAt = now()
        try { await this.store.save(restoredProfile) } catch (e) { await fsp.rm(destination, {recursive:true,force:true}); await fsp.rename(old, destination); throw e }
        await fsp.rm(old, { recursive: true, force: true })
        return { restored: name }
      } finally { await fsp.rm(stage, { recursive: true, force: true }) }
    })
  }
}
