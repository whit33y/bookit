import { BusinessImageKind } from '@prisma/client';

/**
 * Wizerunek firmy (CONTEXT.md) — dwa sloty: logo firmy i okładka profilu. Jedna definicja slotu
 * zamiast czterech map po tym samym typie: segment ścieżki, kolumna z wersją na `Business`
 * i docelowy kadr. Nowy slot dopisuje się tutaj i nigdzie indziej.
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

/** Zapisujemy wyłącznie WebP — niezależnie od tego, co przyszło na wejściu. */
export const STORED_MIME = 'image/webp';

export const WEBP_QUALITY = 80;

/** 5 MB. Ten sam limit ustawiony jest w konfiguracji multera, żeby większe żądanie
 *  urwało się na strumieniu, zamiast wejść w całości do pamięci procesu. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Rozpoznanie formatu po sygnaturze pliku, nie po `Content-Type` z multiparta — nagłówek
 * podaje klient i można w nim napisać cokolwiek. Akceptujemy dokładnie te trzy formaty,
 * które `sharp` i tak umie przerobić na WebP.
 */
export const isAcceptedImage = (bytes: Buffer): boolean =>
  isJpeg(bytes) || isPng(bytes) || isWebp(bytes);

const isJpeg = (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(PNG_SIGNATURE);

// kontener RIFF: 'RIFF' + 4 bajty długości + 'WEBP'
const isWebp = (b: Buffer) =>
  b.length >= 12 &&
  b.subarray(0, 4).toString('ascii') === 'RIFF' &&
  b.subarray(8, 12).toString('ascii') === 'WEBP';
