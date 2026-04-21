import nodemailer from 'nodemailer'
import { config } from '../config'

function createTransport() {
  if (!config.SMTP_HOST) {
    // Log-only transport for environments without SMTP configured
    return nodemailer.createTransport({ jsonTransport: true })
  }
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  })
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const resetUrl = `${config.APP_URL}/reset-password?token=${token}`
  const transport = createTransport()
  const info = await transport.sendMail({
    from: config.SMTP_FROM,
    to: email,
    subject: 'Password Reset',
    text: `Click the link below to reset your password (valid 1 hour):\n\n${resetUrl}`,
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. Link expires in 1 hour.</p>`,
  })
  if (!config.SMTP_HOST) {
    console.log('[email] password reset link (no SMTP configured):', resetUrl)
  }
}
