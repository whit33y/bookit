import { BookingStatus } from '@prisma/client';
import { formatDateTimeRange, formatDuration, formatPrice } from '../format';
import { BookingEvent, BookingEventData } from './booking-event';
import { RenderedEmail, escapeHtml } from './email';

type Row = [label: string, value: string];

const fullAddress = ({ street, city, postalCode }: BookingEventData['business']): string =>
  postalCode ? `${street}, ${postalCode} ${city}` : `${street}, ${city}`;

// wspólny opis wizyty — te same wiersze w obu wersjach, żeby treści nie rozjechały się
// między HTML a fallbackiem tekstowym
const bookingRows = (data: BookingEventData): Row[] => [
  ['Usługa', `${data.service.name} (${formatDuration(data.service.durationMin)})`],
  ['Pracownik', data.employee.name],
  ['Termin', formatDateTimeRange(data.startsAt, data.endsAt)],
  ['Cena', formatPrice(data.service.priceCents)],
];

const clientRows = (data: BookingEventData): Row[] => [
  ...bookingRows(data),
  ['Firma', data.business.name],
  ['Adres', fullAddress(data.business)],
  ...(data.business.phone ? ([['Telefon', data.business.phone]] as Row[]) : []),
];

const businessRows = (data: BookingEventData): Row[] => [
  ...bookingRows(data),
  ['Klient', `${data.client.firstName} ${data.client.lastName}`],
  ...(data.client.phone ? ([['Telefon', data.client.phone]] as Row[]) : []),
  ...(data.clientNote ? ([['Notatka', data.clientNote]] as Row[]) : []),
];

const renderText = (heading: string, intro: string, rows: Row[], cta: string): string =>
  [
    heading,
    '',
    intro,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    cta,
    '',
    '— BookIt',
  ].join('\n');

// Style inline, bo klienty pocztowe wycinają <style> z <head>; układ celowo prosty
// (nagłówek, tabelka, link) — to powiadomienie transakcyjne, nie newsletter.
const renderHtml = (
  heading: string,
  intro: string,
  rows: Row[],
  cta: string,
  ctaUrl: string,
): string =>
  [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2933;">',
    `<h2 style="font-size:18px;margin:0 0 12px;">${escapeHtml(heading)}</h2>`,
    `<p style="margin:0 0 16px;">${escapeHtml(intro)}</p>`,
    '<table style="border-collapse:collapse;margin-bottom:16px;">',
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#616e7c;">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`,
    ),
    '</table>',
    `<p style="margin:0 0 16px;"><a href="${escapeHtml(ctaUrl)}">${escapeHtml(cta)}</a></p>`,
    '<p style="margin:0;color:#616e7c;">— BookIt</p>',
    '</div>',
  ].join('');

/**
 * Treść maila dla zdarzenia rezerwacji albo `null`, gdy zdarzenie nie ma adresata
 * (patrz BOOKING_EVENT_RECIPIENT). Czysta funkcja: żadnego Nesta, Prismy ani SMTP —
 * `appUrl` przychodzi z zewnątrz, bo konfiguracja należy do serwisu.
 */
export const renderBookingEmail = (
  event: BookingEvent,
  data: BookingEventData,
  appUrl: string,
): RenderedEmail | null => {
  const when = formatDateTimeRange(data.startsAt, data.endsAt);
  const clientName = `${data.client.firstName} ${data.client.lastName}`;
  const build = (
    subject: string,
    heading: string,
    intro: string,
    rows: Row[],
    cta: string,
    ctaPath: string,
  ): RenderedEmail => {
    const ctaUrl = `${appUrl}${ctaPath}`;
    return {
      subject,
      text: renderText(heading, intro, rows, `${cta}: ${ctaUrl}`),
      html: renderHtml(heading, intro, rows, cta, ctaUrl),
    };
  };

  switch (event) {
    case 'CREATED':
      return build(
        `Nowa rezerwacja: ${data.service.name} — ${when}`,
        'Nowa rezerwacja czeka na decyzję',
        `Klient ${clientName} zarezerwował termin w firmie ${data.business.name}. ` +
          `Potwierdź lub odrzuć rezerwację w panelu firmy.`,
        businessRows(data),
        'Przejdź do oczekujących rezerwacji',
        '/business/pending',
      );

    case 'REMINDER':
      return build(
        `Przypomnienie o wizycie: ${data.business.name} — ${when}`,
        'Przypomnienie o wizycie',
        // Konkretny termin, nie „jutrzejsza wizyta": okno crona nadgania rezerwacje
        // potwierdzone późno, więc mail może wyjść i tego samego dnia.
        //
        // Bez „odwołaj wizytę w BookIt": przypomnienie wychodzi ~24 h przed startem, a przy
        // domyślnym cancellationHours = 24 okno odwołania mija właśnie teraz (canClientCancel
        // ma ostrą nierówność) — CTA obiecywałby coś, co skończy się 409. Kontakt do firmy
        // klient ma w wierszach niżej.
        `Cześć ${data.client.firstName}, przypominamy o wizycie w firmie ` +
          `${data.business.name} — ${when}. Jeśli nie możesz przyjść, skontaktuj się z firmą.`,
        clientRows(data),
        'Zobacz swoje wizyty',
        '/client',
      );

    case BookingStatus.CONFIRMED:
      return build(
        `Rezerwacja potwierdzona: ${data.business.name} — ${when}`,
        'Rezerwacja potwierdzona',
        `Cześć ${data.client.firstName}, Twoja wizyta w firmie ${data.business.name} ` +
          `została potwierdzona. Do zobaczenia!`,
        clientRows(data),
        'Zobacz swoje wizyty',
        '/client',
      );

    case BookingStatus.DECLINED:
      return build(
        `Rezerwacja odrzucona: ${data.business.name} — ${when}`,
        'Rezerwacja odrzucona',
        `Cześć ${data.client.firstName}, firma ${data.business.name} nie może przyjąć ` +
          `tej rezerwacji. Możesz wybrać inny termin.`,
        clientRows(data),
        // profil firmy, a nie „moje wizyty" — z listy własnych rezerwacji nie da się
        // wybrać nowego terminu, a etykieta CTA to obiecuje
        'Wybierz inny termin',
        `/${data.business.slug}`,
      );

    case BookingStatus.CANCELLED_BY_BUSINESS:
      return build(
        `Rezerwacja odwołana: ${data.business.name} — ${when}`,
        'Rezerwacja odwołana przez firmę',
        `Cześć ${data.client.firstName}, firma ${data.business.name} odwołała Twoją wizytę. ` +
          `Przepraszamy za kłopot — możesz zarezerwować inny termin.`,
        clientRows(data),
        'Zobacz swoje wizyty',
        '/client',
      );

    case BookingStatus.CANCELLED_BY_CLIENT:
      return build(
        `Klient odwołał rezerwację: ${data.service.name} — ${when}`,
        'Klient odwołał rezerwację',
        `Klient ${clientName} odwołał wizytę. Termin jest znowu wolny.`,
        businessRows(data),
        'Zobacz kalendarz',
        '/business/calendar',
      );

    default:
      return null;
  }
};
