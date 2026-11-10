import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email({ message: 'Format email tidak valid' }),
  password: z.string().min(6, { message: 'Password minimal 6 karakter' }),
})

export type LoginInput = z.infer<typeof loginSchema>

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, { message: 'Refresh token tidak valid' }).optional(),
})

export type RefreshInput = z.infer<typeof refreshSchema>

export interface UserSessionPayload {
  id: string
  email: string
  role: {
    code: string
    name: string
    permissions: string[]
  }
  employee?: {
    id: string
    nik: string
    fullName: string
    jobTitle: { id: string; code: string; name: string; level: string }
    department: { id: string; code: string; name: string } | null
    managerId: string | null
  } | null
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}
