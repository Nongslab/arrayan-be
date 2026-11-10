import { describe, it, expect } from 'vitest'
import { createLoginLimiter } from './login-limiter.js'

describe('loginLimiter', () => {
  const setup = () => {
    let clock = 0
    const limiter = createLoginLimiter(5, 15 * 60 * 1000, () => clock)
    return { limiter, advance: (ms: number) => (clock += ms) }
  }

  it('mengizinkan login sebelum batas percobaan gagal tercapai', () => {
    const { limiter } = setup()
    for (let i = 0; i < 4; i++) limiter.recordFailure('1.1.1.1', 'a@arrayan.com')
    expect(limiter.retryAfterSeconds('1.1.1.1', 'a@arrayan.com')).toBe(0)
  })

  it('mengunci setelah 5 percobaan gagal dalam 15 menit', () => {
    const { limiter } = setup()
    for (let i = 0; i < 5; i++) limiter.recordFailure('1.1.1.1', 'a@arrayan.com')
    expect(limiter.retryAfterSeconds('1.1.1.1', 'a@arrayan.com')).toBe(900)
  })

  it('tidak mengunci email lain dari IP yang sama (IP kantor bersama)', () => {
    const { limiter } = setup()
    for (let i = 0; i < 5; i++) limiter.recordFailure('1.1.1.1', 'a@arrayan.com')
    expect(limiter.retryAfterSeconds('1.1.1.1', 'b@arrayan.com')).toBe(0)
  })

  it('email tidak case-sensitive', () => {
    const { limiter } = setup()
    for (let i = 0; i < 5; i++) limiter.recordFailure('1.1.1.1', 'A@Arrayan.com')
    expect(limiter.retryAfterSeconds('1.1.1.1', 'a@arrayan.com')).toBeGreaterThan(0)
  })

  it('membuka kunci setelah jendela waktu berakhir', () => {
    const { limiter, advance } = setup()
    for (let i = 0; i < 5; i++) limiter.recordFailure('1.1.1.1', 'a@arrayan.com')
    advance(15 * 60 * 1000)
    expect(limiter.retryAfterSeconds('1.1.1.1', 'a@arrayan.com')).toBe(0)
  })

  it('login sukses mereset hitungan', () => {
    const { limiter } = setup()
    for (let i = 0; i < 4; i++) limiter.recordFailure('1.1.1.1', 'a@arrayan.com')
    limiter.reset('1.1.1.1', 'a@arrayan.com')
    limiter.recordFailure('1.1.1.1', 'a@arrayan.com')
    expect(limiter.retryAfterSeconds('1.1.1.1', 'a@arrayan.com')).toBe(0)
  })
})
