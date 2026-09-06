import {
  BadRequestException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  acceptUpload,
  isAcceptedImage,
  normalizeImage,
  versionOf,
} from './image-upload';

const bytes = (...values: number[]) => Buffer.from(values);

const source = (format: 'jpeg' | 'png' | 'webp', background = { r: 200, g: 30, b: 90 }) =>
  sharp({ create: { width: 300, height: 100, channels: 3, background } })[format]().toBuffer();

const upload = (buffer: Buffer, mimetype = 'image/png') =>
  ({ buffer, mimetype, size: buffer.length }) as Express.Multer.File;

describe('rozpoznanie formatu po sygnaturze (#153)', () => {
  it('przepuszcza JPEG, PNG i WebP', () => {
    expect(isAcceptedImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(isAcceptedImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(
      isAcceptedImage(Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('WEBP')])),
    ).toBe(true);
  });

  it('odrzuca inne formaty, także takie, które zaczynają się jak RIFF', () => {
    expect(isAcceptedImage(Buffer.from('%PDF-1.7'))).toBe(false);
    expect(isAcceptedImage(Buffer.from('GIF89a....'))).toBe(false);
    // kontener RIFF, ale WAVE — sam prefiks nie wystarczy
    expect(
      isAcceptedImage(Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('WAVE')])),
    ).toBe(false);
  });

  it('nie wywraca się na pliku krótszym niż sygnatura', () => {
    expect(isAcceptedImage(Buffer.alloc(0))).toBe(false);
    expect(isAcceptedImage(bytes(0xff, 0xd8))).toBe(false);
  });
});

describe('bramka wejściowa', () => {
  it('brak pliku to 400', () => {
    expect(() => acceptUpload(undefined)).toThrow(BadRequestException);
    expect(() => acceptUpload(upload(Buffer.alloc(0)))).toThrow(BadRequestException);
  });

  it('plik ponad 5 MB to 413, nawet z poprawną sygnaturą', async () => {
    const png = await source('png');
    const oversized = Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(() => acceptUpload(upload(oversized))).toThrow(PayloadTooLargeException);
  });

  it('obcy format to 415, mimo nagłówka image/png od klienta', () => {
    expect(() => acceptUpload(upload(Buffer.from('%PDF-1.7'), 'image/png'))).toThrow(
      UnsupportedMediaTypeException,
    );
  });
});

describe('normalizacja', () => {
  it('kadruje do zadanych wymiarów i zapisuje WebP niezależnie od wejścia', async () => {
    const processed = await normalizeImage(await source('jpeg'), { width: 512, height: 512 });
    const meta = await sharp(processed).metadata();

    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([512, 512]);
  });

  it('uszkodzona treść przy poprawnej sygnaturze to 422, nie 415', async () => {
    const truncated = (await source('png')).subarray(0, 40);
    await expect(normalizeImage(truncated, { width: 512, height: 512 })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});

describe('wersja treści', () => {
  it('te same bajty dają tę samą wersję, inne — inną', () => {
    expect(versionOf(Buffer.from('abc'))).toBe(versionOf(Buffer.from('abc')));
    expect(versionOf(Buffer.from('abc'))).not.toBe(versionOf(Buffer.from('abd')));
    expect(versionOf(Buffer.from('abc'))).toMatch(/^[0-9a-f]{16}$/);
  });
});
