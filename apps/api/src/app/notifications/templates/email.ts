/** Gotowa treść wiadomości — to, co szablon oddaje MailService (bez adresata). */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Dane trafiają do HTML-a, a nazwa firmy, imię czy notatka klienta to wolny tekst
 * z formularza — bez escapowania „<" zepsułoby układ wiadomości.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
