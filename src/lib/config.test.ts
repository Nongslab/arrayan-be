import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config.js'

const SECRET_A = 'a'.repeat(64)
const SECRET_B = 'b'.repeat(64)
const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  JWT_SECRET: SECRET_A,
  COOKIE_SECRET: SECRET_B,
}
const production = {
  ...base,
  NODE_ENV: 'production',
  CORS_ORIGIN: 'https://hris.arryan.co.id',
  APP_BASE_URL: 'https://hris.arryan.co.id/',
}

function problemsOf(env: Record<string, string>): string[] {
  try {
    loadConfig(env)
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError)
    return (err as ConfigError).problems
  }
  throw new Error('loadConfig seharusnya gagal')
}

describe('loadConfig', () => {
  it('default development yang aman', () => {
    const config = loadConfig(base)
    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 4000,
      host: '0.0.0.0',
      corsOrigins: ['http://localhost:5173'],
      appBaseUrl: 'http://localhost:5173',
      trustProxy: false,
      docsEnabled: true,
      exposeDevLinks: true,
      logLevel: 'info',
      warnings: [],
    })
  })

  it('mode test memakai log silent', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).logLevel).toBe('silent')
  })

  it('menyebutkan semua masalah sekaligus', () => {
    const problems = problemsOf({ DATABASE_URL: 'mysql://x', JWT_SECRET: 'pendek', PORT: 'abc' })
    expect(problems.join('\n')).toMatch(/DATABASE_URL/)
    expect(problems.join('\n')).toMatch(/JWT_SECRET: minimal 32/)
    expect(problems.join('\n')).toMatch(/COOKIE_SECRET: wajib diisi/)
    expect(problems.join('\n')).toMatch(/PORT/)
    expect(problems.length).toBeGreaterThanOrEqual(4)
  })

  it('JWT_SECRET dan COOKIE_SECRET harus berbeda', () => {
    expect(problemsOf({ ...base, COOKIE_SECRET: SECRET_A })).toEqual(['COOKIE_SECRET: harus berbeda dari JWT_SECRET'])
  })

  it('CORS_ORIGIN mendukung beberapa origin', () => {
    const config = loadConfig({ ...base, CORS_ORIGIN: 'http://localhost:5173, http://127.0.0.1:5173/' })
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173'])
  })

  it('production valid: docs mati, link dev tidak diekspos, peringatan driver log', () => {
    const config = loadConfig(production)
    expect(config).toMatchObject({
      isProduction: true,
      docsEnabled: false,
      exposeDevLinks: false,
      appBaseUrl: 'https://hris.arryan.co.id',
    })
    expect(config.warnings[0]).toMatch(/INVITATION_DRIVER=log/)
    expect(loadConfig({ ...production, DOCS_ENABLED: 'true' }).docsEnabled).toBe(true)
  })

  it('production menolak secret contoh, origin http, dan APP_BASE_URL kosong', () => {
    const problems = problemsOf({
      ...base,
      NODE_ENV: 'production',
      JWT_SECRET: 'super_secret_jwt_key_arrayan_hris_dev_2026',
      CORS_ORIGIN: 'http://hris.arryan.co.id',
    }).join('\n')
    expect(problems).toMatch(/JWT_SECRET: masih memakai nilai contoh/)
    expect(problems).toMatch(/CORS_ORIGIN: origin harus https/)
    expect(problems).toMatch(/APP_BASE_URL: wajib diisi/)
  })

  it('production mewajibkan CORS_ORIGIN', () => {
    const { CORS_ORIGIN: _omit, ...env } = production
    expect(problemsOf(env)).toEqual(['CORS_ORIGIN: wajib diisi di production (origin FE)'])
  })

  it('driver undangan yang belum didukung ditolak', () => {
    expect(problemsOf({ ...base, INVITATION_DRIVER: 'smtp' })[0]).toMatch(/INVITATION_DRIVER/)
  })
})
