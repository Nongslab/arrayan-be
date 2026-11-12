import { BlockList, isIP } from 'node:net'

const EARTH_RADIUS_METERS = 6_371_000

/** Jarak dua koordinat (meter) — rumus haversine. */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h))
}

/** Normalisasi IPv4 yang dibungkus IPv6 (`::ffff:203.0.113.5` → `203.0.113.5`). */
export function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip
}

/** Validasi satu entri allowlist: alamat IP atau CIDR (IPv4 /0–32, IPv6 /0–128). */
export function isValidIpRange(value: string): boolean {
  const [address, prefix, ...rest] = value.split('/')
  if (rest.length > 0 || !address) return false
  const family = isIP(address)
  if (family === 0) return false
  if (prefix === undefined) return true
  if (!/^\d{1,3}$/.test(prefix)) return false
  return Number(prefix) <= (family === 4 ? 32 : 128)
}

/** Apakah `ip` termasuk salah satu alamat/CIDR di `ranges`. */
export function ipInRanges(ip: string, ranges: readonly string[]): boolean {
  const address = normalizeIp(ip)
  const family = isIP(address)
  if (family === 0) return false
  const list = new BlockList()
  for (const range of ranges) {
    if (!isValidIpRange(range)) continue
    const [base, prefix] = range.split('/')
    const type = isIP(base!) === 4 ? 'ipv4' : 'ipv6'
    if (prefix === undefined) list.addAddress(base!, type)
    else list.addSubnet(base!, Number(prefix), type)
  }
  return list.check(address, family === 4 ? 'ipv4' : 'ipv6')
}
