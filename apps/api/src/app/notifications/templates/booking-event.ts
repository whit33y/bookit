import { BookingStatus } from '@prisma/client';

/**
 * Słownik zdarzeń rezerwacji wspólny dla wszystkich kanałów powiadomień: maila (#37)
 * i powiadomień in-app (#54). Kanały renderują różne treści, ale zdarzenia i adresaci
 * są te same — gdyby każdy kanał miał własną tabelę routingu, dodanie zdarzenia trafiałoby
 * w dwa miejsca i cicho rozjechałoby kanały.
 *
 * Poza statusami z maszyny stanów (SDD §7) są dwa własne zdarzenia, bo żadne nie jest
 * przejściem: 'CREATED' — świeżo złożona rezerwacja (PENDING to stan początkowy, nie
 * krawędź), i 'REMINDER' — przypomnienie z crona ~24 h przed wizytą (#38), które statusu
 * w ogóle nie zmienia.
 */
export type BookingEvent = 'CREATED' | 'REMINDER' | BookingStatus;

export type BookingEventRecipient = 'CLIENT' | 'BUSINESS';

/**
 * Kto dostaje powiadomienie przy którym zdarzeniu. Routing trzymamy obok szablonów, żeby
 * NotificationsService nie miał własnego switcha, a dopisanie zdarzenia było zmianą
 * w jednym pliku. `null` = brak powiadomienia; Record po pełnym enumie sprawia, że nowy
 * status w schemacie nie skompiluje się bez świadomej decyzji.
 */
export const BOOKING_EVENT_RECIPIENT: Record<BookingEvent, BookingEventRecipient | null> =
  {
    CREATED: 'BUSINESS',
    // przypomnienie o wizycie idzie do klienta — firma ma wizytę w kalendarzu
    REMINDER: 'CLIENT',
    // Rezerwacja nie wraca do PENDING, a COMPLETED domyka ją cron (#39) — w obu
    // przypadkach powiadomienie o zmianie statusu nie ma adresata.
    [BookingStatus.PENDING]: null,
    [BookingStatus.COMPLETED]: null,
    [BookingStatus.CONFIRMED]: 'CLIENT',
    [BookingStatus.DECLINED]: 'CLIENT',
    [BookingStatus.CANCELLED_BY_BUSINESS]: 'CLIENT',
    // klient odwołał → informujemy firmę, że termin się zwolnił
    [BookingStatus.CANCELLED_BY_CLIENT]: 'BUSINESS',
  };

/** Dane wizyty potrzebne szablonom — podzbiór selecta z NotificationsService. */
export interface BookingEventData {
  startsAt: Date;
  endsAt: Date;
  clientNote: string | null;
  client: { firstName: string; lastName: string; phone: string | null };
  business: {
    name: string;
    // slug publicznego profilu — tam prowadzi CTA po odrzuconej wizycie (wybór nowego terminu)
    slug: string;
    street: string;
    city: string;
    postalCode: string | null;
    phone: string | null;
  };
  service: { name: string; durationMin: number; priceCents: number };
  employee: { name: string };
}
