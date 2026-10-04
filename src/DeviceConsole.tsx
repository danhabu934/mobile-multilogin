import { useEffect, useRef, useState } from 'react'
import type { WorkerApi, DeviceSettings } from './workerClient'
import { downloadJson } from './workerClient'
type Device = { id: string; name: string; group: string; status: string; engine?: string; settings?: DeviceSettings; lastError?: string }
export default function DeviceConsole({ profile, api, onRefresh }: { profile: Device; api: WorkerApi; onRefresh: () => Promise<void> }) {
  const [tab, setTab] = useState('screen'), [image, setImage] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [apps, setApps] = useState<string[]>([]), [report, setReport] = useState<Record<string, unknown> | null>(null), [logs, setLogs] = useState(''), [backups, setBackups] = useState<string[]>([])
  const [name, setName] = useState(profile.name), [group, setGroup] = useState(profile.group), [settings, setSettings] = useState(profile.settings), [url, setUrl] = useState('https://play.google.com/store')
  const [cookiePaste, setCookiePaste] = useState('')
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const prefix = `/v1/profiles/${profile.id}`
  const act = async (operation: () => Promise<unknown>, success = '') => {
    setError(''); setMessage(''); setBusy(true)
    try { await operation(); if (success) setMessage(success); await onRefresh() } catch (e) { setError(e instanceof Error ? e.message : 'Falha na operação') } finally { setBusy(false) }
  }
  useEffect(() => {
    if (tab !== 'screen' || profile.status !== 'running') { setImage(''); return }
    let disposed = false, timer: ReturnType<typeof setTimeout>, current = ''
    const capture = async () => {
      try {
        const blob = await api<Blob>(`${prefix}/screen`)
        if (disposed) return
        const next = URL.createObjectURL(blob); if (current) URL.revokeObjectURL(current); current = next; setImage(next)
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Falha ao capturar tela') }
      finally { if (!disposed) timer = setTimeout(capture, 1500) }
    }
    void capture()
    return () => { disposed = true; clearTimeout(timer); if (current) URL.revokeObjectURL(current) }
  }, [tab, profile.status, prefix, api])
  const point = (e: React.PointerEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: Math.round((e.clientX - rect.left) / rect.width * e.currentTarget.naturalWidth), y: Math.round((e.clientY - rect.top) / rect.height * e.currentTarget.naturalHeight) }
  }
  const input = (body: unknown) => api(`${prefix}/input`, { method: 'POST', body: JSON.stringify(body) })
  const loadApps = () => act(async () => setApps((await api<{ apps: string[] }>(`${prefix}/apps`)).apps))
  const loadBackups = async () => setBackups((await api<{ backups: string[] }>(`${prefix}/backups`)).backups)
  const cookieLines = cookiePaste.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  const cookieMeta = (() => {
    const t = cookiePaste.trim()
    if (!t) return { count: 0, markers: [] as string[], warn: '' }
    try {
      if (t.startsWith('[') || t.startsWith('{')) {
        const p = JSON.parse(t) as unknown
        let arr: unknown[] = []
        if (Array.isArray(p)) arr = p
        else if (p && typeof p === 'object') {
          const o = p as Record<string, unknown>
          for (const c of [o.cookies, (o.data as { cookies?: unknown })?.cookies]) if (Array.isArray(c)) arr = c
        }
        const names = arr.map(x => String((x as { name?: string })?.name ?? '').toLowerCase()).filter(Boolean)
        const markers = ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt', 'sid_guard'].filter(n => names.includes(n))
        const warn = !markers.includes('sessionid') && !markers.includes('sessionid_ss') && !markers.includes('sid_tt')
          ? 'Sem sessionid/sid_tt no JSON — risco alto de deslogar ao doar.'
          : ''
        return { count: arr.length, markers, warn }
      }
    } catch { return { count: 0, markers: [] as string[], warn: 'JSON inválido' } }
    const ns = cookieLines.filter(l => l.split('\t').length >= 7)
    return { count: ns.length || cookieLines.length, markers: [] as string[], warn: '' }
  })()
  const hydrateAccount = () => act(async () => {
    if (!cookiePaste.trim()) throw new Error('Cole os cookies da sessão antes de hidratar.')
    if (profile.status !== 'running') throw new Error('Inicie o Android e aguarde Em execução antes de hidratar.')
    const result = await api<{ ok?: boolean; cookies?: number; launcher?: string; warnings?: string[] }>('/v1/hydrate', {
      method: 'POST',
      body: JSON.stringify({ profileId: profile.id, cookies: cookiePaste }),
    })
    const warn = (result.warnings && result.warnings.length) ? ` ⚠ ${result.warnings.join(' ')}` : ''
    setMessage(`Conta hidratada: ${result.cookies ?? cookieMeta.count} cookie(s) no TikTok${result.launcher ? ` · ${result.launcher}` : ''}.${warn}`)
  }, '')
  return <div className="device-console">
    <div className="console-tabs">{[['screen','Tela'],['session','Sessão'],['apps','Apps'],['diagnostics','Diagnóstico'],['settings','Configuração'],['backups','Backups']].map(([key,label]) => <button key={key} className={tab === key ? 'primary' : 'secondary'} onClick={() => { setTab(key); setError(''); setMessage('') }}>{label}</button>)}</div>
    {profile.lastError && <p className="console-error">{profile.lastError}</p>}
    {error && <p role="alert" className="console-error">{error}</p>}{message && <p role="status" className="console-message">{message}</p>}
    {tab === 'screen' && <>
      <p className="console-help">Prévia atualizada a cada 1,5 s. Clique ou arraste na tela para controlar. Para vídeo e áudio, abra o espelhamento no computador do worker.</p>
      <div className="screen-preview">{image ? <img src={image} alt="Tela atual do Android" draggable={false} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pointer.current = point(e) }} onPointerUp={e => { if (!pointer.current) return; const start = pointer.current, end = point(e); pointer.current = null; void act(() => input(Math.hypot(end.x-start.x,end.y-start.y) > 20 ? { kind:'swipe', ...start, toX:end.x, toY:end.y } : { kind:'tap', ...end })) }}/> : <p>{profile.status === 'running' ? 'Obtendo tela do Android…' : 'Inicie o Android para visualizar e controlar.'}</p>}</div>
      <div className="console-actions">{[['4','Voltar'],['3','Início'],['187','Recentes']].map(([code,label]) => <button className="secondary" disabled={busy || profile.status !== 'running'} key={code} onClick={() => void act(() => input({kind:'key',code}))}>{label}</button>)}<button className="primary" disabled={busy || profile.status !== 'running'} onClick={() => void act(() => api(`${prefix}/mirror`, { method:'POST' }), 'Espelhamento solicitado no computador do worker.')}>Abrir espelhamento</button></div>
      <label className="console-label">Abrir no Android<input value={url} onChange={e => setUrl(e.target.value)}/></label><button className="secondary" disabled={busy || profile.status !== 'running'} onClick={() => void act(() => api(`${prefix}/open-url`, { method:'POST', body:JSON.stringify({url}) }), 'URL enviada ao Android.')}>Abrir site / Play Store</button>
    </>}
    {tab === 'session' && <>
      <p className="console-help">LZT Market: copie o bloco JSON de Cookies e cole abaixo. Aparelho em execução, TikTok instalado, root (su 0). Use o mesmo perfil para a mesma conta (persistência).</p>
      <label className="console-label">Cookies da sessão (JSON LZT)<textarea value={cookiePaste} onChange={e => setCookiePaste(e.target.value)} placeholder={'[{"domain":".tiktok.com","name":"sessionid","value":"..."}, ...]'} style={{minHeight:180, resize:'vertical', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize:11, padding:12, background:'#0d1b2b', color:'#d2dfec', border:'1px solid #263b51', borderRadius:8}}/></label>
      <p className="console-help">{cookieMeta.count ? `${cookieMeta.count} cookie(s)${cookieMeta.markers.length ? ` · sessão: ${cookieMeta.markers.join(', ')}` : ''}` : 'Cole o JSON da LZT para habilitar Hidratar Conta'}</p>
      {cookieMeta.warn && <p className="console-error">{cookieMeta.warn}</p>}
      <div className="console-actions">
        <button className="primary" disabled={busy || profile.status !== 'running' || cookieMeta.count === 0} onClick={() => { if (window.confirm('Injetar cookies no TikTok deste aparelho? (app será reiniciado)')) void hydrateAccount() }}>Hidratar Conta</button>
        <button className="secondary" disabled={busy || !cookiePaste} onClick={() => setCookiePaste('')}>Limpar</button>
        <button className="secondary" disabled={busy || profile.status !== 'running'} onClick={() => void act(() => api(`${prefix}/apps/com.zhiliaoapp.musically/open`, { method: 'POST' }), 'TikTok aberto.')}>Abrir TikTok</button>
      </div>
      <p className="console-help">Fluxo: iniciar perfil → instalar TikTok → colar JSON LZT → Hidratar Conta → testar doação. Cookies não ficam salvos no painel.</p>
    </>}
    {tab === 'apps' && <>
      <div className="console-actions"><button className="secondary" disabled={busy} onClick={() => void loadApps()}>Atualizar aplicativos</button><button className="secondary" disabled={busy} onClick={()=>void act(()=>api(`${prefix}/apps/com.android.vending/open`,{method:'POST'}))}>Abrir Play Store</button><label className="secondary">Instalar APK<input type="file" accept=".apk" disabled={busy} style={{display:'none'}} onChange={e => { const file=e.target.files?.[0]; if(file) void act(async () => { await api(`${prefix}/apk`, {method:'POST',body:file}); setApps((await api<{apps:string[]}>(`${prefix}/apps`)).apps) }, 'APK instalado.'); e.target.value='' }}/></label></div>
      <p className="console-help">Instale pela Play Store no aparelho ou selecione um APK. Pacotes divididos (.xapk/.apks) precisam do instalador apropriado no Android.</p>
      {apps.map(pkg => <div className="app-item" key={pkg}><span>{pkg}</span><button className="secondary" disabled={busy} onClick={() => void act(() => api(`${prefix}/apps/${encodeURIComponent(pkg)}/open`, {method:'POST'}))}>Abrir</button><button className="secondary" disabled={busy} onClick={()=>void act(async()=>{setReport(await api(`${prefix}/apps/${encodeURIComponent(pkg)}/diagnostics`));setTab('diagnostics')})}>Diagnosticar</button></div>)}
    </>}
    {tab === 'diagnostics' && <>
      <div className="console-actions"><button className="primary" disabled={busy} onClick={() => void act(async () => setReport(await api(`${prefix}/diagnostics`)))}>Diagnosticar Android</button><button className="secondary" disabled={busy} onClick={() => void act(async () => setLogs((await api<{text:string}>(`${prefix}/logs`)).text))}>Ver logs</button>{report && <button className="secondary" onClick={() => downloadJson(`nexo-${profile.id}-diagnostico.json`, report)}>Exportar</button>}</div>
      {report && <dl className="diagnostics-grid">{Object.entries(report).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl>}{logs && <pre className="console-output">{logs}</pre>}
    </>}
    {tab === 'settings' && <>
      <label className="console-label">Nome<input value={name} onChange={e=>setName(e.target.value)}/></label><label className="console-label">Grupo<input value={group} onChange={e=>setGroup(e.target.value)}/></label>
      {(profile.engine ?? 'android-emulator') === 'android-emulator' && settings && <><label className="console-label">RAM (MB)<input type="number" min={1536} max={16384} value={settings.memoryMb} onChange={e=>setSettings({...settings,memoryMb:Number(e.target.value)})}/></label><label className="console-label">Núcleos<input type="number" min={1} max={16} value={settings.cores} onChange={e=>setSettings({...settings,cores:Number(e.target.value)})}/></label><label className="console-label">GPU<select value={settings.gpu} onChange={e=>setSettings({...settings,gpu:e.target.value})}><option value="auto">Automático</option><option value="host">GPU do computador</option><option value="software">Software</option><option value="swiftshader_indirect">SwiftShader legado</option></select></label><label className="console-label">Câmera frontal<select value={settings.cameraFront} onChange={e=>setSettings({...settings,cameraFront:e.target.value})}><option value="none">Desativada</option><option value="emulated">Simulada</option>{[0,1,2,3].map(n=><option key={n} value={`webcam${n}`}>Webcam {n}</option>)}</select></label><p className="console-help">A numeração das webcams depende do SDK e do computador. No BlueStacks, selecione OBS Virtual Camera nas configurações dele.</p></>}
      <button className="primary" disabled={busy} onClick={() => void act(() => api(prefix, {method:'PATCH',body:JSON.stringify({displayName:name,group,...((profile.engine ?? 'android-emulator') === 'android-emulator' ? {settings} : {})})}), 'Configuração salva.')}>Salvar com Android desligado</button>
    </>}
    {tab === 'backups' && <>
      <p className="console-help">Backup completo local do disco do Android Emulator. A criação desliga o aparelho e pode demorar. Backups contêm dados privados e devem ficar em um disco protegido. Para BlueStacks, use o backup do próprio motor.</p>
      <div className="console-actions"><button className="secondary" disabled={busy} onClick={() => void act(loadBackups)}>Listar backups</button><button className="primary" disabled={busy || profile.engine !== 'android-emulator'} onClick={() => { if(window.confirm('Desligar este Android e criar um backup completo do disco?')) void act(async () => { await api(`${prefix}/backups`, {method:'POST'}); await loadBackups() }, 'Backup completo criado.') }}>Criar backup completo</button></div>
      {backups.map(backup => <div className="app-item" key={backup}><span>{backup}</span><button className="secondary" disabled={busy} onClick={() => { if(window.confirm('Restaurar este backup? O estado atual do Android será substituído.')) void act(() => api(`${prefix}/restore`, {method:'POST',body:JSON.stringify({backup})}), 'Disco restaurado.') }}>Restaurar</button></div>)}
    </>}
    {busy && <p role="status" className="console-help">Executando no worker…</p>}
  </div>
}
