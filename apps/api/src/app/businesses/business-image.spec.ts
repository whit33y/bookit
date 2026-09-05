import { NotFoundException } from '@nestjs/common';
import { BusinessImageKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { IMAGE_SLOTS, isAcceptedImage, kindFromParam } from './business-image';
import { ParseImageKindPipe } from './parse-image-kind.pipe';

const bytes = (...values: number[]) => Buffer.from(values);

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

describe('definicja slotów (#153)', () => {
  it('opisuje logo i okładkę: segment ścieżki, kolumna z wersją, kadr', () => {
    expect(IMAGE_SLOTS[BusinessImageKind.LOGO]).toEqual({
      param: 'logo',
      versionField: 'logoVersion',
      width: 512,
      height: 512,
    });
    expect(IMAGE_SLOTS[BusinessImageKind.COVER]).toEqual({
      param: 'cover',
      versionField: 'coverVersion',
      width: 1600,
      height: 400,
    });
  });
});

describe('ParseImageKindPipe', () => {
  const pipe = new ParseImageKindPipe();

  it('mapuje segment ścieżki na typ wyliczeniowy w obie strony', () => {
    expect(pipe.transform('logo')).toBe(BusinessImageKind.LOGO);
    expect(pipe.transform('cover')).toBe(BusinessImageKind.COVER);
    expect(IMAGE_SLOTS[pipe.transform('cover')].param).toBe('cover');
    expect(kindFromParam('logo')).toBe(BusinessImageKind.LOGO);
  });

  it('nieznany slot to nieistniejący zasób, nie błąd walidacji', () => {
    expect(kindFromParam('banner')).toBeUndefined();
    expect(() => pipe.transform('LOGO')).toThrow(NotFoundException);
    expect(() => pipe.transform('banner')).toThrow(NotFoundException);
  });
});
