/**
 * Lustro odpowiedzi `GET /businesses/mine` (businessSelect, #15) — tylko pola, których używa
 * panel firmy. Repo nie ma wspólnej libki DTO (patrz `core/api-client.ts`), więc kontrakt jest
 * po stronie web powielony ręcznie.
 *
 * Typ stoi osobno od `settings.ts`, bo tę samą odpowiedź czyta kafelek pulpitu (#135).
 */
export interface Business {
  name: string;
  description: string | null;
  phone: string | null;
  street: string;
  city: string;
  postalCode: string | null;
  lat: number;
  lng: number;
  cancellationHours: number;
}
