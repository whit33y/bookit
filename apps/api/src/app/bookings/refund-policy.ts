import { BookingStatus } from '@prisma/client';

/**
 * Co dzieje się z **opłaconą** zaliczką, gdy rezerwacja zmienia status (#52) — czysta funkcja
 * bez PrismaService i bez Nesta, tak jak cancellation-policy.ts obok.
 *
 * Polityka zwrotów jest tu funkcją polityki odwołań, a nie osobnym zestawem progów: to samo
 * `withinWindow`, które decyduje, czy klient w ogóle może odwołać, decyduje też, czy dostanie
 * pieniądze z powrotem. Dzięki temu nie ma drugiego miejsca, w którym „termin" mógłby znaczyć
 * co innego.
 */

export type DepositOutcome =
  /** pełny zwrot do klienta, prowizja platformy schodzi do zera */
  | 'REFUND'
  /** zaliczka zostaje u firmy jako rekompensata za nieobsadzony termin */
  | 'FORFEIT'
  /** przejście nie rusza pieniędzy (np. potwierdzenie albo zakończenie wizyty) */
  | 'NONE';

/**
 * `withinWindow` to wynik `canClientCancel` policzony **przed** zapisem statusu — po zapisie
 * rezerwacja jest już w stanie terminalnym i ta sama funkcja zwróciłaby false niezależnie
 * od terminu.
 *
 * DECLINED jest po stronie zwrotu razem z CANCELLED_BY_BUSINESS: dla klienta to ta sama
 * sytuacja — wizyta nie dojdzie do skutku nie z jego winy — a różnica między „nie przyjmujemy"
 * a „przyjęliśmy, ale odwołujemy" dotyczy komunikatu, nie pieniędzy.
 */
export const depositOutcome = (
  to: BookingStatus,
  withinWindow: boolean,
): DepositOutcome => {
  if (
    to === BookingStatus.CANCELLED_BY_BUSINESS ||
    to === BookingStatus.DECLINED
  ) {
    return 'REFUND';
  }
  if (to === BookingStatus.CANCELLED_BY_CLIENT) {
    return withinWindow ? 'REFUND' : 'FORFEIT';
  }
  // CONFIRMED i COMPLETED: wizyta się odbywa albo odbyła, zaliczka zostaje rozliczona
  // z firmą poza systemem
  return 'NONE';
};
