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

/**
 * Wspólna oprawa maili transakcyjnych: nagłówek, treść, link i stopka. Style inline, bo
 * klienty pocztowe wycinają `<style>` z `<head>`; układ celowo prosty — to powiadomienie,
 * nie newsletter.
 *
 * Szablony różnią się wyłącznie środkiem (tabelka wizyty kontra akapity decyzji), więc to
 * on przychodzi z zewnątrz jako gotowy HTML — już zescapowany przez wołającego, bo tylko on
 * wie, które fragmenty są znacznikami, a które tekstem z formularza.
 */
export const emailShell = (
  heading: string,
  bodyHtml: string,
  cta: string,
  ctaUrl: string,
): string =>
  [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2933;">',
    `<h2 style="font-size:18px;margin:0 0 12px;">${escapeHtml(heading)}</h2>`,
    bodyHtml,
    `<p style="margin:0 0 16px;"><a href="${escapeHtml(ctaUrl)}">${escapeHtml(cta)}</a></p>`,
    '<p style="margin:0;color:#616e7c;">— BookIt</p>',
    '</div>',
  ].join('');

/** Akapit oprawy — jedyny znacznik, którego potrzebują oba szablony poza tabelką. */
export const emailParagraph = (text: string): string =>
  `<p style="margin:0 0 16px;">${escapeHtml(text)}</p>`;
