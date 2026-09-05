/**
 * Lustro odpowiedzi `GET /businesses/mine` (businessSelect, #15) — tylko pola, których używa
 * panel firmy. Repo nie ma wspólnej libki DTO (patrz `core/api-client.ts`), więc kontrakt jest
 * po stronie web powielony ręcznie.
 *
 * Typ stoi osobno od `settings.ts`, bo tę samą odpowiedź czyta kafelek pulpitu (#135).
 */
export interface Business {
  id: string;
  name: string;
  description: string | null;
  phone: string | null;
  street: string;
  city: string;
  postalCode: string | null;
  lat: number;
  lng: number;
  cancellationHours: number;
  /** Wizerunek firmy (#153): hash treści albo `null`, gdy firma nie ma tego obrazu. Służy też
   *  za cache-buster w adresie obrazka — bajty idą osobną trasą (ADR-0001). */
  logoVersion: string | null;
  coverVersion: string | null;
}
