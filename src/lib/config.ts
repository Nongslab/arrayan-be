import { z } from 'zod'

/**
 * Konfigurasi aplikasi — satu-satunya tempat membaca environment variable.
 * Divalidasi sekali saat start; bila ada yang salah, server berhenti dan menyebutkan
 * SEMUA variabel bermasalah sekaligus. Aturan tambahan berlaku saat NODE_ENV=production.
 */

/** Nilai contoh dari .env.example — tidak boleh dipakai di production. */
const EXAMPLE_SECRETS = new Set([
  'super_secret_jwt_key_arrayan_hris_dev_2026',
  'super_secret_cookie_key_arrayan_hris_dev_2026',
])

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

const booleanString = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'))

const urlList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: z
      .string({ required_error: 'wajib diisi' })
      .regex(/^postgres(ql)?:\/\//, 'harus URL PostgreSQL (postgresql://...)'),
    JWT_SECRET: z.string({ required_error: 'wajib diisi' }).min(32, 'minimal 32 karakter'),
    COOKIE_SECRET: z.string({ required_error: 'wajib diisi' }).min(32, 'minimal 32 karakter'),
    CORS_ORIGIN: urlList.describe('Satu atau beberapa origin FE, dipisah koma'),
    APP_BASE_URL: z.string().optional(),
    TRUST_PROXY: booleanString,
    INVITATION_DRIVER: z.enum(['log'], { message: 'saat ini hanya "log" yang didukung' }).default('log'),
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
    DOCS_ENABLED: booleanString,
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })

    if (env.JWT_SECRET === env.COOKIE_SECRET) issue('COOKIE_SECRET', 'harus berbeda dari JWT_SECRET')
    if (env.NODE_ENV !== 'production') return

    for (const name of ['JWT_SECRET', 'COOKIE_SECRET'] as const) {
      if (EXAMPLE_SECRETS.has(env[name])) issue(name, 'masih memakai nilai contoh .env.example — generate: openssl rand -hex 32')
    }
    if (env.CORS_ORIGIN.length === 0) issue('CORS_ORIGIN', 'wajib diisi di production (origin FE)')
    for (const origin of env.CORS_ORIGIN) {
      if (!origin.startsWith('https://')) issue('CORS_ORIGIN', `origin harus https di production: ${origin}`)
    }
    if (!env.APP_BASE_URL) issue('APP_BASE_URL', 'wajib diisi di production (URL FE untuk link aktivasi)')
    else if (!env.APP_BASE_URL.startsWith('https://')) issue('APP_BASE_URL', 'harus https di production')
  })

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  isProduction: boolean
  host: string
  port: number
  databaseUrl: string
  jwtSecret: string
  cookieSecret: string
  corsOrigins: string[]
  appBaseUrl: string
  trustProxy: boolean
  invitationDriver: 'log'
  logLevel: (typeof LOG_LEVELS)[number]
  docsEnabled: boolean
  /** Link aktivasi / reset dikembalikan di response API hanya di luar production. */
  exposeDevLinks: boolean
  /** Peringatan non-fatal untuk ditampilkan saat start. */
  warnings: string[]
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Konfigurasi environment tidak valid:\n${problems.map((p) => `  - ${p}`).join('\n')}\nLihat .env.example.`)
  }
}

const DEV_FRONTEND = 'http://localhost:5173'

/** Validasi & bentuk konfigurasi dari environment. Melempar ConfigError berisi semua masalah. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`))
  }

  const e = parsed.data
  const isProduction = e.NODE_ENV === 'production'
  const warnings: string[] = []
  if (isProduction && e.INVITATION_DRIVER === 'log') {
    warnings.push('INVITATION_DRIVER=log di production: undangan aktivasi & link reset password TIDAK terkirim ke user.')
  }

  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    isProduction,
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    cookieSecret: e.COOKIE_SECRET,
    corsOrigins: e.CORS_ORIGIN.length > 0 ? e.CORS_ORIGIN : [DEV_FRONTEND],
    appBaseUrl: (e.APP_BASE_URL || DEV_FRONTEND).replace(/\/+$/, ''),
    trustProxy: e.TRUST_PROXY ?? false,
    invitationDriver: e.INVITATION_DRIVER,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    docsEnabled: e.DOCS_ENABLED ?? !isProduction,
    exposeDevLinks: !isProduction,
    warnings,
  })
}

let cached: AppConfig | undefined

/** Konfigurasi bersama (divalidasi saat pertama dipakai). */
export function getConfig(): AppConfig {
  cached ??= loadConfig()
  return cached
}

/** Akses ringkas yang dipakai modul lain. */
export const appConfig = {
  get isProduction() {
    return getConfig().isProduction
  },
  get appBaseUrl() {
    return getConfig().appBaseUrl
  },
  get invitationDriver() {
    return getConfig().invitationDriver
  },
  get exposeDevLinks() {
    return getConfig().exposeDevLinks
  },
}
