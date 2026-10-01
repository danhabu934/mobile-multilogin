import DeviceConsole from './DeviceConsole'
import { workerClient, downloadJson } from './workerClient'
import type { Catalogue, DeviceSettings, WorkerApi } from './workerClient'
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown,
  Cloud, Download, ExternalLink, FileJson,
  Filter, Gauge, Globe2, HardDrive, LayoutGrid, Menu,
  MoreHorizontal, Play, Plus, Search, Server, Settings, ShieldCheck,
  Smartphone, Square, Trash2, Upload, Wifi, X, Zap
} from 'lucide-react'

type Status = 'ready' | 'starting' | 'running' | 'offline' | 'error'
type Profile = {
  id: string
  name: string
  group: string
  device: string
  android: string
  status: Status
  proxyType: string
  proxyHost: string
  proxyPort: string
  proxyUser: string
  proxyPassword: string
  ip: string
  apps: number
  lastUsed: string
  engine?: string
  serial?: string
  instanceName?: string
  systemImage?: string
  deviceId?: string
  settings?: DeviceSettings
  lastError?: string
  notes?: string
}

type WorkerStatus = 'created' | 'starting' | 'running' | 'stopped' | 'error'
type WorkerProfile = {
  id: string
  displayName: string
  deviceId: string
  systemImage: string
  proxy: { type: 'none' | 'http' | 'https' | 'socks5'; host?: string; port?: number; username?: string }
  status: WorkerStatus
  createdAt: string
  updatedAt: string
  lastError?: string
  engine?: string
  serial?: string
  instanceName?: string
  group?: string
  settings?: DeviceSettings
  notes?: string
}
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

type SafeCookie = {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  sameSite?: string
}

type SafeImportPayload = {
  cookies: SafeCookie[]
  localStorage: Record<string, string>
}

type ImportRecord = {
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
  payload: SafeImportPayload
}

type ImportAnalysis = {
  fileName: string
  safeCookies: SafeCookie[]
  blockedCookieNames: string[]
  safeStorage: Record<string, string>
  blockedStorageKeys: string[]
}

type JsonRecord = Record<string, unknown>

const statusLabel: Record<Status, string> = { ready: 'Pronto', running: 'Em execução', offline: 'Desligado', starting: 'Iniciando', error: 'Erro' }
const sensitiveKeyPattern = /(session|sessid|sessionid|auth|token|jwt|bearer|credential|login|refresh|access[_-]?token|sid|sso|csrf|xsrf|ticket|secret|pass|oauth)/i
const safePreferencePattern = /(lang|locale|language|theme|consent|preference|prefs|timezone|time_zone|tz|currency|country|region|analytics|utm|campaign|device|screen|layout|appearance)/i

function workerToProfile(profile: WorkerProfile): Profile {
  const status: Status = profile.status === 'created' ? 'ready' : profile.status === 'stopped' ? 'offline' : profile.status
  const androidApi = profile.systemImage.match(/android-(\d+)/)?.[1]
  return {
    id: profile.id,
    name: profile.displayName,
    group: profile.group || 'Android local',
    device: profile.deviceId.replaceAll('_', ' '),
    android: profile.engine && profile.engine !== 'android-emulator' ? 'Android do dispositivo' : androidApi ? `Android ${{'33':'13','34':'14','35':'15','36':'16'}[androidApi] ?? `API ${androidApi}`}` : 'Android',
    status,
    proxyType: profile.proxy.type === 'none' ? 'SEM PROXY' : profile.proxy.type.toUpperCase(),
    proxyHost: profile.proxy.host ?? '—',
    proxyPort: profile.proxy.port ? String(profile.proxy.port) : '',
    proxyUser: profile.proxy.username ?? '',
    proxyPassword: '',
    ip: profile.proxy.host ? `Proxy ${profile.proxy.host}:${profile.proxy.port} · saída não verificada` : 'Conexão direta',
    apps: -1,
    engine: profile.engine ?? 'android-emulator', serial: profile.serial, instanceName: profile.instanceName, settings: profile.settings,
    systemImage: profile.systemImage, deviceId: profile.deviceId, lastError: profile.lastError, notes: profile.notes,
    lastUsed: profile.status === 'running' ? 'Em uso agora' : new Date(profile.updatedAt).toLocaleString('pt-BR'),
  }
}

function normalizeWorkerUrl(value: string) {
  return value.trim().replace(/\/$/, '')
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null
}

function getCookieCandidates(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  const root = getRecord(payload)
  if (!root) return []
  const data = getRecord(root.data)
  const profile = getRecord(root.profile)
  const browser = getRecord(root.browser)
  const candidates = [root.cookies, data?.cookies, profile?.cookies, browser?.cookies]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(isRecord)
  }
  return []
}

function normalizeStorage(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    return value.reduce<Record<string, string>>((acc, item) => {
      if (!isRecord(item)) return acc
      const key = typeof item.key === 'string' ? item.key : typeof item.name === 'string' ? item.name : ''
      if (!key) return acc
      const raw = item.value
      acc[key] = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')
      return acc
    }, {})
  }
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => [key, typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')]))
}

function getStorageCandidates(payload: unknown): Record<string, string> {
  const root = getRecord(payload)
  if (!root) return {}
  const data = getRecord(root.data)
  const profile = getRecord(root.profile)
  const browser = getRecord(root.browser)
  const candidates = [root.localStorage, data?.localStorage, profile?.localStorage, browser?.localStorage]
  for (const candidate of candidates) {
    const normalized = normalizeStorage(candidate)
    if (Object.keys(normalized).length) return normalized
  }
  return {}
}

function sanitizeImport(payload: unknown, fileName: string): ImportAnalysis {
  const cookieCandidates = getCookieCandidates(payload)
  const safeCookies: SafeCookie[] = []
  const blockedCookieNames: string[] = []

  for (const cookie of cookieCandidates) {
    const name = typeof cookie.name === 'string' ? cookie.name : ''
    const value = typeof cookie.value === 'string' ? cookie.value : ''
    const httpOnly = cookie.httpOnly === true
    const allowed = Boolean(name && value && !httpOnly && !sensitiveKeyPattern.test(name) && safePreferencePattern.test(name))
    if (!allowed) {
      blockedCookieNames.push(name || '(sem nome)')
      continue
    }
    safeCookies.push({
      name,
      value,
      domain: typeof cookie.domain === 'string' ? cookie.domain : undefined,
      path: typeof cookie.path === 'string' ? cookie.path : '/',
      secure: cookie.secure === true,
      sameSite: typeof cookie.sameSite === 'string' ? cookie.sameSite : undefined,
    })
  }

  const rawStorage = getStorageCandidates(payload)
  const safeStorage: Record<string, string> = {}
  const blockedStorageKeys: string[] = []
  Object.entries(rawStorage).forEach(([key, value]) => {
    if (sensitiveKeyPattern.test(key) || !safePreferencePattern.test(key)) blockedStorageKeys.push(key)
    else safeStorage[key] = value
  })

  return { fileName, safeCookies, blockedCookieNames, safeStorage, blockedStorageKeys }
}

function App() {
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    const stored = localStorage.getItem('nexo-profiles')
    try { return stored ? JSON.parse(stored) : [] } catch { return [] }
  })
  const [imports, setImports] = useState<ImportRecord[]>(() => {
    const stored = localStorage.getItem('nexo-safe-imports')
    try { return stored ? JSON.parse(stored) : [] } catch { return [] }
  })
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('Todos os grupos')
  const [selected, setSelected] = useState<string[]>([])
  const [showNew, setShowNew] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importProfileId, setImportProfileId] = useState('')
  const [detail, setDetail] = useState<Profile | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [toast, setToast] = useState('')
  const [showConnection, setShowConnection] = useState(false)
  const [connection, setConnection] = useState<ConnectionState>('disconnected')
  const [workerUrl, setWorkerUrl] = useState(() => localStorage.getItem('nexo-worker-url') || 'http://127.0.0.1:8787')
  const [workerToken, setWorkerToken] = useState(() => sessionStorage.getItem('nexo-worker-token') || '')
  const [connectionError, setConnectionError] = useState('')
  const [busyIds, setBusyIds] = useState<string[]>([])
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const api = useMemo(() => { try { return workerClient(workerUrl, workerToken) } catch { return workerClient('http://127.0.0.1:8787', workerToken) } }, [workerUrl, workerToken])

  useEffect(() => localStorage.setItem('nexo-profiles', JSON.stringify(profiles)), [profiles])
  useEffect(() => localStorage.setItem('nexo-safe-imports', JSON.stringify(imports)), [imports])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(id)
  }, [toast])
  useEffect(() => {
    if (workerToken) void connectWorker(workerUrl, workerToken, false)
    else setShowConnection(true)
    // A conexão automática deve acontecer apenas na abertura desta sessão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groups = useMemo(() => ['Todos os grupos', ...Array.from(new Set(profiles.map(p => p.group)))], [profiles])
  const filtered = profiles.filter(p => {
    const matchesQuery = `${p.name} ${p.id} ${p.group}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (group === 'Todos os grupos' || p.group === group) && (statusFilter === 'all' || p.status === statusFilter)
  })

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const notify = (message: string) => setToast(message)
  const workerRequest = useCallback(async <T,>(path: string, options: RequestInit = {}, url = workerUrl, token = workerToken): Promise<T> => workerClient(normalizeWorkerUrl(url), token)<T>(path, options), [workerUrl, workerToken])
  const connectWorker = async (url: string, token: string, closeOnSuccess = true) => {
    const normalizedUrl = normalizeWorkerUrl(url)
    if (!normalizedUrl || token.trim().length < 32) {
      setConnection('error')
      setConnectionError('Informe o endereço do worker e o token completo gerado no arquivo .env.windows.')
      return
    }
    setConnection('connecting')
    setConnectionError('')
    try {
      await workerRequest('/health', {}, normalizedUrl, '')
      setCatalogue(await workerRequest<Catalogue>('/v1/capabilities', {}, normalizedUrl, token.trim()))
      const data = await workerRequest<{ profiles: WorkerProfile[] }>('/v1/profiles', {}, normalizedUrl, token.trim())
      setWorkerUrl(normalizedUrl)
      setWorkerToken(token.trim())
      localStorage.setItem('nexo-worker-url', normalizedUrl)
      sessionStorage.setItem('nexo-worker-token', token.trim())
      setProfiles(data.profiles.map(workerToProfile))
      setConnection('connected')
      if (closeOnSuccess) setShowConnection(false)
      notify('Worker Android conectado')
    } catch (error) {
      setConnection('error')
      setConnectionError(error instanceof Error ? error.message : 'Não foi possível conectar ao worker local.')
      setShowConnection(true)
    }
  }
  const refreshProfiles = useCallback(async () => {
    if (connection !== 'connected') return
    const data = await workerRequest<{ profiles: WorkerProfile[]; warnings: string[] }>('/v1/profiles')
    setProfiles(data.profiles.map(workerToProfile))
    setConnectionError(data.warnings.join(' '))
  }, [connection, workerRequest])
  useEffect(() => {
    if (connection !== 'connected') return
    let disposed = false, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try { await refreshProfiles() } catch (e) { if (!disposed) setConnectionError(e instanceof Error ? e.message : 'Worker indisponível') }
      if (!disposed) timer = setTimeout(poll, 5000)
    }
    timer = setTimeout(poll, 5000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [connection, refreshProfiles])
  const setStatus = async (ids: string[], status: Status) => {
    if (connection !== 'connected') {
      setShowConnection(true)
      notify('Conecte o worker para controlar o celular real')
      return
    }
    setBusyIds(list => [...new Set([...list, ...ids])])
    try {
      for (const id of ids) await workerRequest(`/v1/profiles/${id}/${status === 'running' ? 'start' : 'stop'}`, { method: 'POST' })
      await refreshProfiles()
      notify(status === 'running' ? 'Celular Android iniciado' : 'Celular Android desligado')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Falha ao controlar o celular')
      await refreshProfiles().catch(() => undefined)
    } finally {
      setBusyIds(list => list.filter(id => !ids.includes(id)))
    }
  }
  const removeSelected = async () => {
    if (!selected.length || connection !== 'connected') return
    if (!window.confirm(`Excluir ${selected.length} perfil(s)? Discos de Android Emulator serão apagados; dispositivos externos serão apenas desvinculados.`)) return
    try { for (const id of selected) await workerRequest(`/v1/profiles/${id}`, {method:'DELETE'}); setSelected([]); await refreshProfiles(); notify('Perfis excluídos do worker') }
    catch (e) { notify(e instanceof Error ? e.message : 'Falha ao excluir'); await refreshProfiles().catch(() => undefined) }
  }
  const testProfileProxy = async (ids: string[]) => {
    try { for (const id of ids) { const result = await workerRequest<{ip:string;scope:string}>(`/v1/profiles/${id}/proxy/test`, {method:'POST'}); notify(`${id}: saída HTTP ${result.ip}. ${result.scope}`) } }
    catch(e) { notify(e instanceof Error ? e.message : 'Falha no proxy') }
  }
  const openImporter = (profileId = '') => {
    setImportProfileId(profileId)
    setShowImport(true)
  }
  const createWorkerProfile = async (profile: Profile) => {
    if (connection !== 'connected') {
      setShowConnection(true)
      throw new Error('Conecte o worker antes de criar um celular.')
    }
    const proxyType = profile.proxyType.toLowerCase() as 'none' | 'http' | 'https' | 'socks5'
    const proxy = proxyType === 'none' || !profile.proxyHost
      ? { type: 'none' as const }
      : {
          type: proxyType,
          host: profile.proxyHost,
          port: Number(profile.proxyPort),
          username: profile.proxyUser || undefined,
          password: profile.proxyPassword || undefined,
        }
    await workerRequest('/v1/profiles', {
      method: 'POST',
      body: JSON.stringify({ id: profile.id, displayName: profile.name, proxy, group:profile.group, notes:profile.notes, engine:profile.engine, serial:profile.serial || undefined, instanceName:profile.instanceName || undefined, systemImage:profile.systemImage || undefined, deviceId:profile.deviceId || undefined, settings:profile.settings }),
    })
    await refreshProfiles()
  }

  return (
    <div className="app-shell">
      <Sidebar open={sidebar} close={() => setSidebar(false)} connection={connection} count={profiles.length} onConnect={() => setShowConnection(true)} />
      <main>
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebar(true)} aria-label="Abrir menu"><Menu size={21}/></button>
          <div><p className="eyebrow">AMBIENTES ANDROID</p><h1>Perfis móveis</h1></div>
          <div className="top-actions">
            <button className="capacity" onClick={() => setShowConnection(true)} style={{cursor:'pointer'}}><span><Server size={15}/> Worker</span><strong style={{color:connection === 'connected' ? '#5fe0ad' : connection === 'connecting' ? '#ffc06d' : '#ff8fa3'}}>{connection === 'connected' ? 'Conectado' : connection === 'connecting' ? 'Conectando' : 'Desconectado'}</strong></button>
            <button className="primary" onClick={() => connection === 'connected' ? setShowNew(true) : setShowConnection(true)}><Plus size={18}/> Novo perfil</button>
          </div>
        </header>

        {connectionError && <p className="console-error" role="alert">{connectionError}</p>}
        {catalogue?.dryRun && <p className="console-error">Modo de simulação: nenhum Android real é iniciado. Configure ANDROID_DRY_RUN=false no worker.</p>}
        <section className="stats-grid">
          <Stat icon={Smartphone} label="Total de perfis" value={profiles.length.toString()} detail="Ambientes isolados" tone="blue"/>
          <Stat icon={Zap} label="Em execução" value={profiles.filter(p => p.status === 'running').length.toString()} detail="Conectados agora" tone="green"/>
          <Stat icon={Wifi} label="Com proxy" value={profiles.filter(p => p.proxyType !== 'SEM PROXY').length.toString()} detail="Rotas configuradas" tone="violet"/>
          <Stat icon={HardDrive} label="Armazenamento" value={catalogue?.disk ? `${(catalogue.disk.freeBytes / 1024**3).toFixed(1)} GB` : "—"} detail="Livres no disco do worker" tone="orange"/>
        </section>

        <section className="workspace">
          <div className="toolbar">
            <div className="filters">
              <label className="select-wrap"><LayoutGrid size={17}/><select value={group} onChange={e => setGroup(e.target.value)}>{groups.map(g => <option key={g}>{g}</option>)}</select><ChevronDown size={15}/></label>
              <label className="search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar nome, ID ou grupo"/></label>
              <label className="select-wrap"><Filter size={17}/><select aria-label="Filtrar status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">Todos os estados</option>{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            </div>
            <div style={{display:'flex', gap:8}}>
              <button className="secondary" onClick={() => openImporter()}><Upload size={17}/> Importar perfil</button>
              <button className="secondary" onClick={()=>downloadJson("nexo-configuracoes.json", {kind:"nexo-configurations",version:1,profiles:profiles.map(p=>({...p,proxyPassword:undefined})),notice:"Configurações do painel; não contém discos nem backups do Android."})}><Download size={17}/> Exportar configuração</button>
            </div>
          </div>

          <div className={`bulkbar ${selected.length ? 'visible' : ''}`}>
            <strong>{selected.length} selecionado{selected.length === 1 ? '' : 's'}</strong>
            <span className="divider"/>
            <button disabled={selected.some(id => busyIds.includes(id))} onClick={() => void setStatus(selected, 'running')}><Play size={15}/> Iniciar</button>
            <button disabled={selected.some(id => busyIds.includes(id))} onClick={() => void setStatus(selected, 'offline')}><Square size={14}/> Desligar</button>
            <button onClick={() => void testProfileProxy(selected)}><Wifi size={15}/> Verificar proxy</button>
            <button className="danger" onClick={() => void removeSelected()}><Trash2 size={15}/> Excluir</button>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr>
                <th><input type="checkbox" checked={filtered.length > 0 && filtered.every(p=>selected.includes(p.id))} onChange={e => setSelected(e.target.checked ? filtered.map(p => p.id) : [])}/></th>
                <th>Perfil</th><th>Dispositivo</th><th>Rede</th><th>Aplicativos</th><th>Último uso</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>{filtered.map(profile => (
                <tr key={profile.id}>
                  <td><input type="checkbox" checked={selected.includes(profile.id)} onChange={() => toggle(profile.id)}/></td>
                  <td><button className="profile-cell" onClick={() => setDetail(profile)}><span className="phone-avatar"><Smartphone size={20}/></span><span><strong>{profile.name}</strong><small>{profile.id} · {profile.group}</small></span></button></td>
                  <td><strong>{profile.device}</strong><small>{profile.android}</small></td>
                  <td><span className="proxy"><ShieldCheck size={14}/>{profile.proxyType}</span><small>{profile.ip}</small></td>
                  <td><strong>{profile.apps < 0 ? '—' : profile.apps}</strong><small>Consultar na aba Apps</small></td>
                  <td><span>{profile.lastUsed}</span></td>
                  <td><span className={`status ${profile.status}`}><i/>{statusLabel[profile.status]}</span></td>
                  <td><div className="row-actions"><button title="Iniciar" disabled={busyIds.includes(profile.id)} onClick={() => void setStatus([profile.id], 'running')}><Play size={16}/></button><button title="Detalhes" onClick={() => setDetail(profile)}><MoreHorizontal size={18}/></button></div></td>
                </tr>
              ))}</tbody>
            </table>
            {!filtered.length && <div className="empty"><Search size={28}/><strong>Nenhum perfil encontrado</strong><span>Tente outro termo ou crie um novo ambiente.</span></div>}
          </div>
          <div className="table-footer"><span>Mostrando {filtered.length} de {profiles.length} perfis</span><button className="ghost" onClick={() => void refreshProfiles().catch(e=>notify(e instanceof Error ? e.message : 'Falha ao atualizar'))} disabled={connection !== 'connected'}>Atualizar worker <i className={connection === 'connected' ? 'live-dot' : ''}/></button></div>
        </section>
      </main>

      {showNew && <NewProfile catalogue={catalogue} api={api} onClose={() => setShowNew(false)} onSave={async profile => { await createWorkerProfile(profile); setShowNew(false); notify('Celular Android criado no worker') }}/>}
      {showImport && <SessionImporter profiles={profiles} initialProfileId={importProfileId} onClose={() => setShowImport(false)} onSave={record => { setImports(list => [record, ...list].slice(0, 50)); setShowImport(false); notify('Dados não sensíveis importados para o perfil') }}/>}
      {detail && <Detail profile={profiles.find(p => p.id === detail.id) || detail} api={api} onRefresh={refreshProfiles} lastImport={imports.find(item => item.profileId === detail.id)} onClose={() => setDetail(null)} onStart={() => void setStatus([detail.id], 'running')} onImport={() => { openImporter(detail.id); setDetail(null) }} notify={notify}/>}
      {showConnection && <ConnectionModal url={workerUrl} token={workerToken} state={connection} error={connectionError} onClose={() => setShowConnection(false)} onConnect={(url, token) => void connectWorker(url, token)}/>}
      {toast && <div className="toast"><ShieldCheck size={18}/>{toast}</div>}
    </div>
  )
}

function Sidebar({ open, close, connection, onConnect, count }: { open: boolean; close: () => void; connection: ConnectionState; onConnect: () => void; count: number }) {
  return <>{open && <button className="scrim" onClick={close} aria-label="Fechar menu"/>}<aside className={open ? 'open' : ''}>
    <div className="brand"><span><Smartphone size={22}/></span><div><strong>NEXO</strong><small>MOBILE</small></div></div>
    <nav><p>GERENCIAMENTO</p><button className="active" onClick={close}><Smartphone size={19}/>Perfis<span className="nav-count">{count}</span></button><button onClick={onConnect}><Settings size={19}/>Conexão do worker</button></nav>
    <div className="server-card"><div><span className={connection === 'connected' ? 'pulse' : ''}/><strong>{connection === 'connected' ? 'Worker conectado' : 'Worker desconectado'}</strong></div><small>Apps, diagnóstico e backups nos detalhes de cada perfil.</small><button onClick={onConnect}><Gauge size={15}/>Configurar conexão</button></div>
  </aside></>
}

function Stat({ icon: Icon, label, value, detail, tone }: { icon: typeof Smartphone, label: string, value: string, detail: string, tone: string }) {
  return <article className="stat"><span className={`stat-icon ${tone}`}><Icon size={20}/></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>
}

function ConnectionModal({ url, token, state, error, onClose, onConnect }: { url: string, token: string, state: ConnectionState, error: string, onClose: () => void, onConnect: (url: string, token: string) => void }) {
  const [localUrl, setLocalUrl] = useState(url)
  const [localToken, setLocalToken] = useState(token)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onConnect(localUrl, localToken)
  }
  return <div className="modal-layer"><div className="modal" style={{width:'min(560px,calc(100vw - 30px))'}}>
    <div className="modal-head"><div><p className="eyebrow">WORKER LOCAL</p><h2>Conectar ao Android</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <form onSubmit={submit}>
      <div className="form-grid">
        <label className="full">Endereço do worker<input required value={localUrl} onChange={event => setLocalUrl(event.target.value)} placeholder="http://127.0.0.1:8787"/></label>
        <label className="full">Token do worker<input required type="password" autoComplete="off" value={localToken} onChange={event => setLocalToken(event.target.value)} placeholder="Cole o WORKER_API_TOKEN"/></label>
        <div className="info-box full"><ShieldCheck size={19}/><span><strong>Token somente nesta sessão</strong><small>A chave fica na memória desta aba e não é enviada para a Vercel.</small></span></div>
        {error && <div className="warning full" style={{marginTop:0, border:'1px solid #663141', background:'#25131a', color:'#ff9aaa'}}><AlertTriangle size={18}/><span>{error}</span></div>}
      </div>
      <div className="modal-actions"><span/><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" disabled={state === 'connecting'}>{state === 'connecting' ? 'Conectando…' : 'Conectar worker'}</button></div>
    </form>
  </div></div>
}

function NewProfile({ onClose, onSave, catalogue, api }: { onClose: () => void; onSave: (p: Profile) => Promise<void>; catalogue: Catalogue | null; api: WorkerApi }) {
  const [saving,setSaving] = useState(false), [error,setError] = useState(''), [proxyResult,setProxyResult] = useState('')
  const [form,setForm] = useState({name:'',group:'Android local',notes:'',engine:'android-emulator',serial:'',instanceName:'',deviceId:catalogue?.deviceId ?? 'pixel_7_pro',systemImage:catalogue?.installedImages[0] ?? catalogue?.systemImage ?? '',proxyType:'none',proxyHost:'',proxyPort:'',proxyUser:'',proxyPassword:''})
  const [availableDevices,setAvailableDevices] = useState(catalogue?.devices ?? []), [adbAddress,setAdbAddress] = useState('127.0.0.1:5555')
  const [settings,setSettings] = useState<DeviceSettings>(catalogue?.defaults ?? {memoryMb:3072,cores:2,heapMb:512,resolution:'540x960',density:240,gpu:'auto',cameraFront:'none',cameraBack:'emulated'})
  const change=(key:string,value:string)=>{setForm(f=>({...f,[key]:value}));setProxyResult('')}
  const proxy=()=>({type:form.proxyType,host:form.proxyHost || undefined,port:form.proxyPort ? Number(form.proxyPort) : undefined,username:form.proxyUser || undefined,password:form.proxyPassword || undefined})
  const test=async()=>{setSaving(true);setError('');try{const result=await api<{ip:string;scope:string}>('/v1/proxy/test',{method:'POST',body:JSON.stringify(proxy())});setProxyResult(`Saída HTTP: ${result.ip}. ${result.scope}`)}catch(e){setError(e instanceof Error?e.message:'Falha no proxy')}finally{setSaving(false)}}
  const submit=async(e:FormEvent)=>{e.preventDefault();setSaving(true);setError('');try{await onSave({...form,device:form.deviceId,android:form.systemImage,id:`nx-${crypto.randomUUID().slice(0,12)}`,status:'ready',ip:'Não verificado',apps:0,lastUsed:'Nunca usado',settings})}catch(e){setError(e instanceof Error?e.message:'Falha ao criar')}finally{setSaving(false)}}
  return <div className="modal-layer"><div className="modal" style={{maxHeight:'92vh',overflowY:'auto'}}><div className="modal-head"><h2>Criar ou conectar Android</h2><button className="icon-button" onClick={onClose}><X size={20}/></button></div><form onSubmit={submit}><div className="form-grid">
    <label>Nome<input required minLength={2} value={form.name} onChange={e=>change('name',e.target.value)}/></label><label>Grupo<input value={form.group} onChange={e=>change('group',e.target.value)}/></label>
    <label className="full">Motor<select value={form.engine} onChange={e=>{change('engine',e.target.value);change('proxyType','none')}}><option value="android-emulator">Android Emulator — novo disco isolado</option><option value="bluestacks">BlueStacks — conectar instância existente</option><option value="physical">Android físico — conectar aparelho existente</option></select></label>
    {form.engine==='android-emulator'?<>
      <label>Modelo<select value={form.deviceId} onChange={e=>change('deviceId',e.target.value)}>{(catalogue?.deviceDefinitions ?? [{id:form.deviceId,name:form.deviceId}]).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>Imagem instalada<select required value={form.systemImage} onChange={e=>change('systemImage',e.target.value)}>{catalogue?.installedImages.length ? catalogue.installedImages.map(i=><option key={i}>{i}</option>):<option value="">Nenhuma imagem instalada</option>}</select></label>
      <label>RAM (MB)<input type="number" required min={1536} max={16384} value={settings.memoryMb} onChange={e=>setSettings({...settings,memoryMb:Number(e.target.value)})}/></label><label>Núcleos<input type="number" min={1} max={16} required value={settings.cores} onChange={e=>setSettings({...settings,cores:Number(e.target.value)})}/></label>
      <label>Resolução<select value={settings.resolution} onChange={e=>setSettings({...settings,resolution:e.target.value})}><option>540x960</option><option>720x1280</option><option>1080x1920</option></select></label><label>GPU<select value={settings.gpu} onChange={e=>setSettings({...settings,gpu:e.target.value})}><option value="auto">Automático</option><option value="host">GPU do computador</option><option value="software">Software</option><option value="swiftshader_indirect">SwiftShader legado</option></select></label>
      <label>Proxy<select value={form.proxyType} onChange={e=>change('proxyType',e.target.value)}><option value="none">Sem proxy</option><option value="http">HTTP</option></select></label>
      {form.proxyType!=='none'&&<><label>Host<input required value={form.proxyHost} onChange={e=>change('proxyHost',e.target.value)}/></label><label>Porta<input type="number" required min={1} max={65535} value={form.proxyPort} onChange={e=>change('proxyPort',e.target.value)}/></label><label>Usuário<input value={form.proxyUser} onChange={e=>change('proxyUser',e.target.value)}/></label><label>Senha<input type="password" value={form.proxyPassword} onChange={e=>change('proxyPassword',e.target.value)}/></label><button type="button" className="secondary" disabled={saving} onClick={()=>void test()}>Testar conexão HTTP</button></>}
    </>:<><label className="full">Dispositivo ADB conectado<select required value={form.serial} onChange={e=>change('serial',e.target.value)}><option value="">Selecione</option>{availableDevices.filter(d=>d.state==='device').map(d=><option key={d.serial}>{d.serial}</option>)}</select></label><label>Endereço ADB do BlueStacks<input value={adbAddress} onChange={e=>setAdbAddress(e.target.value)} placeholder="127.0.0.1:porta"/></label><button type="button" className="secondary" disabled={saving} onClick={()=>{setSaving(true);setError('');void api('/v1/devices/connect',{method:'POST',body:JSON.stringify({serial:adbAddress})}).then(()=>api<Catalogue>('/v1/capabilities')).then(c=>{setAvailableDevices(c.devices);change('serial',adbAddress)}).catch(e=>setError(e instanceof Error?e.message:'Falha na conexão ADB')).finally(()=>setSaving(false))}}>Conectar ADB local</button>{form.engine==='bluestacks'&&<label className="full">Nome interno da instância para iniciar (opcional)<input value={form.instanceName} onChange={e=>change('instanceName',e.target.value)} placeholder="Ex.: Pie64 — copie da configuração do BlueStacks"/></label>}<p className="console-help full">Abra a instância e habilite ADB no BlueStacks ou autorize USB no celular. Hardware, câmera e rede são configurados no motor externo. O vínculo não cria um novo aparelho.</p></>}
    <label className="full">Observação<input value={form.notes} onChange={e=>change('notes',e.target.value)}/></label>
    {catalogue&&<p className="console-help full">Memória livre: {catalogue.memory.freeMb} MB de {catalogue.memory.totalMb} MB. Limite de emuladores: {catalogue.maxActiveEmulators}.</p>}{proxyResult&&<p className="console-message full">{proxyResult}</p>}{error&&<p role="alert" className="console-error full">{error}</p>}
  </div><div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><span/><button className="primary" disabled={saving || !catalogue}>{saving?'Executando…':form.engine==='android-emulator'?'Criar Android':'Conectar dispositivo'}</button></div></form></div></div>
}

function SessionImporter({ profiles, initialProfileId, onClose, onSave }: { profiles: Profile[], initialProfileId: string, onClose: () => void, onSave: (record: ImportRecord) => void }) {
  const [profileId, setProfileId] = useState(initialProfileId || profiles[0]?.id || '')
  const [url, setUrl] = useState('https://www.tiktok.com/')
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setError('')
    setAnalysis(null)
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.json')) return setError('Use um arquivo JSON exportado pelo navegador ou pelo seu gerenciador de perfis.')
    if (file.size > 2 * 1024 * 1024) return setError('Arquivo acima de 2 MB. Exporte apenas cookies e preferências do perfil.')
    setReading(true)
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      const result = sanitizeImport(parsed, file.name)
      if (!result.safeCookies.length && !Object.keys(result.safeStorage).length && !result.blockedCookieNames.length && !result.blockedStorageKeys.length) {
        setError('Nenhum conjunto de cookies ou localStorage reconhecido nesse JSON.')
      } else {
        setAnalysis(result)
      }
    } catch {
      setError('Não foi possível ler o JSON. Verifique se o arquivo exportado está íntegro.')
    } finally {
      setReading(false)
      event.target.value = ''
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!profileId || !analysis) return
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('protocol')
    } catch {
      setError('Informe uma URL http/https válida para abrir depois da importação.')
      return
    }
    onSave({
      id: `IMP-${Date.now()}`,
      profileId,
      fileName: analysis.fileName,
      host: parsedUrl.hostname,
      url: parsedUrl.toString(),
      safeCookieCount: analysis.safeCookies.length,
      blockedCookieCount: analysis.blockedCookieNames.length,
      safeStorageCount: Object.keys(analysis.safeStorage).length,
      blockedStorageCount: analysis.blockedStorageKeys.length,
      createdAt: new Date().toISOString(),
      payload: { cookies: analysis.safeCookies, localStorage: analysis.safeStorage },
    })
  }

  const openDestination = () => {
    try {
      const parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('protocol')
      window.open(parsedUrl.toString(), '_blank', 'noopener,noreferrer')
    } catch {
      setError('Informe uma URL válida antes de abrir o navegador.')
    }
  }

  return <div className="modal-layer"><div className="modal" style={{width:'min(720px,calc(100vw - 30px))'}}>
    <div className="modal-head"><div><p className="eyebrow">IMPORTADOR DE PERFIL</p><h2>Importar dados do navegador</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <form onSubmit={submit}>
      <div style={{padding:'0 24px 22px', display:'grid', gap:14}}>
        <div className="warning" style={{marginTop:0, border:'1px solid #5a4022', background:'#241b12'}}><AlertTriangle size={18}/><span><strong style={{display:'block', color:'#ffc06d', marginBottom:3}}>Modo seguro de importação</strong>Cookies HttpOnly, cookies de autenticação e chaves com aparência de sessão/token são descartados e nunca persistidos. O recurso não transplanta login nem modifica o armazenamento privado de apps Android.</span></div>
        <div className="form-grid" style={{padding:0, minHeight:0}}>
          <label>Perfil de destino<select value={profileId} onChange={e => setProfileId(e.target.value)}>{profiles.map(profile => <option value={profile.id} key={profile.id}>{profile.name} · {profile.id}</option>)}</select></label>
          <label>Site para abrir<input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://exemplo.com/"/></label>
        </div>
        <label style={{display:'flex', alignItems:'center', justifyContent:'center', gap:10, minHeight:76, padding:14, border:'1px dashed #31506d', borderRadius:10, background:'#0c1d2f', color:'#87a9c8', cursor:'pointer', fontSize:11, fontWeight:700}}>
          <FileJson size={22}/>{reading ? 'Analisando arquivo…' : 'Selecionar arquivo JSON exportado'}
          <input type="file" accept="application/json,.json" onChange={handleFile} disabled={reading} style={{display:'none'}}/>
        </label>
        {error && <div className="warning" style={{marginTop:0, border:'1px solid #663141', background:'#25131a', color:'#ff9aaa'}}><AlertTriangle size={18}/><span>{error}</span></div>}
        {analysis && <div style={{display:'grid', gap:10}}>
          <div className="device-preview" style={{marginBottom:0}}><span><CheckCircle2 size={26}/></span><div><strong>{analysis.fileName}</strong><small>Arquivo analisado localmente no navegador</small></div></div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:10}}>
            <ImportMetric label="Cookies permitidos" value={analysis.safeCookies.length} tone="safe"/>
            <ImportMetric label="Cookies bloqueados" value={analysis.blockedCookieNames.length} tone="blocked"/>
            <ImportMetric label="Preferências permitidas" value={Object.keys(analysis.safeStorage).length} tone="safe"/>
            <ImportMetric label="Chaves bloqueadas" value={analysis.blockedStorageKeys.length} tone="blocked"/>
          </div>
          {(analysis.blockedCookieNames.length > 0 || analysis.blockedStorageKeys.length > 0) && <div style={{padding:12, border:'1px solid #263b51', borderRadius:9, background:'#0b1828'}}>
            <strong style={{display:'block', color:'#90a8bf', fontSize:10, marginBottom:6}}>Itens bloqueados</strong>
            <small style={{color:'#657f98', lineHeight:1.7}}>{[...analysis.blockedCookieNames.slice(0,8), ...analysis.blockedStorageKeys.slice(0,8)].join(' · ')}{analysis.blockedCookieNames.length + analysis.blockedStorageKeys.length > 16 ? ' · …' : ''}</small>
          </div>}
        </div>}
      </div>
      <div className="modal-actions"><button type="button" className="secondary" onClick={openDestination}><ExternalLink size={16}/> Abrir site</button><span/><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" type="submit" disabled={!analysis || !profileId}><Upload size={16}/> Aplicar ao perfil</button></div>
    </form>
  </div></div>
}

function ImportMetric({label, value, tone}: {label: string, value: number, tone: 'safe' | 'blocked'}) {
  const safe = tone === 'safe'
  return <div style={{padding:12, border:`1px solid ${safe ? '#1d5a49' : '#5b3340'}`, borderRadius:9, background:safe ? '#0d2a23' : '#24151b'}}><small style={{display:'block', color:safe ? '#69c9a5' : '#d58b9b', fontSize:9}}>{label}</small><strong style={{display:'block', marginTop:3, fontSize:18, color:safe ? '#a8efd2' : '#ffb5c2'}}>{value}</strong></div>
}

function Detail({ profile, lastImport, onClose, onStart, onImport, api, onRefresh }: { profile: Profile; lastImport?: ImportRecord; onClose: () => void; onStart: () => void; onImport: () => void; notify: (s:string)=>void; api: WorkerApi; onRefresh: () => Promise<void> }) {
  return <div className="drawer-layer"><button className="scrim" onClick={onClose}/><section className="drawer" style={{width:'min(620px,100%)'}}>
    <div className="drawer-head"><div className="phone-avatar large"><Smartphone size={24}/></div><div><h2>{profile.name}</h2><span>{profile.id} · {profile.group} · {statusLabel[profile.status]}</span></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <div className="console-actions"><button className="primary" onClick={onStart}><Play size={17}/>Iniciar / conectar</button><button className="secondary" onClick={onImport}><Upload size={15}/>Dados portáveis</button></div>
    {lastImport&&<p className="console-help">Pacote local: {lastImport.safeCookieCount} cookies e {lastImport.safeStorageCount} preferências · {lastImport.host}.</p>}
    <DeviceConsole profile={profile} api={api} onRefresh={onRefresh}/>
  </section></div>
}
export default App
