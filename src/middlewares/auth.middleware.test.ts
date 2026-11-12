import { describe, it, expect, vi } from 'vitest'
import { createAuthenticate, authorize } from './auth.middleware.js'
import type { UserSessionPayload } from '../modules/auth/auth.schema.js'

const freshSession: UserSessionPayload = {
  id: 'user-123',
  email: 'user@arrayan.com',
  sessionVersion: 2,
  role: { code: 'MANAGER', name: 'Manager', permissions: [] },
  employee: null,
}

/** Pemuat sesi palsu: hanya sessionVersion 2 milik user-123 yang masih berlaku. */
const loadSession = vi.fn(async (userId: string, sessionVersion: unknown) =>
  userId === 'user-123' && sessionVersion === 2 ? freshSession : null,
)
const authenticate = createAuthenticate(loadSession)
import type { FastifyRequest, FastifyReply } from 'fastify'

describe('auth.middleware', () => {
  describe('authenticate', () => {
    it('harus mengembalikan 401 jika header Authorization dan cookie tidak ada', async () => {
      const request = {
        headers: {},
        cookies: {},
      } as unknown as FastifyRequest

      const statusMock = vi.fn().mockReturnThis()
      const sendMock = vi.fn()
      const reply = {
        status: statusMock,
        send: sendMock,
      } as unknown as FastifyReply

      await authenticate(request, reply)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: expect.stringContaining('Token otentikasi tidak ditemukan'),
        }),
      )
    })

    it('harus mengisi userSession jika Authorization: Bearer token valid', async () => {
      const mockSession = {
        id: 'user-123',
        email: 'user@arrayan.com',
        sessionVersion: 2,
        role: { code: 'STAFF', name: 'Staff', permissions: [] },
      }

      const request = {
        headers: { authorization: 'Bearer valid-bearer-token' },
        cookies: {},
        server: {
          jwt: {
            verify: vi.fn().mockReturnValue(mockSession),
          },
        },
      } as unknown as FastifyRequest

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as FastifyReply

      await authenticate(request, reply)

      expect(request.server.jwt.verify).toHaveBeenCalledWith('valid-bearer-token')
      // Sesi diambil segar dari DB (role terbaru), bukan dari isi token
      expect(request.userSession).toEqual(freshSession)
    })

    it('harus mengisi userSession dari cookie jika header Authorization tidak ada', async () => {
      const mockSession = {
        id: 'user-123',
        email: 'user@arrayan.com',
        sessionVersion: 2,
        role: { code: 'STAFF', name: 'Staff', permissions: [] },
      }

      const request = {
        headers: {},
        cookies: { arrayan_access_token: 'valid-cookie-token' },
        server: {
          jwt: {
            verify: vi.fn().mockReturnValue(mockSession),
          },
        },
      } as unknown as FastifyRequest

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as FastifyReply

      await authenticate(request, reply)

      expect(request.server.jwt.verify).toHaveBeenCalledWith('valid-cookie-token')
      // Sesi diambil segar dari DB (role terbaru), bukan dari isi token
      expect(request.userSession).toEqual(freshSession)
    })

    it('harus mengembalikan 401 jika token invalid atau kedaluwarsa', async () => {
      const request = {
        headers: { authorization: 'Bearer invalid-token' },
        cookies: {},
        server: {
          jwt: {
            verify: vi.fn().mockImplementation(() => {
              throw new Error('jwt expired')
            }),
          },
        },
      } as unknown as FastifyRequest

      const statusMock = vi.fn().mockReturnThis()
      const sendMock = vi.fn()
      const reply = {
        status: statusMock,
        send: sendMock,
      } as unknown as FastifyReply

      await authenticate(request, reply)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Token otentikasi tidak valid atau telah kedaluwarsa.',
        }),
      )
    })

    it('harus mengembalikan 401 jika sessionVersion token sudah usang (akun dinonaktifkan / password diganti)', async () => {
      const request = {
        headers: { authorization: 'Bearer old-token' },
        cookies: {},
        server: {
          jwt: { verify: vi.fn().mockReturnValue({ id: 'user-123', sessionVersion: 1 }) },
        },
      } as unknown as FastifyRequest

      const statusMock = vi.fn().mockReturnThis()
      const sendMock = vi.fn()
      const reply = { status: statusMock, send: sendMock } as unknown as FastifyReply

      await authenticate(request, reply)

      expect(loadSession).toHaveBeenCalledWith('user-123', 1)
      expect(statusMock).toHaveBeenCalledWith(401)
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Sesi tidak berlaku lagi. Silakan login kembali.' }),
      )
      expect(request.userSession).toBeUndefined()
    })
  })

  describe('authorize', () => {
    it('harus mengembalikan 401 jika userSession tidak ditemukan', async () => {
      const request = {} as unknown as FastifyRequest
      const statusMock = vi.fn().mockReturnThis()
      const sendMock = vi.fn()
      const reply = {
        status: statusMock,
        send: sendMock,
      } as unknown as FastifyReply

      const guard = authorize(['SUPER_ADMIN'])
      await guard(request, reply)

      expect(statusMock).toHaveBeenCalledWith(401)
    })

    it('harus mengembalikan 403 jika role user tidak termasuk dalam allowedRoles', async () => {
      const request = {
        userSession: {
          id: 'user-123',
          email: 'staff@arrayan.com',
          role: { code: 'STAFF', name: 'Staff', permissions: [] },
        },
      } as unknown as FastifyRequest

      const statusMock = vi.fn().mockReturnThis()
      const sendMock = vi.fn()
      const reply = {
        status: statusMock,
        send: sendMock,
      } as unknown as FastifyReply

      const guard = authorize(['SUPER_ADMIN', 'HR_GA'])
      await guard(request, reply)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
        }),
      )
    })

    it('harus mengizinkan request jika role user termasuk dalam allowedRoles', async () => {
      const request = {
        userSession: {
          id: 'user-admin',
          email: 'admin@arrayan.com',
          role: { code: 'SUPER_ADMIN', name: 'Super Admin', permissions: ['all'] },
        },
      } as unknown as FastifyRequest

      const statusMock = vi.fn().mockReturnThis()
      const sendMock = vi.fn()
      const reply = {
        status: statusMock,
        send: sendMock,
      } as unknown as FastifyReply

      const guard = authorize(['SUPER_ADMIN', 'HR_GA'])
      await guard(request, reply)

      expect(statusMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
    })
  })
})
