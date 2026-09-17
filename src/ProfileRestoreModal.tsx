import { ChangeEvent, FormEvent, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileKey2, ShieldCheck, Upload, X } from 'lucide-react'
import {
  decryptSnapshot,
  downloadSnapshot,
  encryptSnapshot,
  ensurePersistentBrowser,
  queuePortableState,
  type PortableBrowserState,
  type ProfileSnapshot,
} from './profileRestore'

type ProfileLite = {
  id: string
  name: string
  group: string
  device: string
  android: string
  proxyType: string
  proxyHost: string
  proxyPort: string
}

type ImportLite = {
  profileId: string
  fileName: string
  host: string
  url: string
  payload: PortableBrowserState
}

export type RestoredProfileState = {
  profileId: string
  sourceProfileId: string
  fileName: string
  url: string
  host: string
  payload: PortableBrowserState
}

type Props = {
  profiles: ProfileLite[]
  imports: ImportLite[]
  initialProfileId?: string
  onClose: () => void
  onRestored: (value: RestoredProfileState) => void
}

export default function ProfileRestoreModal({ profiles, imports, initialProfileId, onClose, onRestored }: Props) {
  const [mode, setMode] = useState<'export' | 'restore'>('export')
  const [profileId, setProfileId] = useState(initialProfileId || profiles[0]?.id || '')
  const [startUrl, setStartUrl] = useState('https://www.tiktok.com/')
  const [passphrase, setPassphrase] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const profile = profiles.find(item => item.id === profileId)
  const latestImport = useMemo(() => imports.find(item => item.profileId === profileId), [imports, profileId])

  const changeProfile = (value: string) => {
    setProfileId(value)
    const imported = imports.find(item => item.profileId === value)
    if (imported?.url) setStartUrl(imported.url)
    setMessage('')
    setError('')
  }

  const exportProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (!profile) return
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const parsed = new URL(startUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Informe uma URL http/https válida.')
      const state = latestImport?.payload || { cookies: [], localStorage: {} }
      const snapshot: ProfileSnapshot = {
        version: 1,
        kind: 'nexo-profile-restore',
        createdAt: new Date().toISOString(),
        profile: {
          id: profile.id,
          name: profile.name,
          group: profile.group,
          device: profile.device,
          android: profile.android,
          proxyType: profile.proxyType,
          proxyHost: profile.proxyHost,
          proxyPort: profile.proxyPort,
        },
        browser: { startUrl: parsed.toString(), state },
      }
      const encrypted = await encryptSnapshot(snapshot, passphrase)
      const date = new Date().toISOString().slice(0, 10)
      downloadSnapshot(`${profile.id.toLowerCase()}-${date}.nexo.json`, encrypted)
      ensurePersistentBrowser(profile.id)
      setMessage('Snapshot criptografado criado. O worker também recebeu a preparação do navegador persistente.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o snapshot.')
    } finally {
      setBusy(false)
    }
  }

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setError('')
    setMessage('')
    setFileName('')
    setFileContent('')
    if (!file) return
    if (file.size > 3 * 1024 * 1024) {
      setError('O snapshot deve ter no máximo 3 MB.')
      return
    }
    try {
      setFileName(file.name)
      setFileContent(await file.text())
    } catch {
      setError('Não foi possível ler o arquivo selecionado.')
    } finally {
      event.target.value = ''
    }
  }

  const restoreProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (!profileId || !fileContent) return
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const snapshot = await decryptSnapshot(fileContent, passphrase)
      const url = new URL(snapshot.browser.startUrl)
      queuePortableState(profileId, url.toString(), snapshot.browser.state)
      onRestored({
        profileId,
        sourceProfileId: snapshot.profile.id,
        fileName: fileName || 'snapshot.nexo.json',
        url: url.toString(),
        host: url.hostname,
        payload: snapshot.browser.state,
      })
      setMessage(`Snapshot de ${snapshot.profile.name} preparado para ${profileId}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível restaurar o snapshot.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="modal-layer"><div className="modal" style={{width:'min(760px,calc(100vw - 30px))'}}>
    <div className="modal-head">
      <div><p className="eyebrow">PROFILE RESTORE</p><h2>Sessão persistente e snapshot</h2></div>
      <button className="icon-button" onClick={onClose}><X size={20}/></button>
    </div>

    <div style={{padding:'0 24px 14px', display:'flex', gap:8}}>
      <button type="button" className={mode === 'export' ? 'primary' : 'secondary'} onClick={() => { setMode('export'); setError(''); setMessage('') }}><Download size={16}/> Exportar snapshot</button>
      <button type="button" className={mode === 'restore' ? 'primary' : 'secondary'} onClick={() => { setMode('restore'); setError(''); setMessage('') }}><Upload size={16}/> Restaurar snapshot</button>
    </div>

    <div style={{padding:'0 24px 14px'}}>
      <div className="info-box" style={{margin:0}}><ShieldCheck size={19}/><span><strong>Persistência por perfil</strong><small>O worker usa um diretório Chromium fixo e isolado por perfil. Depois do login normal, o estado desse navegador permanece entre reinicializações. O arquivo exportável contém apenas configuração e dados portáveis filtrados.</small></span></div>
    </div>

    {mode === 'export' ? <form onSubmit={exportProfile}>
      <div className="form-grid">
        <label>Perfil<select value={profileId} onChange={e => changeProfile(e.target.value)}>{profiles.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label>
        <label>URL inicial<input value={startUrl} onChange={e => setStartUrl(e.target.value)} placeholder="https://www.tiktok.com/"/></label>
        <label className="full">Senha do snapshot<input type="password" minLength={8} required value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder="Mínimo de 8 caracteres"/></label>
        <div className="review-row full"><span>Dados portáveis atuais</span><strong>{latestImport ? `${latestImport.payload.cookies.length} cookies · ${Object.keys(latestImport.payload.localStorage).length} preferências` : 'Nenhum dado importado · somente configuração'}</strong></div>
      </div>
      {error && <Result tone="error" text={error}/>} {message && <Result tone="success" text={message}/>} 
      <div className="modal-actions"><span/><button type="button" className="ghost" onClick={onClose}>Fechar</button><button className="primary" disabled={busy || !profileId}>{busy ? 'Criptografando…' : <><FileKey2 size={16}/> Criar snapshot</>}</button></div>
    </form> : <form onSubmit={restoreProfile}>
      <div className="form-grid">
        <label className="full">Perfil de destino<select value={profileId} onChange={e => changeProfile(e.target.value)}>{profiles.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label>
        <label className="full" style={{display:'flex', alignItems:'center', justifyContent:'center', gap:10, minHeight:80, border:'1px dashed #31506d', borderRadius:10, background:'#0c1d2f', cursor:'pointer'}}>
          <Upload size={20}/>{fileName || 'Selecionar .nexo.json'}
          <input type="file" accept="application/json,.json,.nexo" onChange={readFile} style={{display:'none'}}/>
        </label>
        <label className="full">Senha do snapshot<input type="password" minLength={8} required value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder="Senha usada na exportação"/></label>
        <div className="warning full"><AlertTriangle size={18}/><span>A restauração reaplica somente preferências e cookies portáveis aprovados. Credenciais de autenticação e armazenamento privado de aplicativos não fazem parte do pacote.</span></div>
      </div>
      {error && <Result tone="error" text={error}/>} {message && <Result tone="success" text={message}/>} 
      <div className="modal-actions"><span/><button type="button" className="ghost" onClick={onClose}>Fechar</button><button className="primary" disabled={busy || !fileContent || !profileId}>{busy ? 'Restaurando…' : <><Upload size={16}/> Restaurar no perfil</>}</button></div>
    </form>}
  </div></div>
}

function Result({ tone, text }: { tone: 'error' | 'success', text: string }) {
  const ok = tone === 'success'
  return <div style={{margin:'0 24px 12px', padding:12, display:'flex', gap:9, alignItems:'flex-start', border:`1px solid ${ok ? '#1d5a49' : '#663141'}`, borderRadius:9, background:ok ? '#0d2a23' : '#25131a', color:ok ? '#a8efd2' : '#ff9aaa', fontSize:11}}>{ok ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span>{text}</span></div>
}
