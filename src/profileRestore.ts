export type PortableCookie = {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  sameSite?: string
}

export type PortableBrowserState = {
  cookies: PortableCookie[]
  localStorage: Record<string, string>
}

export type ProfileSnapshot = {
  version: 1
  kind: 'nexo-profile-restore'
  createdAt: string
  profile: {
    id: string
    name: string
    group: string
    device: string
    android: string
    proxyType: string
    proxyHost: string
    proxyPort: string
  }
  browser: {
    startUrl: string
    state: PortableBrowserState
  }
}

export type EncryptedSnapshot = {
  version: 1
  kind: 'nexo-encrypted-profile'
  kdf: 'PBKDF2-SHA256'
  cipher: 'AES-GCM-256'
  iterations: number
  salt: string
  iv: string
  data: string
}

export type WorkerCommand =
  | {
      id: string
      type: 'ensure_browser_profile'
      profileId: string
      createdAt: string
      payload: {
        engine: 'chromium'
        persistent: true
        isolateStorage: true
        userDataDir: string
      }
    }
  | {
      id: string
      type: 'open_login_assist'
      profileId: string
      createdAt: string
      payload: { url: string }
    }
  | {
      id: string
      type: 'apply_portable_browser_state'
      profileId: string
      createdAt: string
      payload: {
        url: string
        state: PortableBrowserState
      }
    }

const sensitiveKeyPattern = /(session|sessid|sessionid|auth|token|jwt|bearer|credential|login|refresh|access[_-]?token|sid|sso|csrf|xsrf|ticket|secret|pass|oauth)/i
const safePreferencePattern = /(lang|locale|language|theme|consent|preference|prefs|timezone|time_zone|tz|currency|country|region|analytics|utm|campaign|device|screen|layout|appearance)/i

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function sanitizePortableState(state: PortableBrowserState): PortableBrowserState {
  const cookies = (Array.isArray(state.cookies) ? state.cookies : []).filter(cookie => {
    return Boolean(
      cookie?.name &&
      cookie?.value &&
      !sensitiveKeyPattern.test(cookie.name) &&
      safePreferencePattern.test(cookie.name),
    )
  })

  const localStorage = Object.fromEntries(
    Object.entries(state.localStorage || {}).filter(([key]) => {
      return !sensitiveKeyPattern.test(key) && safePreferencePattern.test(key)
    }),
  )

  return { cookies, localStorage }
}

export async function encryptSnapshot(snapshot: ProfileSnapshot, passphrase: string) {
  if (passphrase.length < 8) throw new Error('Use uma senha com pelo menos 8 caracteres.')

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const iterations = 180_000
  const key = await deriveKey(passphrase, salt, iterations)
  const encoded = new TextEncoder().encode(JSON.stringify(snapshot))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  const envelope: EncryptedSnapshot = {
    version: 1,
    kind: 'nexo-encrypted-profile',
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-GCM-256',
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  }

  return JSON.stringify(envelope, null, 2)
}

export async function decryptSnapshot(raw: string, passphrase: string): Promise<ProfileSnapshot> {
  const envelope = JSON.parse(raw) as EncryptedSnapshot
  if (envelope?.version !== 1 || envelope?.kind !== 'nexo-encrypted-profile') {
    throw new Error('Arquivo de snapshot incompatível.')
  }
  if (envelope.kdf !== 'PBKDF2-SHA256' || envelope.cipher !== 'AES-GCM-256') {
    throw new Error('Formato criptográfico não suportado.')
  }

  const salt = base64ToBytes(envelope.salt)
  const iv = base64ToBytes(envelope.iv)
  const data = base64ToBytes(envelope.data)
  const key = await deriveKey(passphrase, salt, envelope.iterations)

  let clear: ArrayBuffer
  try {
    clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  } catch {
    throw new Error('Senha incorreta ou snapshot corrompido.')
  }

  const snapshot = JSON.parse(new TextDecoder().decode(clear)) as ProfileSnapshot
  if (snapshot?.version !== 1 || snapshot?.kind !== 'nexo-profile-restore' || !snapshot.profile?.id) {
    throw new Error('Conteúdo do snapshot inválido.')
  }

  snapshot.browser.state = sanitizePortableState(snapshot.browser.state)
  return snapshot
}

export function downloadSnapshot(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function queueWorkerCommand(command: WorkerCommand) {
  const key = 'nexo-worker-command-queue'
  const stored = localStorage.getItem(key)
  const queue = stored ? JSON.parse(stored) as WorkerCommand[] : []
  const next = [...queue, command].slice(-100)
  localStorage.setItem(key, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('nexo-worker-queue-changed', { detail: next.length }))
  return next.length
}

export function ensurePersistentBrowser(profileId: string) {
  return queueWorkerCommand({
    id: `CMD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'ensure_browser_profile',
    profileId,
    createdAt: new Date().toISOString(),
    payload: {
      engine: 'chromium',
      persistent: true,
      isolateStorage: true,
      userDataDir: `/var/lib/nexo/profiles/${profileId}/chromium`,
    },
  })
}

export function queueLoginAssist(profileId: string, url: string) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL inválida.')
  ensurePersistentBrowser(profileId)
  return queueWorkerCommand({
    id: `CMD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'open_login_assist',
    profileId,
    createdAt: new Date().toISOString(),
    payload: { url: parsed.toString() },
  })
}

export function queuePortableState(profileId: string, url: string, state: PortableBrowserState) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL inválida.')
  const safeState = sanitizePortableState(state)
  ensurePersistentBrowser(profileId)
  return queueWorkerCommand({
    id: `CMD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'apply_portable_browser_state',
    profileId,
    createdAt: new Date().toISOString(),
    payload: { url: parsed.toString(), state: safeState },
  })
}
