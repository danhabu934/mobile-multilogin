import path from 'node:path'
import os from 'node:os'
import { settingsSchema } from './schemas.js'

const isWindows = process.platform === 'win32'
const isMac = process.platform === 'darwin'
function numberEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`)
  return value
}

function windowsLocalAppData() {
  return process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? process.cwd(), 'AppData', 'Local')
}

function requiredToken(): string {
  const value = process.env.WORKER_API_TOKEN ?? ''
  if (value.length < 32) {
    throw new Error('WORKER_API_TOKEN must contain at least 32 characters')
  }
  return value
}

function requiredEncryptionKey(apiToken: string): string {
  const value = process.env.WORKER_ENCRYPTION_KEY ?? apiToken
  if (value.length < 32) {
    throw new Error('WORKER_ENCRYPTION_KEY must contain at least 32 characters')
  }
  return value
}

export function getConfig() {
  const apiToken = requiredToken()
  const sdkRoot = process.env.ANDROID_SDK_ROOT ?? (isWindows ? path.join(windowsLocalAppData(), 'Android', 'Sdk') : isMac ? path.join(os.homedir(), 'Library', 'Android', 'sdk') : '/opt/android-sdk')
  const dataDir = process.env.WORKER_DATA_DIR ?? (isWindows ? path.join(windowsLocalAppData(), 'NexoMobile') : isMac ? path.join(os.homedir(), 'Library', 'Application Support', 'NexoMobile') : '/var/lib/nexo-mobile')
  const executable = (name: string, windowsExtension: string) => `${name}${isWindows ? windowsExtension : ''}`
  const config = {
    apiToken,
    encryptionKey: requiredEncryptionKey(apiToken),
    port: numberEnv('WORKER_PORT', 8787, 1024, 65535),
    host: process.env.WORKER_HOST ?? '127.0.0.1',
    dataDir,
    profileDir: path.join(dataDir, 'profiles'),
    logDir: path.join(dataDir, 'logs'),
    avdHome: process.env.ANDROID_AVD_HOME ?? path.join(dataDir, 'avd'),
    sdkRoot,
    adbPath: process.env.ADB_BIN ?? path.join(sdkRoot, 'platform-tools', executable('adb', '.exe')),
    emulatorPath: path.join(sdkRoot, 'emulator', executable('emulator', '.exe')),
    avdManagerPath: path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', executable('avdmanager', '.bat')),
    systemImage: process.env.ANDROID_SYSTEM_IMAGE ?? `system-images;android-35;google_apis_playstore;${process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'}`,
    deviceId: process.env.ANDROID_DEVICE_ID ?? 'pixel_7_pro',
    platform: process.platform,
    headless: process.env.ANDROID_HEADLESS ? process.env.ANDROID_HEADLESS === 'true' : process.platform === 'linux',
    emulatorGpu: process.env.ANDROID_EMULATOR_GPU ?? 'auto',
    emulatorMemoryMb: numberEnv('ANDROID_EMULATOR_MEMORY_MB', 4096, 1536, 16384),
    emulatorCores: numberEnv('ANDROID_EMULATOR_CORES', 4, 1, 16),
    emulatorHeapMb: numberEnv('ANDROID_EMULATOR_HEAP_MB', 512, 128, 2048),
    emulatorResolution: process.env.ANDROID_EMULATOR_RESOLUTION ?? (isWindows ? '540x960' : '720x1280'),
    emulatorDensity: numberEnv('ANDROID_EMULATOR_DENSITY', isWindows ? 240 : 320, 120, 640),
    maxActiveEmulators: numberEnv('ANDROID_MAX_ACTIVE_EMULATORS', 1, 1, 32),
    dryRun: process.env.ANDROID_DRY_RUN === 'true',
    coldBoot: process.env.ANDROID_COLD_BOOT_ON_START !== 'false',
    bootTimeoutMs: numberEnv('ANDROID_BOOT_TIMEOUT_MS', 180000, 30000, 600000),
    scrcpyPath: process.env.SCRCPY_BIN ?? 'scrcpy',
    blueStacksPlayer: process.env.BLUESTACKS_PLAYER_PATH ?? '',
    uploadLimitMb: numberEnv('ANDROID_UPLOAD_LIMIT_MB', 512, 1, 2048),
  }
  settingsSchema.parse({ memoryMb:config.emulatorMemoryMb, cores:config.emulatorCores, heapMb:config.emulatorHeapMb, resolution:config.emulatorResolution, density:config.emulatorDensity, gpu:config.emulatorGpu, cameraFront:'none', cameraBack:'emulated' })
  if (!['true','false'].includes(process.env.ANDROID_DRY_RUN ?? 'false')) throw new Error('ANDROID_DRY_RUN must be true or false')
  return config
}

export type WorkerConfig = ReturnType<typeof getConfig>

