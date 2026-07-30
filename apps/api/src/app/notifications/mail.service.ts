import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  /** wersja tekstowa — fallback dla klientów bez HTML, zawsze wymagana */
  text: string;
  html: string;
}

/**
 * Transport SMTP modułu notifications — jedyne miejsce, które wie o nodemailerze.
 * Treści powstają w templates/, ten serwis ich nie dotyka: dzięki temu szablony testuje
 * się bez SMTP, a transport bez szablonów. Wewnętrzny provider modułu (bez exports),
 * żeby wysyłka szła wyłącznie przez NotificationsService.
 */
@Injectable()
export class MailService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.transporter = createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port: Number(config.getOrThrow<string>('SMTP_PORT')),
    });
    this.from = config.getOrThrow<string>('MAIL_FROM');
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}
