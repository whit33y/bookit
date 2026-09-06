import { isApiStatus } from '../core/api-client';
import { translate } from '../core/i18n/translate';

/**
 * Reguły wgrywania obrazów po stronie web — wspólne dla wizerunku firmy (#154) i zdjęcia
 * profilowego (#164), tak jak `common/images/image-upload` po stronie API (ADR-0001).
 *
 * Limit i lista formatów są powielone z backendu, bo repo nie ma wspólnej libki kontraktów —
 * ale powielone **raz**: bez tego modułu zmiana limitu wymagałaby edycji w każdej sekcji,
 * która cokolwiek wgrywa.
 *
 * Komunikaty są tu celowo bez rzeczownika z glosariusza („logo firmy", „zdjęcie profilowe"):
 * mówią o pliku, więc pasują do każdego wywołującego. Zdanie o tym, czego nie udało się
 * zapisać, zostaje w kluczach sekcji.
 */

/** Limit z `MAX_IMAGE_BYTES` (apps/api). */
export const MAX_IMAGE_MB = 5;
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;

/** Formaty przyjmowane przez API; `accept` je tylko podpowiada, decyduje backend po magic bytes. */
export const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp';

/**
 * Plik wybrany w `<input type="file">`, albo `null`, gdy okno wyboru zamknięto bez wyboru.
 *
 * Czyści wartość inputu przy okazji: ten sam plik wybrany drugi raz (np. po poprawce
 * w edytorze) nie wywołałby `change`, gdyby wartość została.
 */
export function pickedFile(event: Event): File | null {
  const picker = event.target as HTMLInputElement;
  const file = picker.files?.[0] ?? null;
  picker.value = '';
  return file;
}

/**
 * Komunikat o pliku za dużym, albo `null`, gdy mieści się w limicie.
 *
 * Rozmiar sprawdzamy też po stronie klienta, nie tylko przez 413 z API: nie ma sensu wysyłać
 * kilkudziesięciu megabajtów po to, żeby serwer urwał je na strumieniu.
 */
export function oversizeMessage(file: File): string | null {
  return file.size > MAX_IMAGE_BYTES
    ? translate('imageUpload.error.tooLarge', { max: MAX_IMAGE_MB })
    : null;
}

/**
 * Komunikat dla statusu, którym API odrzuca sam plik, albo `null` dla każdego innego błędu —
 * ten wywołujący opisuje po swojemu, bo tylko on wie, czego nie udało się zapisać.
 */
export function imageRejectionMessage(err: unknown): string | null {
  if (isApiStatus(err, 415)) {
    return translate('imageUpload.error.type');
  }
  if (isApiStatus(err, 413)) {
    return translate('imageUpload.error.tooLarge', { max: MAX_IMAGE_MB });
  }
  if (isApiStatus(err, 422)) {
    return translate('imageUpload.error.unreadable');
  }
  return null;
}
