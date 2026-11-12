import 'dotenv/config'
import { buildApp } from './app.js'

async function bootstrap() {
  const fastify = await buildApp()

  const PORT = Number(process.env.PORT) || 4000
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`)
    console.log(`📖 Dokumentasi Swagger: http://localhost:${PORT}/docs`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

bootstrap()
