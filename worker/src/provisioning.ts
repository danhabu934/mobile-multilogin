const SENSITIVE_FRAGMENTS = [
  'cookie',
  'session',
  'sessionid',
  'sidguard',
  'mstoken',
  'token',
  'auth',
  'authorization',
  'jwt',
  'credential',
  'password',
  'passwd',
  'secret',
]

export type SafeProvisionState = Record<string, unknown>

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SENSITIVE_FRAGMENTS.some(fragment => normalized.includes(fragment))
}

export function assertProvisionStateIsSafe(value: unknown, path = 'state'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertProvisionStateIsSafe(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      throw new Error(`Authentication/session material is not accepted in provisioning payloads (${path}.${key})`)
    }
    assertProvisionStateIsSafe(child, `${path}.${key}`)
  }
}

export function redactProvisionState(value: SafeProvisionState): SafeProvisionState {
  assertProvisionStateIsSafe(value)
  return structuredClone(value)
}
