import { BookingStatus } from '@prisma/client';
import { SLOT_STEP_MIN, addMinutes, ceilToSlotGrid } from './business-time';

// przedział pracy dnia, już przeliczony na instanty UTC
export interface WorkInterval {
  startUtc: Date;
  endUtc: Date;
}

// cokolwiek, co zajmuje czas pracownika: urlop albo rezerwacja PENDING/CONFIRMED
export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}

// PENDING blokuje slot tak samo jak CONFIRMED (SDD §7) — inaczej firma mogłaby
// dostać dwie kolizyjne rezerwacje na ten sam termin. Definicja „co zajmuje czas
// pracownika” siedzi tu obok BusyInterval, bo reużywa jej też re-walidacja w bookings.
export const BLOCKING_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED];

export interface GenerateSlotsParams {
  intervals: WorkInterval[];
  busy: BusyInterval[];
  durationMin: number;
  notBefore: Date;
}

// [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅ — styk na granicy nie jest kolizją,
// więc rezerwacja 10:00–10:30 nie blokuje slotu startującego 10:30
const overlaps = (aStart: Date, aEnd: Date, b: BusyInterval) =>
  aStart < b.endsAt && aEnd > b.startsAt;

// Czy [start, end) koliduje z czymkolwiek zajętym. Wspólne z re-walidacją w BookingsService,
// żeby „co jest kolizją” było zdefiniowane w jednym miejscu.
export const overlapsAny = (start: Date, end: Date, busy: BusyInterval[]): boolean =>
  busy.some((b) => overlaps(start, end, b));

// Czy [start, end) mieści się w całości w którymś przedziale pracy. generateSlots dostaje to
// z warunku pętli; pojedynczy slot w BookingsService musi sprawdzić to wprost.
export const fitsAnyInterval = (
  start: Date,
  end: Date,
  intervals: WorkInterval[],
): boolean => intervals.some((i) => start >= i.startUtc && end <= i.endUtc);

/**
 * Kroki 5–6 algorytmu z SDD §7: siatka co 15 min w obrębie przedziałów pracy,
 * z odjęciem zajętych przedziałów i odfiltrowaniem przeszłości.
 *
 * Kroczymy **realnym** czasem po granicach już przeliczonych na UTC, więc zmiana czasu
 * obsługuje się sama: w dniu wiosennej zmiany przedział jest realnie o godzinę krótszy
 * (nieistniejąca godzina lokalna nie wygeneruje slotu), a w dniu jesiennej — o godzinę
 * dłuższy (powtórzona godzina daje dodatkowe sloty).
 */
export const generateSlots = ({
  intervals,
  busy,
  durationMin,
  notBefore,
}: GenerateSlotsParams): Date[] => {
  const slots: Date[] = [];

  for (const interval of intervals) {
    // start siatki wyrównany do pełnego kwadransa, nie do startTime przedziału —
    // #25 wymaga, żeby startsAt rezerwacji leżał na siatce 15 min
    let start = ceilToSlotGrid(interval.startUtc);

    // Warunek pętli obsługuje też przedział zdegenerowany (endUtc <= startUtc). Wychodzi taki
    // dla grafiku zawartego w nieistniejącej godzinie lokalnej (02:00–03:00 w dniu wiosennej
    // zmiany czasu): oba końce mapują się na ten sam instant → zero slotów, bez zawieszenia.
    for (
      let end = addMinutes(start, durationMin);
      end <= interval.endUtc;
      start = addMinutes(start, SLOT_STEP_MIN), end = addMinutes(start, durationMin)
    ) {
      if (start < notBefore) {
        continue;
      }
      if (overlapsAny(start, end, busy)) {
        continue;
      }
      slots.push(start);
    }
  }

  // przedziały pracy nie nachodzą na siebie (pilnuje tego WorkingHoursService),
  // więc wystarczy posortować — bez deduplikacji
  return slots.sort((a, b) => a.getTime() - b.getTime());
};
