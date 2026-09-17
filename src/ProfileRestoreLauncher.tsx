import { useEffect, useState } from 'react'
import { DatabaseBackup, RadioTower } from 'lucide-react'
import ProfileRestoreModal, { type RestoredProfileState } from './ProfileRestoreModal'

type StoredProfile = {
  id: string
  name: string
  group: string
  device: string
  android: string
  proxyType: string
  proxyHost: string
  proxyPort: string
}

type StoredImport = {
  id: string
  profileId: string
  fileName: string
  host: string
  url: string
  safeCookieCount: number
  blockedCookieCount: number
  safeStorageCount: number
  blockedStorageCount: number
  createdAt: string
  payload: {
    cookies: Array<{ name: string, value: string, domain?: string, path?: string, secure?: boolean, sameSite?: string }>
    localStorage: Record<string, string>
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

export default function ProfileRestoreLauncher() {
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState(() => readJson<StoredProfile[]>('nexo-profiles', []))
  const [imports, setImports] = useState(() => readJson<StoredImport[]>('nexo-safe-imports', []))
  const [queueCount, setQueueCount] = useState(() => readJson<unknown[]>('nexo-worker-command-queue', []).length)

  useEffect(() => {
    const refresh = () => {
      setProfiles(readJson<StoredProfile[]>('nexo-profiles', []))
      setImports(readJson<StoredImport[]>('nexo-safe-imports', []))
      setQueueCount(readJson<unknown[]>('nexo-worker-command-queue', []).length)
    }

    refresh()
    const timer = window.setInterval(refresh, 1200)
    window.addEventListener('storage', refresh)
    window.addEventListener('nexo-worker-queue-changed', refresh as EventListener)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('storage', refresh)
      window.removeEventListener('nexo-worker-queue-changed', refresh as EventListener)
    }
  }, [])

  const persistRestored = (restored: RestoredProfileState) => {
    const next: StoredImport = {
      id: `RST-${Date.now()}`,
      profileId: restored.profileId,
      fileName: restored.fileName,
      host: restored.host,
      url: restored.url,
      safeCookieCount: restored.payload.cookies.length,
      blockedCookieCount: 0,
      safeStorageCount: Object.keys(restored.payload.localStorage).length,
      blockedStorageCount: 0,
      createdAt: new Date().toISOString(),
      payload: restored.payload,
    }
    const current = readJson<StoredImport[]>('nexo-safe-imports', [])
    const updated = [next, ...current].slice(0, 50)
    localStorage.setItem('nexo-safe-imports', JSON.stringify(updated))
    setImports(updated)
  }

  if (!profiles.length) return null

  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Sessão persistente e Profile Restore"
      style={{
        position:'fixed', right:22, bottom:22, zIndex:80, minHeight:44, padding:'0 16px',
        display:'flex', alignItems:'center', gap:9, border:'1px solid #2d5f89', borderRadius:12,
        background:'#0b2540', color:'#d8ecff', boxShadow:'0 16px 40px rgba(0,0,0,.34)',
        fontSize:11, fontWeight:800, letterSpacing:'.02em', cursor:'pointer'
      }}
    >
      <DatabaseBackup size={18}/>
      Sessão persistente
      {queueCount > 0 && <span style={{display:'inline-flex', alignItems:'center', gap:5, marginLeft:3, padding:'3px 7px', borderRadius:999, background:'#153c5f', color:'#8bc8ff'}}><RadioTower size={12}/>{queueCount}</span>}
    </button>

    {open && <ProfileRestoreModal
      profiles={profiles}
      imports={imports}
      onClose={() => setOpen(false)}
      onRestored={persistRestored}
    />}
  </>
}
