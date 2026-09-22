import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import type { WorkerConfig } from './config.js'
import { assertProvisionStateIsSafe, type SafeProvisionState } from './provisioning.js'

type RuntimeProfile = {
  id: string
  emulatorPort: number
  status: string
}

export type ProvisionRequest = {
  android?: {
    locale?: string
    timezone?: string
    timeFormat?: '12' | '24'
    animationScale?: number
  }
  launch?: {
    packageName: string
    activity?: string
  }
  state?: SafeProvisionState
}

const execFileAsync = promisify(execFile)

export class ProfileProvisioner {
  constructor(private readonly config: WorkerConfig) {}

  async provision(profile: RuntimeProfile, input: ProvisionRequest) {
    assertProvisionStateIsSafe(input.state ?? {})
    if (profile.status !== 'running') throw new Error('Profile must be running before provisioning')

    const applied: string[] = []
    if (this.config.dryRun) {
      if (input.android?.locale) applied.push('locale')
      if (input.android?.timezone) applied.push('timezone')
      if (input.android?.timeFormat) applied.push('timeFormat')
      if (input.android?.animationScale !== undefined) applied.push('animationScale')
      if (input.launch) applied.push('launch')
      return { profileId: profile.id, applied, dryRun: true }
    }

    const serial = `emulator-${profile.emulatorPort}`
    await this.waitForBoot(serial)

    const android = input.android ?? {}
    if (android.locale) {
      await this.adb(serial, ['shell', 'settings', 'put', 'system', 'system_locales', android.locale])
      applied.push('locale')
    }
    if (android.timezone) {
      await this.adb(serial, ['shell', 'settings', 'put', 'global', 'time_zone', android.timezone])
      applied.push('timezone')
    }
    if (android.timeFormat) {
      await this.adb(serial, ['shell', 'settings', 'put', 'system', 'time_12_24', android.timeFormat])
      applied.push('timeFormat')
    }
    if (android.animationScale !== undefined) {
      const scale = String(android.animationScale)
      await this.adb(serial, ['shell', 'settings', 'put', 'global', 'window_animation_scale', scale])
      await this.adb(serial, ['shell', 'settings', 'put', 'global', 'transition_animation_scale', scale])
      await this.adb(serial, ['shell', 'settings', 'put', 'global', 'animator_duration_scale', scale])
      applied.push('animationScale')
    }

    if (input.launch) {
      const { packageName, activity } = input.launch
      if (activity) {
        const component = activity.includes('/') ? activity : `${packageName}/${activity}`
        await this.adb(serial, ['shell', 'am', 'start', '-W', '-n', component])
      } else {
        await this.adb(serial, ['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'])
      }
      applied.push('launch')
    }

    return { profileId: profile.id, applied, dryRun: false }
  }

  private async waitForBoot(serial: string) {
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      try {
        const result = await execFileAsync(this.config.adbPath, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], {
          timeout: 5_000,
          encoding: 'utf8',
        })
        if (result.stdout.trim() === '1') return
      } catch {
        // Emulator can briefly reject ADB while Android is still starting.
      }
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }
    throw new Error('Android boot did not complete before provisioning timeout')
  }

  private async adb(serial: string, args: string[]) {
    const result = await execFileAsync(this.config.adbPath, ['-s', serial, ...args], {
      timeout: 20_000,
      encoding: 'utf8',
    })
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() }
  }
}
