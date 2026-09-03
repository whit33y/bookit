/**
 * Zdarzenia zgłoszenia firmy (#143): decyzja administratora, jedyna zmiana stanu zgłoszenia,
 * o której zgłaszający musi się dowiedzieć. Odpowiednik BookingEvent dla drugiej rodziny
 * powiadomień — osobny typ, bo adresat jest tu zawsze ten sam (zgłaszający) i nie ma czego
 * routować: tabela BOOKING_EVENT_RECIPIENT nie miałaby tu żadnej pracy do wykonania.
 *
 * Akceptacji nie da się cofnąć (patrz #143), więc para wartości jest zamknięta — kolejnym
 * zdarzeniem zgłoszenia byłaby dopiero blokada firmy, a ta ma własną oś (`isBlocked`).
 */
export type BusinessApplicationDecision = 'APPROVED' | 'REJECTED';

/** Dane zgłoszenia potrzebne szablonom — podzbiór selecta z NotificationsService. */
export interface BusinessApplicationData {
  name: string;
  /** Powód odrzucenia; przy akceptacji `null` i szablony go nie czytają. */
  rejectionReason: string | null;
  owner: { firstName: string };
}

/**
 * Dokąd prowadzi powiadomienie o decyzji — formularz zgłoszenia, który po #142 pokazuje
 * zgłaszającemu stan jego sprawy (i powód odrzucenia). Ten sam adres przy obu decyzjach:
 * świeżo awansowany OWNER trafia stamtąd do panelu firmy, a odrzucony wypełnia formularz
 * od nowa. Trasa z apps/web/src/app/app.routes.ts — ten sam kompromis co przy deep-linkach
 * powiadomień o rezerwacjach.
 */
export const BUSINESS_APPLICATION_URL = '/create-business';
