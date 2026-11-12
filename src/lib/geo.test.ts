import { describe, expect, it } from 'vitest'
import { distanceMeters, ipInRanges, isValidIpRange, normalizeIp } from './geo.js'

describe('geo', () => {
  it('haversine: Monas → Bundaran HI ± 2,1 km; titik sama 0', () => {
    const monas = { latitude: -6.175392, longitude: 106.827153 }
    const hi = { latitude: -6.194951, longitude: 106.823027 }
    expect(distanceMeters(monas, hi)).toBeGreaterThan(2100)
    expect(distanceMeters(monas, hi)).toBeLessThan(2300)
    expect(distanceMeters(monas, monas)).toBe(0)
  })

  it('jarak ~50 m untuk selisih 0,00045° lintang', () => {
    const d = distanceMeters({ latitude: -6.2, longitude: 106.8 }, { latitude: -6.20045, longitude: 106.8 })
    expect(Math.round(d)).toBe(50)
  })

  it('validasi entri allowlist', () => {
    expect(isValidIpRange('203.0.113.5')).toBe(true)
    expect(isValidIpRange('203.0.113.0/24')).toBe(true)
    expect(isValidIpRange('2001:db8::/32')).toBe(true)
    expect(isValidIpRange('203.0.113.0/33')).toBe(false)
    expect(isValidIpRange('kantor-pusat')).toBe(false)
    expect(isValidIpRange('10.0.0.0/8/1')).toBe(false)
  })

  it('pencocokan IP & CIDR (termasuk IPv4 dibungkus IPv6)', () => {
    const ranges = ['203.0.113.0/24', '198.51.100.7', '2001:db8::/32']
    expect(ipInRanges('203.0.113.250', ranges)).toBe(true)
    expect(ipInRanges('::ffff:198.51.100.7', ranges)).toBe(true)
    expect(ipInRanges('2001:db8::1', ranges)).toBe(true)
    expect(ipInRanges('203.0.114.1', ranges)).toBe(false)
    expect(ipInRanges('bukan-ip', ranges)).toBe(false)
    expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1')
  })
})
