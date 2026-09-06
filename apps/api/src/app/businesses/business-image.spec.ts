import { NotFoundException } from '@nestjs/common';
import { BusinessImageKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { IMAGE_SLOTS, kindFromParam } from './business-image';
import { ParseImageKindPipe } from './parse-image-kind.pipe';

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
