const SENSITIVE_KEY = /(^|[_-])(cookie|cookies|session|sessionid|sid|sid_guard|token|msToken|auth|authorization|jwt|credential|password|passwd|secret)([_-]|$)/i

export type SafeProvisionState = Record<string, unknown>

export function assertProvisionStateIsSafe(value: unknown, path = 'state'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertProvisionStateIsSafe(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error(`Authentication/session material is not accepted in provisioning payloads (${path}.${key})`)
    }
    assertProvisionStateIsSafe(child, `${path}.${key}`)
  }
}

export function redactProvisionState(value: SafeProvisionState): SafeProvisionState {
  assertProvisionStateIsSafe(value)
  return structuredClone(value)
}
