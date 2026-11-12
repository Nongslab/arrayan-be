import 'dotenv/config'
import { buildApp } from './app.js'
import { ConfigError, getConfig } from './lib/config.js'

const SHUTDOWN_TIMEOUT_MS = 10_000

async function bootstrap() {
  let config
  try {
    config = getConfig()
  } catch (err) {
    // Tampilkan semua masalah konfigurasi sekaligus, lalu berhenti.
    console.error(err instanceof ConfigError ? err.message : err)
    process.exit(1)
  }

  const fastify = await buildApp()

  // Graceful shutdown: selesaikan request yang berjalan, tutup DB (hook onClose), lalu keluar.
  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    fastify.log.info({ signal }, 'Menerima sinyal, menutup server...')
    const force = setTimeout(() => {
      fastify.log.error('Shutdown melebihi batas waktu, keluar paksa')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    force.unref()
    try {
      await fastify.close()
      process.exit(0)
    } catch (err) {
      fastify.log.error({ err }, 'Gagal menutup server')
      process.exit(1)
    }
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))

  try {
    await fastify.listen({ port: config.port, host: config.host })
    fastify.log.info(`Server berjalan di http://localhost:${config.port}`)
    if (config.docsEnabled) fastify.log.info(`Dokumentasi Swagger: http://localhost:${config.port}/docs`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

bootstrap()
