import { describe, expect, it } from 'vitest';
import { maskAuthor, toReviewAuthor } from './review-author';

describe('maskAuthor', () => {
  it('zwraca imię i inicjał nazwiska', () => {
    expect(maskAuthor({ firstName: 'Anna', lastName: 'Kowalska' })).toBe('Anna K.');
  });

  it('nie gubi polskich znaków w inicjale', () => {
    expect(maskAuthor({ firstName: 'Łukasz', lastName: 'Żółtowski' })).toBe('Łukasz Ż.');
  });

  it('podnosi inicjał do wielkiej litery', () => {
    expect(maskAuthor({ firstName: 'Jan', lastName: 'nowak' })).toBe('Jan N.');
  });

  it.each(['', '   '])('nazwisko %j → samo imię, bez osieroconej kropki', (lastName) => {
    expect(maskAuthor({ firstName: 'Anna', lastName })).toBe('Anna');
  });

  it('przycina białe znaki wokół imienia i nazwiska', () => {
    expect(maskAuthor({ firstName: ' Anna ', lastName: ' Kowalska ' })).toBe('Anna K.');
  });

  it('nigdy nie zwraca pełnego nazwiska', () => {
    expect(maskAuthor({ firstName: 'Anna', lastName: 'Kowalska' })).not.toContain('Kowalska');
  });
});

describe('toReviewAuthor', () => {
  const client = {
    id: 'u1',
    firstName: 'Anna',
    lastName: 'Kowalska',
    avatarVersion: 'abc123',
  };

  it('niesie id i wersję zdjęcia obok zamaskowanego podpisu', () => {
    expect(toReviewAuthor(client)).toEqual({
      id: 'u1',
      name: 'Anna K.',
      avatarVersion: 'abc123',
    });
  });

  it('konto bez zdjęcia → avatarVersion null (front spada na monogram)', () => {
    expect(toReviewAuthor({ ...client, avatarVersion: null })).toMatchObject({
      avatarVersion: null,
    });
  });

  it('nie przepuszcza pełnego nazwiska ani pól spoza kształtu autora', () => {
    const author = toReviewAuthor(client);

    expect(JSON.stringify(author)).not.toContain('Kowalska');
    expect(Object.keys(author).sort()).toEqual(['avatarVersion', 'id', 'name']);
  });
});
