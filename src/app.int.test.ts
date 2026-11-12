import { Writable } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { buildApp, LOG_REDACT_PATHS } from './app.js'

describe('app hardening (integration)', () => {
  const apps: Array<{ close(): Promise<unknown> }> = []
  afterAll(async () => {
    for (const app of apps) await app.close()
  })

  it('error tak terduga → 500 generik tanpa detail internal', async () => {
    const app = await buildApp({ logger: false })
    apps.push(app)
    app.get('/__boom', async () => {
      throw new Error('Invalid `prisma.user.findUnique()` invocation: detail rahasia')
    })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/__boom' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Terjadi kesalahan pada server. Silakan coba lagi.',
    })
    expect(res.body).not.toContain('prisma')
  })

  it('error validasi 4xx tetap informatif dengan format konsisten', async () => {
    const app = await buildApp({ logger: false })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ statusCode: 400, error: 'Bad Request', message: expect.stringMatching(/email/) })
  })

  it('field sensitif disamarkan di log', async () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(chunk.toString())
        done()
      },
    })
    const app = Fastify({ logger: { level: 'info', stream, redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' } } })
    apps.push(app)
    app.post('/__log', async (request) => {
      request.log.info({ headers: request.headers, body: request.body }, 'debug request')
      return { ok: true }
    })
    await app.inject({
      method: 'POST',
      url: '/__log',
      headers: { authorization: 'Bearer rahasia-jwt', cookie: 'arrayan_access_token=rahasia-cookie' },
      payload: { email: 'a@b.c', password: 'RahasiaSekali1!', token: 'f'.repeat(64) },
    })

    const output = lines.join('')
    expect(output).toContain('debug request')
    expect(output).toContain('[REDACTED]')
    expect(output).not.toMatch(/rahasia-jwt|rahasia-cookie|RahasiaSekali1!|f{64}/)
    expect(output).toContain('a@b.c')
  })

  it('Swagger UI aktif di luar production', async () => {
    const app = await buildApp({ logger: false })
    apps.push(app)
    expect((await app.inject({ method: 'GET', url: '/docs/json' })).statusCode).toBe(200)
  })
})
