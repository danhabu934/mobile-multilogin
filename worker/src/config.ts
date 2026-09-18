import path from 'node:path'

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
  const sdkRoot = process.env.ANDROID_SDK_ROOT ?? '/opt/android-sdk'
  const dataDir = process.env.WORKER_DATA_DIR ?? '/var/lib/nexo-mobile'
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
    adbPath: path.join(sdkRoot, 'platform-tools', 'adb'),
    emulatorPath: path.join(sdkRoot, 'emulator', 'emulator'),
    avdManagerPath: path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
    systemImage: process.env.ANDROID_SYSTEM_IMAGE ?? 'system-images;android-34;google_apis_playstore;x86_64',
    deviceId: process.env.ANDROID_DEVICE_ID ?? 'pixel_7_pro',
    dryRun: process.env.ANDROID_DRY_RUN === 'true',
  }
}

export type WorkerConfig = ReturnType<typeof getConfig>
