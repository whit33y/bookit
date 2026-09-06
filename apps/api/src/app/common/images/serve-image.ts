import { Header, HttpStatus, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { etagMatches } from '../http/etag';

/** Rok — pod danym ETagiem treść już się nie zmieni, a nowa wersja przychodzi do klienta
 *  jako inny cache-buster w query stringu (ADR-0001), więc omija to, co leży w cache. */
export const IMMUTABLE_CACHE = 'max-age=31536000, immutable';

/** Nagłówek cache'ujący publicznego odczytu obrazu — jeden dekorator zamiast literału
 *  przepisywanego przy każdej takiej trasie. */
export const ImmutableImage = () => Header('Cache-Control', IMMUTABLE_CACHE);

/** Każde wgranie to dekodowanie i przeskalowanie do 5 MB przez sharpa — najdroższa rzecz,
 *  jaką zalogowany może wywołać jednym żądaniem. Limit hojny wobec poprawiania obrazka
 *  w ustawieniach, ciasny wobec zapętlonego skryptu. */
export const UPLOADS_PER_MINUTE = { default: { limit: 10, ttl: 60_000 } };

/** Źródło obrazu: wskaźnik z wiersza właściciela osobno od bajtów — obie strony wołane
 *  dopiero wtedy, gdy naprawdę są potrzebne. */
export interface ImageSource {
  /** Wersja widziana przez właściciela obrazu (`Business`, `User`) — tyle wystarczy na 304. */
  findVersion(): Promise<string>;
  findBytes(): Promise<{ mime: string; version: string; bytes: Uint8Array }>;
}

/**
 * Publiczny odczyt obrazu: warunkowe 304 albo bajty z ETagiem. Jedna implementacja dla
 * wizerunku firmy (#153) i zdjęcia profilowego (#163) — trasy różnią się tylko tym, skąd
 * biorą obraz, a nie tym, jak go wydają.
 */
export const serveImage = async (
  res: Response,
  ifNoneMatch: string | undefined,
  source: ImageSource,
): Promise<StreamableFile | undefined> => {
  // wskaźnik od właściciela idzie osobnym, lekkim zapytaniem — przy trafieniu w cache bajty
  // w ogóle nie wychodzą z bazy
  const known = await source.findVersion();
  if (etagMatches(ifNoneMatch, `"${known}"`)) {
    res.setHeader('ETag', `"${known}"`);
    res.status(HttpStatus.NOT_MODIFIED);
    return undefined;
  }

  // ETag odpowiedzi z treścią bierze się z wiersza z bajtami, nie ze wskaźnika: równoległe
  // wgranie między tymi zapytaniami inaczej wystawiłoby stare bajty pod nową wersją,
  // a `immutable` utrwaliłoby tę pomyłkę w cache klienta na rok
  const image = await source.findBytes();
  res.setHeader('ETag', `"${image.version}"`);
  return new StreamableFile(Buffer.from(image.bytes), { type: image.mime });
};
