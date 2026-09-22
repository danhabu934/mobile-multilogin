import { z } from 'zod'

export const profileIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{2,31}$/)

const proxySchema = z.object({
  type: z.enum(['none', 'http', 'https', 'socks5']).default('none'),
  host: z.string().min(1).max(253).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().max(128).optional(),
  password: z.string().max(256).optional(),
}).superRefine((proxy, ctx) => {
  if (proxy.type !== 'none' && (!proxy.host || !proxy.port)) {
    ctx.addIssue({ code: 'custom', message: 'Proxy host and port are required' })
  }
})

export const createProfileSchema = z.object({
  id: profileIdSchema,
  displayName: z.string().min(2).max(80),
  proxy: proxySchema.default({ type: 'none' }),
})

const androidSettingsSchema = z.object({
  locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).optional(),
  timezone: z.string().min(1).max(64).optional(),
  timeFormat: z.enum(['12', '24']).optional(),
  animationScale: z.number().min(0).max(10).optional(),
})

const appLaunchSchema = z.object({
  packageName: z.string().regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/),
  activity: z.string().min(1).max(256).optional(),
})

export const provisionProfileSchema = z.object({
  android: androidSettingsSchema.default({}),
  launch: appLaunchSchema.optional(),
  state: z.record(z.string(), z.unknown()).default({}),
})
