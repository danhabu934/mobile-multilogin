import { z } from 'zod'
export const profileIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{2,31}$/)
export const proxySchema = z.object({
  type: z.enum(['none', 'http', 'https', 'socks5']).default('none'),
  host: z.string().regex(/^[a-zA-Z0-9.:[\]-]+$/).max(253).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().max(128).optional(), password: z.string().max(256).optional(),
}).superRefine((p, ctx) => { if (p.type !== 'none' && (!p.host || !p.port)) ctx.addIssue({ code: 'custom', message: 'Proxy host and port are required' }) })
export const settingsSchema = z.object({
  memoryMb: z.number().int().min(1536).max(16384), cores: z.number().int().min(1).max(16),
  heapMb: z.number().int().min(128).max(2048), resolution: z.string().regex(/^\d{3,4}x\d{3,4}$/),
  density: z.number().int().min(120).max(640), gpu: z.enum(['auto', 'host', 'software', 'swiftshader_indirect']),
  cameraFront: z.string().regex(/^(none|emulated|webcam\d+)$/), cameraBack: z.string().regex(/^(none|emulated|webcam\d+)$/),
})
export const createProfileSchema = z.object({
  id: profileIdSchema, displayName: z.string().trim().min(2).max(80), proxy: proxySchema.default({ type: 'none' }),
  group: z.string().max(80).default('Android local'), notes: z.string().max(1000).default(''),
  engine: z.enum(['android-emulator', 'bluestacks', 'physical']).default('android-emulator'),
  systemImage: z.string().regex(/^system-images;android-\d{2};google_apis(?:_playstore)?;(x86_64|arm64-v8a)$/).optional(),
  deviceId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(80).optional(), settings: settingsSchema.optional(),
  serial: z.string().regex(/^(?:127\.0\.0\.1:\d{1,5}|[a-zA-Z0-9_-]{3,100})$/).optional(),
  instanceName: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  purpose: z.enum(['general', 'referral']).default('general'),
}).superRefine((p, ctx) => {
  if (p.engine !== 'android-emulator' && !p.serial) ctx.addIssue({ code: 'custom', message: 'Selecione um dispositivo ADB existente' })
  if (p.engine !== 'android-emulator' && p.proxy.type !== 'none') ctx.addIssue({ code: 'custom', message: 'Configure a rede no motor externo; o Nexo n\u00e3o aplica proxy a este dispositivo' })
  if (p.proxy.type === 'socks5' || p.proxy.type === 'https') ctx.addIssue({ code: 'custom', message: 'Este motor suporta proxy HTTP. SOCKS5 e TLS para o proxy exigem um t\u00fanel separado' })
  if (p.purpose === 'referral') {
    if (p.proxy.type === 'none' || !p.proxy.host || !p.proxy.port) {
      ctx.addIssue({ code: 'custom', message: 'Conta de indica\u00e7\u00e3o exige proxy HTTP com host e porta (IP isolado por perfil)' })
    }
    if (p.proxy.type !== 'none' && p.proxy.type !== 'http') {
      ctx.addIssue({ code: 'custom', message: 'Conta de indica\u00e7\u00e3o: use proxy HTTP (ou t\u00fanel local apontando para HTTP)' })
    }
  }
})
export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(), group: z.string().max(80).optional(), notes: z.string().max(1000).optional(),
  settings: settingsSchema.optional(), proxy: proxySchema.optional(), purpose: z.enum(['general', 'referral']).optional(),
}).superRefine((p, ctx) => {
  if (p.purpose === 'referral' && p.proxy && (p.proxy.type === 'none' || !p.proxy.host || !p.proxy.port)) {
    ctx.addIssue({ code: 'custom', message: 'Conta de indica\u00e7\u00e3o exige proxy HTTP configurado' })
  }
})
export const packageSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/).max(200)
export const inputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap'), x: z.number().int().min(0).max(10000), y: z.number().int().min(0).max(10000) }),
  z.object({ kind: z.literal('swipe'), x: z.number().int().min(0).max(10000), y: z.number().int().min(0).max(10000), toX: z.number().int().min(0).max(10000), toY: z.number().int().min(0).max(10000) }),
  z.object({ kind: z.literal('key'), code: z.enum(['3', '4', '24', '25', '26', '66', '187']) }),
])
