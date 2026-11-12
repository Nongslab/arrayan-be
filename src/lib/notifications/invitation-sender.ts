import { appConfig } from '../config.js'

export interface InvitationMessage {
  to: string
  fullName: string
  link: string
  expiresAt: Date
}

/**
 * Port pengiriman undangan aktivasi akun. Service hanya bergantung pada antarmuka ini,
 * sehingga driver email (SMTP/Resend) atau WhatsApp bisa ditambahkan tanpa mengubah
 * endpoint maupun database.
 */
export interface InvitationSender {
  readonly driver: string
  send(message: InvitationMessage): Promise<void>
}

type Logger = (payload: Record<string, unknown>, message: string) => void

/**
 * Driver `log`: menulis undangan ke log aplikasi. Link (berisi token) hanya ditulis
 * di luar production agar token tidak bocor ke log server produksi.
 */
export class LogInvitationSender implements InvitationSender {
  readonly driver = 'log'

  constructor(private readonly log: Logger = (payload, message) => console.info(message, payload)) {}

  async send(message: InvitationMessage): Promise<void> {
    this.log(
      {
        to: message.to,
        fullName: message.fullName,
        expiresAt: message.expiresAt.toISOString(),
        ...(appConfig.exposeDevLinks ? { link: message.link } : {}),
      },
      appConfig.exposeDevLinks
        ? '[invitation:log] Undangan aktivasi (dev) — buka link untuk aktivasi'
        : '[invitation:log] Undangan aktivasi dibuat, tetapi belum ada driver pengiriman (set INVITATION_DRIVER)',
    )
  }
}

export function createInvitationSender(): InvitationSender {
  const driver = appConfig.invitationDriver
  if (driver !== 'log') {
    throw new Error(`INVITATION_DRIVER "${driver}" belum didukung. Gunakan "log".`)
  }
  return new LogInvitationSender()
}

let sender: InvitationSender | undefined

/** Instance bersama (lazy). */
export function getInvitationSender(): InvitationSender {
  sender ??= createInvitationSender()
  return sender
}
