import path from 'node:path'

const isWindows = process.platform === 'win32'

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
  const sdkRoot = process.env.ANDROID_SDK_ROOT ?? (isWindows ? path.join(windowsLocalAppData(), 'Android', 'Sdk') : '/opt/android-sdk')
  const dataDir = process.env.WORKER_DATA_DIR ?? (isWindows ? path.join(windowsLocalAppData(), 'NexoMobile') : '/var/lib/nexo-mobile')
  const executable = (name: string, windowsExtension: string) => `${name}${isWindows ? windowsExtension : ''}`
  return {
    apiToken,
    encryptionKey: requiredEncryptionKey(apiToken),
    port: Number(process.env.WORKER_PORT ?? 8787),
    host: process.env.WORKER_HOST ?? '127.0.0.1',
    dataDir,
    profileDir: path.join(dataDir, 'profiles'),
    logDir: path.join(dataDir, 'logs'),
    avdHome: process.env.ANDROID_AVD_HOME ?? path.join(dataDir, 'avd'),
    sdkRoot,
    adbPath: path.join(sdkRoot, 'platform-tools', executable('adb', '.exe')),
    emulatorPath: path.join(sdkRoot, 'emulator', executable('emulator', '.exe')),
    avdManagerPath: path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', executable('avdmanager', '.bat')),
    systemImage: process.env.ANDROID_SYSTEM_IMAGE ?? 'system-images;android-35;google_apis_playstore;x86_64',
    deviceId: process.env.ANDROID_DEVICE_ID ?? 'pixel_7_pro',
    platform: process.platform,
    headless: process.env.ANDROID_HEADLESS ? process.env.ANDROID_HEADLESS === 'true' : !isWindows,
    emulatorGpu: process.env.ANDROID_EMULATOR_GPU ?? (isWindows ? 'host' : 'swiftshader_indirect'),
    emulatorMemoryMb: Number(process.env.ANDROID_EMULATOR_MEMORY_MB ?? 4096),
    emulatorCores: Number(process.env.ANDROID_EMULATOR_CORES ?? 4),
    emulatorHeapMb: Number(process.env.ANDROID_EMULATOR_HEAP_MB ?? 512),
    emulatorResolution: process.env.ANDROID_EMULATOR_RESOLUTION ?? (isWindows ? '540x960' : '720x1280'),
    emulatorDensity: Number(process.env.ANDROID_EMULATOR_DENSITY ?? (isWindows ? 240 : 320)),
    maxActiveEmulators: Number(process.env.ANDROID_MAX_ACTIVE_EMULATORS ?? 1),
    dryRun: process.env.ANDROID_DRY_RUN === 'true',
  }
}

export type WorkerConfig = ReturnType<typeof getConfig>
