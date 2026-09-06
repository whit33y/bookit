import { BusinessImageKind } from '@prisma/client';

/**
 * Wizerunek firmy (CONTEXT.md) — dwa sloty: logo firmy i okładka profilu. Jedna definicja slotu
 * zamiast czterech map po tym samym typie: segment ścieżki, kolumna z wersją na `Business`
 * i docelowy kadr. Nowy slot dopisuje się tutaj i nigdzie indziej.
 *
 * Reguły wspólne dla wszystkich obrazów (dozwolone formaty, limit, konwersja) siedzą
 * w `common/images/image-upload` — tutaj zostaje tylko to, czym firma różni się od konta.
 *
 * `param` bierze się wprost ze specyfikacji trasy (#153, `kind ∈ logo | cover`) — stąd
 * angielskie „cover" mimo tego, że glosariusz w prozie każe mówić „okładka profilu".
 */
export const IMAGE_SLOTS = {
  // logo jest kwadratowym znakiem przy nazwie, okładka pasem nad nagłówkiem; oba kadrowane
  // `fit: cover`, więc proporcje wejścia nie mają znaczenia
  [BusinessImageKind.LOGO]: {
    param: 'logo',
    versionField: 'logoVersion',
    width: 512,
    height: 512,
  },
  [BusinessImageKind.COVER]: {
    param: 'cover',
    versionField: 'coverVersion',
    width: 1600,
    height: 400,
  },
} as const satisfies Record<
  BusinessImageKind,
  {
    param: string;
    /** Kolumna `Business` z wersją slotu — `null` znaczy „firma nie ma tego obrazu". */
    versionField: 'logoVersion' | 'coverVersion';
    width: number;
    height: number;
  }
>;

const KIND_BY_PARAM: Record<string, BusinessImageKind> = Object.fromEntries(
  Object.entries(IMAGE_SLOTS).map(([kind, slot]) => [slot.param, kind as BusinessImageKind]),
);

/** Segment ścieżki na typ wyliczeniowy; `undefined` dla slotu, którego nie ma. */
export const kindFromParam = (param: string): BusinessImageKind | undefined =>
  KIND_BY_PARAM[param];
