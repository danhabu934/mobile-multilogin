import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Activity, AppWindow, Boxes, ChevronDown, CircleDollarSign, Cloud,
  Copy, Download, Ellipsis, Filter, FolderKanban, Gauge, HardDrive,
  LayoutGrid, Menu, MoreHorizontal, Play, Plus, Search, Server,
  Settings, ShieldCheck, Smartphone, Square, Trash2, Users, Wifi,
  X, Zap
} from 'lucide-react'

type Status = 'ready' | 'running' | 'offline'
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
}

const seed: Profile[] = [
  { id: 'NX-1048', name: 'Operação principal', group: 'TikTok', device: 'Pixel 8', android: 'Android 14', status: 'ready', proxyType: 'SOCKS5', proxyHost: 'br.proxy.local', proxyPort: '1080', proxyUser: '', proxyPassword: '', ip: 'São Paulo, BR', apps: 3, lastUsed: 'Hoje, 02:14' },
  { id: 'NX-1047', name: 'Conteúdo secundário', group: 'TikTok', device: 'Pixel 7 Pro', android: 'Android 13', status: 'offline', proxyType: 'HTTP', proxyHost: '—', proxyPort: '', proxyUser: '', proxyPassword: '', ip: 'Sem proxy', apps: 2, lastUsed: 'Ontem, 21:40' },
  { id: 'NX-1046', name: 'Atendimento mobile', group: 'Clientes', device: 'Galaxy S23', android: 'Android 14', status: 'running', proxyType: 'SOCKS5', proxyHost: 'us.proxy.local', proxyPort: '1080', proxyUser: '', proxyPassword: '', ip: 'Miami, US', apps: 5, lastUsed: 'Em uso agora' },
]

const nav = [
  { label: 'Perfis', icon: Smartphone, active: true },
  { label: 'Grupos', icon: FolderKanban },
  { label: 'Aplicativos', icon: AppWindow },
  { label: 'Recursos', icon: Boxes },
  { label: 'Servidores', icon: Server },
]

const statusLabel: Record<Status, string> = { ready: 'Pronto', running: 'Em execução', offline: 'Desligado' }

function App() {
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    const stored = localStorage.getItem('nexo-profiles')
    return stored ? JSON.parse(stored) : seed
  })
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('Todos os grupos')
  const [selected, setSelected] = useState<string[]>([])
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState<Profile | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => localStorage.setItem('nexo-profiles', JSON.stringify(profiles)), [profiles])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(id)
  }, [toast])

  const groups = useMemo(() => ['Todos os grupos', ...Array.from(new Set(profiles.map(p => p.group)))], [profiles])
  const filtered = profiles.filter(p => {
    const matchesQuery = `${p.name} ${p.id} ${p.group}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (group === 'Todos os grupos' || p.group === group)
  })

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const notify = (message: string) => setToast(message)
  const setStatus = (ids: string[], status: Status) => {
    setProfiles(list => list.map(p => ids.includes(p.id) ? { ...p, status, lastUsed: status === 'running' ? 'Em uso agora' : p.lastUsed } : p))
    notify(status === 'running' ? 'Inicialização enviada ao servidor Android' : 'Perfis desligados')
  }
  const removeSelected = () => {
    if (!selected.length) return
    setProfiles(list => list.filter(p => !selected.includes(p.id)))
    setSelected([])
    notify('Perfis removidos do painel')
  }

  return (
    <div className="app-shell">
      <Sidebar open={sidebar} close={() => setSidebar(false)} />
      <main>
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebar(true)} aria-label="Abrir menu"><Menu size={21}/></button>
          <div><p className="eyebrow">AMBIENTES ANDROID</p><h1>Perfis móveis</h1></div>
          <div className="top-actions">
            <div className="capacity"><span><Cloud size={15}/> Capacidade</span><strong>3 / 10</strong></div>
            <button className="primary" onClick={() => setShowNew(true)}><Plus size={18}/> Novo perfil</button>
          </div>
        </header>

        <section className="stats-grid">
          <Stat icon={Smartphone} label="Total de perfis" value={profiles.length.toString()} detail="Ambientes isolados" tone="blue"/>
          <Stat icon={Zap} label="Em execução" value={profiles.filter(p => p.status === 'running').length.toString()} detail="Conectados agora" tone="green"/>
          <Stat icon={Wifi} label="Com proxy" value={profiles.filter(p => p.proxyHost !== '—').length.toString()} detail="Rotas configuradas" tone="violet"/>
          <Stat icon={HardDrive} label="Armazenamento" value="18.4 GB" detail="de 50 GB utilizados" tone="orange"/>
        </section>

        <section className="workspace">
          <div className="toolbar">
            <div className="filters">
              <label className="select-wrap"><LayoutGrid size={17}/><select value={group} onChange={e => setGroup(e.target.value)}>{groups.map(g => <option key={g}>{g}</option>)}</select><ChevronDown size={15}/></label>
              <label className="search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar nome, ID ou grupo"/></label>
              <button className="secondary"><Filter size={17}/> Filtros</button>
            </div>
            <button className="secondary"><Download size={17}/> Exportar</button>
          </div>

          <div className={`bulkbar ${selected.length ? 'visible' : ''}`}>
            <strong>{selected.length} selecionado{selected.length === 1 ? '' : 's'}</strong>
            <span className="divider"/>
            <button onClick={() => setStatus(selected, 'running')}><Play size={15}/> Iniciar</button>
            <button onClick={() => setStatus(selected, 'offline')}><Square size={14}/> Desligar</button>
            <button onClick={() => notify('Verificação de proxy iniciada')}><Wifi size={15}/> Verificar proxy</button>
            <button className="danger" onClick={removeSelected}><Trash2 size={15}/> Excluir</button>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr>
                <th><input type="checkbox" checked={filtered.length > 0 && selected.length === filtered.length} onChange={e => setSelected(e.target.checked ? filtered.map(p => p.id) : [])}/></th>
                <th>Perfil</th><th>Dispositivo</th><th>Rede</th><th>Aplicativos</th><th>Último uso</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>{filtered.map(profile => (
                <tr key={profile.id}>
                  <td><input type="checkbox" checked={selected.includes(profile.id)} onChange={() => toggle(profile.id)}/></td>
                  <td><button className="profile-cell" onClick={() => setDetail(profile)}><span className="phone-avatar"><Smartphone size={20}/></span><span><strong>{profile.name}</strong><small>{profile.id} · {profile.group}</small></span></button></td>
                  <td><strong>{profile.device}</strong><small>{profile.android}</small></td>
                  <td><span className="proxy"><ShieldCheck size={14}/>{profile.proxyType}</span><small>{profile.ip}</small></td>
                  <td><strong>{profile.apps}</strong><small>instalados</small></td>
                  <td><span>{profile.lastUsed}</span></td>
                  <td><span className={`status ${profile.status}`}><i/>{statusLabel[profile.status]}</span></td>
                  <td><div className="row-actions"><button title="Iniciar" onClick={() => setStatus([profile.id], 'running')}><Play size={16}/></button><button title="Detalhes" onClick={() => setDetail(profile)}><MoreHorizontal size={18}/></button></div></td>
                </tr>
              ))}</tbody>
            </table>
            {!filtered.length && <div className="empty"><Search size={28}/><strong>Nenhum perfil encontrado</strong><span>Tente outro termo ou crie um novo ambiente.</span></div>}
          </div>
          <div className="table-footer"><span>Mostrando {filtered.length} de {profiles.length} perfis</span><span>Atualização em tempo real <i className="live-dot"/></span></div>
        </section>
      </main>

      {showNew && <NewProfile onClose={() => setShowNew(false)} onSave={profile => { setProfiles(p => [profile, ...p]); setShowNew(false); notify('Novo perfil criado') }}/>} 
      {detail && <Detail profile={profiles.find(p => p.id === detail.id) || detail} onClose={() => setDetail(null)} onStart={() => setStatus([detail.id], 'running')} notify={notify}/>} 
      {toast && <div className="toast"><ShieldCheck size={18}/>{toast}</div>}
    </div>
  )
}

function Sidebar({ open, close }: { open: boolean, close: () => void }) {
  return <>
    {open && <button className="scrim" onClick={close} aria-label="Fechar menu"/>}
    <aside className={open ? 'open' : ''}>
      <div className="brand"><span><Smartphone size={22}/></span><div><strong>NEXO</strong><small>MOBILE</small></div></div>
      <nav><p>GERENCIAMENTO</p>{nav.map(({label, icon: Icon, active}) => <button key={label} className={active ? 'active' : ''}><Icon size={19}/>{label}{active && <span className="nav-count">3</span>}</button>)}</nav>
      <nav className="lower"><p>CONTA</p><button><Users size={19}/>Equipe</button><button><Activity size={19}/>Atividades</button><button><CircleDollarSign size={19}/>Plano e uso</button><button><Settings size={19}/>Configurações</button></nav>
      <div className="server-card"><div><span className="pulse"/><strong>Control plane online</strong></div><small>Worker Android não conectado</small><button><Gauge size={15}/> Ver infraestrutura</button></div>
      <div className="user"><span>DS</span><div><strong>Danhabu</strong><small>Administrador</small></div><Ellipsis size={18}/></div>
    </aside>
  </>
}

function Stat({ icon: Icon, label, value, detail, tone }: { icon: typeof Smartphone, label: string, value: string, detail: string, tone: string }) {
  return <article className="stat"><span className={`stat-icon ${tone}`}><Icon size={20}/></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>
}

function NewProfile({ onClose, onSave }: { onClose: () => void, onSave: (p: Profile) => void }) {
  const [step, setStep] = useState(1)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [form, setForm] = useState({ name: '', group: 'TikTok', device: 'Pixel 8', android: 'Android 14', proxyType: 'SOCKS5', proxyHost: '', proxyPort: '', proxyUser: '', proxyPassword: '' })
  const change = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (step < 3) return setStep(s => s + 1)
    onSave({ ...form, id: `NX-${1050 + Math.floor(Math.random()*800)}`, status: 'ready', ip: checked ? 'Proxy verificado' : 'Não verificado', apps: 0, lastUsed: 'Nunca usado' })
  }
  const check = () => { setChecking(true); setTimeout(() => { setChecking(false); setChecked(true) }, 850) }
  return <div className="modal-layer"><div className="modal">
    <div className="modal-head"><div><p className="eyebrow">NOVO AMBIENTE</p><h2>Criar perfil Android</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <div className="steps">{['Identificação','Dispositivo e rede','Revisão'].map((s,i) => <div className={step >= i+1 ? 'current' : ''} key={s}><span>{i+1}</span><small>{s}</small></div>)}</div>
    <form onSubmit={submit}>
      {step === 1 && <div className="form-grid">
        <label className="full">Nome do perfil<input required autoFocus value={form.name} onChange={e => change('name', e.target.value)} placeholder="Ex.: Operação principal"/></label>
        <label>Grupo<input value={form.group} onChange={e => change('group', e.target.value)} placeholder="TikTok"/></label>
        <label>Observação<input placeholder="Opcional"/></label>
        <div className="info-box full"><ShieldCheck size={19}/><span><strong>Dados isolados por perfil</strong><small>Aplicativos, arquivos e sessões ficam separados em um disco exclusivo.</small></span></div>
      </div>}
      {step === 2 && <div className="form-grid">
        <label>Modelo<select value={form.device} onChange={e => change('device', e.target.value)}><option>Pixel 8</option><option>Pixel 7 Pro</option><option>Galaxy S23</option></select></label>
        <label>Sistema<select value={form.android} onChange={e => change('android', e.target.value)}><option>Android 14</option><option>Android 13</option></select></label>
        <label>Protocolo<select value={form.proxyType} onChange={e => change('proxyType', e.target.value)}><option>SOCKS5</option><option>HTTP</option><option>HTTPS</option></select></label>
        <label>Host<input value={form.proxyHost} onChange={e => change('proxyHost', e.target.value)} placeholder="proxy.exemplo.com"/></label>
        <label>Porta<input value={form.proxyPort} onChange={e => change('proxyPort', e.target.value)} placeholder="1080"/></label>
        <label>Usuário<input value={form.proxyUser} onChange={e => change('proxyUser', e.target.value)} placeholder="Opcional"/></label>
        <label>Senha<input type="password" value={form.proxyPassword} onChange={e => change('proxyPassword', e.target.value)} placeholder="Opcional"/></label>
        <button className={`proxy-check ${checked ? 'success' : ''}`} type="button" onClick={check} disabled={!form.proxyHost || checking}>{checking ? 'Verificando rota…' : checked ? 'Proxy verificado' : 'Testar conexão'}</button>
      </div>}
      {step === 3 && <div className="review">
        <div className="device-preview"><span><Smartphone size={36}/></span><div><strong>{form.name}</strong><small>{form.device} · {form.android}</small></div></div>
        <div className="review-row"><span>Grupo</span><strong>{form.group}</strong></div><div className="review-row"><span>Proxy</span><strong>{form.proxyHost ? `${form.proxyType} · ${form.proxyHost}:${form.proxyPort}` : 'Sem proxy'}</strong></div><div className="review-row"><span>Armazenamento</span><strong>Disco persistente isolado</strong></div>
        <div className="warning"><Cloud size={18}/><span>O perfil será registrado agora. Para inicializar o Android real, conecte um worker Linux com KVM.</span></div>
      </div>}
      <div className="modal-actions">{step > 1 && <button type="button" className="secondary" onClick={() => setStep(s => s-1)}>Voltar</button>}<span/><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" type="submit">{step === 3 ? 'Criar perfil' : 'Continuar'}</button></div>
    </form>
  </div></div>
}

function Detail({ profile, onClose, onStart, notify }: { profile: Profile, onClose: () => void, onStart: () => void, notify: (s: string) => void }) {
  return <div className="drawer-layer"><button className="scrim" onClick={onClose}/><section className="drawer">
    <div className="drawer-head"><div className="phone-avatar large"><Smartphone size={24}/></div><div><h2>{profile.name}</h2><span>{profile.id} · {profile.group}</span></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <div className="device-stage"><div className="mock-phone"><div className="notch"/><div className="android-screen"><span>14</span><small>{profile.status === 'running' ? 'Conectando ao stream…' : 'Dispositivo desligado'}</small></div></div></div>
    <div className="quick-actions"><button className="primary" onClick={onStart}><Play size={17}/>Iniciar celular</button><button className="secondary" onClick={() => notify('Snapshot solicitado')}><Copy size={17}/>Snapshot</button></div>
    <div className="detail-section"><h3>Dispositivo</h3><div className="detail-grid"><span>Modelo<strong>{profile.device}</strong></span><span>Sistema<strong>{profile.android}</strong></span><span>Aplicativos<strong>{profile.apps} instalados</strong></span><span>Armazenamento<strong>6,1 GB</strong></span></div></div>
    <div className="detail-section"><h3>Rede e segurança</h3><div className="network-card"><ShieldCheck size={22}/><div><strong>{profile.proxyType} · {profile.proxyHost}</strong><small>{profile.ip} · Kill switch preparado</small></div><button onClick={() => notify('Teste de proxy enviado')}><Wifi size={17}/></button></div></div>
    <div className="detail-section"><h3>Aplicativos</h3><div className="apps-placeholder"><AppWindow size={23}/><div><strong>Gerencie apps no Android</strong><small>Play Store e instalação de APK serão executadas pelo worker.</small></div></div></div>
  </section></div>
}

export default App
