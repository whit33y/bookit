import {
  BadRequestException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import sharp from 'sharp';

/**
 * Wspólna obróbka wgrywanych obrazów: wizerunek firmy (#153) i zdjęcie profilowe (#163)
 * przyjmują dokładnie to samo wejście i zapisują dokładnie ten sam format. Reguły stoją tutaj,
 * a nie w każdym module osobno, żeby „co wolno wgrać" miało jedną odpowiedź — inaczej luka
 * załatana przy firmach zostawałaby otwarta przy kontach.
 *
 * Bajty trafiają do Postgresa, uzasadnienie w ADR-0001.
 */

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

/** Skrót treści obrazu: krótki, bo idzie do URL-a jako cache-buster i do ETagu, a nie do
 *  weryfikacji integralności — 16 znaków heksa wystarczy, żeby dwie wersje się rozjechały. */
export const versionOf = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** Bramka wejściowa: obecność pliku, rozmiar i format po sygnaturze. */
export const acceptUpload = (file?: Express.Multer.File): Buffer => {
  if (!file?.buffer?.length) {
    throw new BadRequestException('Nie przesłano pliku');
  }
  // multer urywa większe żądanie wcześniej; ten warunek trzyma regułę także wtedy,
  // gdy serwis wywoła coś innego niż kontroler z tym interceptorem
  if (file.buffer.length > MAX_IMAGE_BYTES) {
    throw new PayloadTooLargeException('Obraz może mieć najwyżej 5 MB');
  }
  if (!isAcceptedImage(file.buffer)) {
    throw new UnsupportedMediaTypeException('Dozwolone formaty to JPEG, PNG i WebP');
  }
  return file.buffer;
};

/**
 * Kadrowanie do docelowych wymiarów i konwersja na WebP. `sharp` domyślnie nie przepisuje
 * EXIF-u, więc metadane aparatu (w tym GPS) znikają razem z oryginałem — trzymamy tylko wynik.
 */
export const normalizeImage = async (
  bytes: Buffer,
  { width, height }: { width: number; height: number },
): Promise<Buffer> => {
  try {
    return await sharp(bytes)
      .resize({ width, height, fit: 'cover' })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    // sygnatura się zgadzała, ale treść jest ucięta albo uszkodzona — to nie jest
    // „zły typ pliku", więc 422, nie 415
    throw new UnprocessableEntityException('Nie udało się odczytać obrazu');
  }
};

/** Prisma opisuje `Bytes` jako Uint8Array; Buffer z sharpa bywa nad SharedArrayBuffer,
 *  więc przepisujemy widok zamiast rzutować. */
export const toStoredBytes = (processed: Buffer): Uint8Array<ArrayBuffer> =>
  new Uint8Array(processed);
