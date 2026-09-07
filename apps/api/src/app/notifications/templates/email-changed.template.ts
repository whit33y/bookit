import { RenderedEmail, emailParagraph, emailPlainText, emailShell } from './email';

const HEADING = 'Adres e-mail Twojego konta został zmieniony';

/**
 * Powiadomienie o zmianie adresu e-mail konta (#167). Idzie na **stary** adres i jest jedyną
 * ochroną przy przejętym koncie: nie ma linku potwierdzającego (ADR-0003), więc dotychczasowy
 * właściciel dowiaduje się z tej wiadomości, że stracił login — i to ostatnia rzecz, jaką
 * dostanie na ten adres.
 *
 * Nowy adres wchodzi w treść, żeby odbiorca poznał własną literówkę, jeśli to on się pomylił.
 * Czysta funkcja jak pozostałe szablony: `appUrl` przychodzi z zewnątrz.
 */
export const renderEmailChangedEmail = (
  firstName: string,
  newEmail: string,
  appUrl: string,
): RenderedEmail => {
  const ctaUrl = `${appUrl}/login`;
  const cta = 'Przejdź do logowania';
  const paragraphs = [
    `Cześć ${firstName},`,
    `adres e-mail Twojego konta w BookIt został zmieniony na ${newEmail}. ` +
      'Od teraz logujesz się nowym adresem, a wszystkie sesje zostały zamknięte.',
    'Jeśli tej zmiany nie zleciłeś, ktoś zna Twoje hasło i przejął konto. ' +
      'Napisz do nas jak najszybciej — na ten adres nie przyjdzie już żadna inna wiadomość ' +
      'o Twoim koncie.',
  ];

  return {
    subject: HEADING,
    text: emailPlainText(HEADING, paragraphs, cta, ctaUrl),
    html: emailShell(HEADING, paragraphs.map(emailParagraph).join(''), cta, ctaUrl),
  };
};
