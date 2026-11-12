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

/** Kebijakan password akun (aktivasi & reset). Maks. 72 karakter = batas bcrypt. */
export const passwordPolicySchema = z
  .string()
  .min(8, { message: 'Password minimal 8 karakter' })
  .max(72, { message: 'Password maksimal 72 karakter' })
  .regex(/[a-z]/, { message: 'Password harus mengandung huruf kecil' })
  .regex(/[A-Z]/, { message: 'Password harus mengandung huruf besar' })
  .regex(/[0-9]/, { message: 'Password harus mengandung angka' })
  .regex(/[^A-Za-z0-9]/, { message: 'Password harus mengandung simbol' })

export const activateSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, { message: 'Token aktivasi tidak valid' }),
  password: passwordPolicySchema,
})

export type ActivateInput = z.infer<typeof activateSchema>

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
