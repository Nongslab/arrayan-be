/** Konfigurasi aplikasi non-rahasia yang dibaca dari environment. */
export const appConfig = {
  get isProduction() {
    return process.env.NODE_ENV === 'production'
  },
  /** URL frontend — dasar link aktivasi / reset password. */
  get appBaseUrl() {
    return (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '')
  },
  /** Driver pengiriman undangan. Saat ini hanya `log`; `smtp`/`resend`/`whatsapp` menyusul. */
  get invitationDriver() {
    return process.env.INVITATION_DRIVER || 'log'
  },
  /** Link aktivasi dikembalikan di response API hanya di luar production (untuk dev & test). */
  get exposeDevLinks() {
    return process.env.NODE_ENV !== 'production'
  },
}
