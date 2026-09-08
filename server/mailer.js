import nodemailer from 'nodemailer';
import { config, devCodesEnabled } from './config.js';

let transporter = null;

if (config.mail.host) {
  transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  });
} else {
  // SMTP не настроен: письма не уходят наружу, а печатаются в консоль сервера.
  transporter = nodemailer.createTransport({ jsonTransport: true });
}

export async function sendMail({ to, subject, text, html }) {
  const message = { from: config.mail.from, to, subject, text, html };
  try {
    const info = await transporter.sendMail(message);
    if (!config.mail.host) {
      console.log(`\n[mail] → ${to}\n[mail] ${subject}\n${text}\n`);
    }
    return info;
  } catch (error) {
    console.error('[mail] ошибка отправки:', error.message);
    throw error;
  }
}

export async function sendOtpEmail({ to, code, ttlMinutes }) {
  const subject = `PromptShare: код подтверждения ${code}`;
  const text = [
    'Здравствуйте!',
    '',
    `Ваш одноразовый код для входа в PromptShare: ${code}`,
    `Код действует ${ttlMinutes} минут.`,
    '',
    'Если вы не запрашивали код — просто проигнорируйте это письмо.',
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px">
      <h2 style="margin:0 0 12px">PromptShare</h2>
      <p style="margin:0 0 16px">Ваш одноразовый код для входа:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:0 0 16px">${code}</p>
      <p style="color:#666;margin:0 0 8px">Код действует ${ttlMinutes} минут.</p>
      <p style="color:#666;margin:0">Если вы не запрашивали код — проигнорируйте это письмо.</p>
    </div>`;
  await sendMail({ to, subject, text, html });
}

export const mailerMode = config.mail.host ? 'smtp' : 'console';
export { devCodesEnabled };
