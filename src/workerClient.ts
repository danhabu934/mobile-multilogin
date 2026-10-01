export type WorkerApi = <T>(path: string, options?: RequestInit) => Promise<T>
export function workerClient(url: string, token: string): WorkerApi {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Use um endereço HTTP/HTTPS sem credenciais na URL')
  return async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.body instanceof File || /backups|restore/.test(path) ? 300000 : 20000)
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}${path}`, { ...options, signal: controller.signal,
        headers: { ...(options.body instanceof File ? { 'Content-Type': 'application/vnd.android.package-archive' } : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token}`, ...options.headers } })
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(Array.isArray(body.details) ? body.details.map((d: {path?:string[];message:string})=>`${d.path?.join('.') || 'Dados'}: ${d.message}`).join('; ') : body.error ?? `Erro HTTP ${response.status}`) }
      if (response.headers.get('Content-Type')?.startsWith('image/')) return await response.blob() as T
      return await response.json() as T
    } catch (e) { if (e instanceof DOMException && e.name === 'AbortError') throw new Error('Worker não respondeu no prazo. Consulte os logs antes de repetir a operação.'); throw e }
    finally { clearTimeout(timeout) }
  }
}
export type DeviceSettings = { memoryMb: number; cores: number; heapMb: number; resolution: string; density: number; gpu: string; cameraFront: string; cameraBack: string }
export type Catalogue = {
  dryRun: boolean; emulatorReady: boolean; adb: boolean; accelerationDetails: string;
  memory: { totalMb: number; freeMb: number }; disk: { totalBytes: number; freeBytes: number } | null;
  installedImages: string[]; systemImage: string; deviceId: string; defaults: DeviceSettings;
  devices: { serial: string; state: string }[]; deviceDefinitions: { id: string; name: string }[];
  maxActiveEmulators: number; blueStacksLauncher: boolean; warnings: string[];
}
export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
