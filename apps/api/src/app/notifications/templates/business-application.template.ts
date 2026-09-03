import {
  BUSINESS_APPLICATION_URL,
  BusinessApplicationData,
  BusinessApplicationDecision,
} from './business-application';
import { RenderedEmail, emailParagraph, emailShell } from './email';

// Ta sama oprawa co w mailach o rezerwacjach, ale bez tabelki: decyzja o zgłoszeniu nie ma
// pól do wyliczenia — liczy się rozstrzygnięcie i, przy odrzuceniu, powód.
const renderHtml = (
  heading: string,
  paragraphs: string[],
  cta: string,
  ctaUrl: string,
): string => emailShell(heading, paragraphs.map(emailParagraph).join(''), cta, ctaUrl);

const renderText = (
  heading: string,
  paragraphs: string[],
  cta: string,
  ctaUrl: string,
): string => [heading, '', ...paragraphs, '', `${cta}: ${ctaUrl}`, '', '— BookIt'].join('\n');

/**
 * Mail o decyzji administratora w sprawie zgłoszenia firmy (#143). Czysta funkcja, jak
 * renderBookingEmail: `appUrl` przychodzi z zewnątrz, bo konfiguracja należy do serwisu.
 *
 * Nazwa firmy nigdy nie stoi przed czasownikiem (jej rodzaj gramatyczny nie jest znany) —
 * ta sama zasada co w szablonach rezerwacji.
 */
export const renderBusinessApplicationEmail = (
  decision: BusinessApplicationDecision,
  data: BusinessApplicationData,
  appUrl: string,
): RenderedEmail => {
  // Ten sam adres co w powiadomieniu in-app: obie drogi z jednego zdarzenia mają prowadzić
  // w to samo miejsce, inaczej klik z dzwoneczka i klik z maila kończą się gdzie indziej.
  const ctaUrl = `${appUrl}${BUSINESS_APPLICATION_URL}`;
  const build = (
    subject: string,
    heading: string,
    paragraphs: string[],
    cta: string,
  ): RenderedEmail => ({
    subject,
    text: renderText(heading, paragraphs, cta, ctaUrl),
    html: renderHtml(heading, paragraphs, cta, ctaUrl),
  });

  if (decision === 'APPROVED') {
    return build(
      `Zgłoszenie firmy zaakceptowane: ${data.name}`,
      'Zgłoszenie firmy zaakceptowane',
      [
        `Cześć ${data.owner.firstName}, firma ${data.name} została wpuszczona na BookIt.`,
        'Twoje konto ma już panel firmy — dodaj usługi i pracowników, żeby klienci mogli rezerwować terminy.',
      ],
      'Zobacz swoje zgłoszenie',
    );
  }

  return build(
    `Zgłoszenie firmy odrzucone: ${data.name}`,
    'Zgłoszenie firmy odrzucone',
    [
      `Cześć ${data.owner.firstName}, zgłoszenie firmy ${data.name} nie zostało przyjęte.`,
      // Powód niesie sam mail, a nie tylko formularz: bez niego zgłaszający nie wie,
      // co poprawić, a to jedyna treść, dla której to powiadomienie w ogóle powstaje.
      `Powód: ${data.rejectionReason ?? 'nie podano'}`,
      'Możesz poprawić dane i zgłosić firmę jeszcze raz.',
    ],
    'Popraw zgłoszenie',
  );
};
