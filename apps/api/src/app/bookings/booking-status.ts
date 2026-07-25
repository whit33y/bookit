import { BookingStatus } from '@prisma/client';

// Maszyna stanów rezerwacji z SDD §7 — jedno miejsce, w którym żyje diagram.
// #26 (confirm/decline) używa dziś tylko krawędzi wychodzących z PENDING; reszta
// jest tu, żeby #27 (odwołania) i #39 (cron CONFIRMED → COMPLETED) reużyły te same
// reguły zamiast pisać własne if-y. Zależy wyłącznie od enuma, nie od PrismaService
// — importuje się bez ciągnięcia całego modułu bookings.
export const ALLOWED_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  [BookingStatus.PENDING]: [
    BookingStatus.CONFIRMED,
    BookingStatus.DECLINED,
    BookingStatus.CANCELLED_BY_CLIENT,
  ],
  [BookingStatus.CONFIRMED]: [
    BookingStatus.CANCELLED_BY_CLIENT,
    BookingStatus.CANCELLED_BY_BUSINESS,
    BookingStatus.COMPLETED,
  ],
  // stany terminalne — z nich nie ma wyjścia
  [BookingStatus.DECLINED]: [],
  [BookingStatus.CANCELLED_BY_CLIENT]: [],
  [BookingStatus.CANCELLED_BY_BUSINESS]: [],
  [BookingStatus.COMPLETED]: [],
};

// Przejście „w miejscu" (from === to) nie jest krawędzią diagramu, więc jest zabronione —
// powtórne potwierdzenie tej samej rezerwacji ma dać 409, nie ciche 200.
export const canTransition = (from: BookingStatus, to: BookingStatus): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to);

// Etykiety do komunikatów błędów (UI po polsku) — trzymane obok maszyny stanów,
// żeby #27 nie budowało drugiego słownika.
export const STATUS_LABELS: Record<BookingStatus, string> = {
  [BookingStatus.PENDING]: 'oczekująca',
  [BookingStatus.CONFIRMED]: 'potwierdzona',
  [BookingStatus.DECLINED]: 'odrzucona',
  [BookingStatus.CANCELLED_BY_CLIENT]: 'odwołana przez klienta',
  [BookingStatus.CANCELLED_BY_BUSINESS]: 'odwołana przez firmę',
  [BookingStatus.COMPLETED]: 'zakończona',
};
