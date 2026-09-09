import { BookingStatus, BusinessStatus } from '@prisma/client';
import { isBusinessAvailable } from '../businesses/public-business';

/**
 * Statusy, z których wolno powtórzyć wizytę (CONTEXT.md → „Ponowna rezerwacja"): zakończona
 * i odwołana przez którąkolwiek ze stron.
 *
 * `DECLINED` nie: firma odrzuciła ten termin, a podsuwanie „spróbuj jeszcze raz" ustawia
 * klienta na drugie odrzucenie. `PENDING` i `CONFIRMED` też nie — wizyta wciąż stoi
 * w kalendarzu, więc powtarzanie jej nie ma sensu.
 */
export const REBOOKABLE_STATUSES: readonly BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED_BY_CLIENT,
  BookingStatus.CANCELLED_BY_BUSINESS,
];

export interface RebookSubject {
  status: BookingStatus;
  /** Pracownik z minionej wizyty — ponowna rezerwacja idzie do tej samej osoby. */
  employeeId: string;
  service: {
    isActive: boolean;
    /** Aktywni pracownicy przypisani dziś do tej usługi. */
    employeeIds: string[];
  };
  business: { isBlocked: boolean; status: BusinessStatus };
}

export interface RebookFlags {
  canRebook: boolean;
  rebookEmployeeId: string | null;
}

/**
 * Czy z tej wizyty da się dziś zrobić ponowną rezerwację i czy trafi ona do tego samego
 * pracownika. Liczone po stronie API, bo front nie ma z czego: „pracownik nadal przypisany
 * do tej usługi" wymagałoby pobrania pracowników każdej usługi z każdej minionej wizyty
 * (ADR-0005).
 *
 * `rebookEmployeeId` jest `null`, gdy pracownik odszedł (`isActive: false`) albo został
 * odpięty od usługi — kreator otwiera się wtedy z wyborem pracownika zamiast z gotowym.
 * Zawsze `null` też przy `canRebook: false`: identyfikator pracownika dla akcji, której
 * i tak nie da się wykonać, tylko kusiłby front do jej pokazania.
 */
export const rebookFlags = ({
  status,
  employeeId,
  service,
  business,
}: RebookSubject): RebookFlags => {
  const canRebook =
    REBOOKABLE_STATUSES.includes(status) &&
    service.isActive &&
    isBusinessAvailable(business);

  return {
    canRebook,
    rebookEmployeeId:
      canRebook && service.employeeIds.includes(employeeId) ? employeeId : null,
  };
};
