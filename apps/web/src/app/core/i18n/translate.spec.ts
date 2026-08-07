import { describe, expect, it } from 'vitest';
import { setLocale } from './locale';
import { translate, translatePlural } from './translate';

describe('translate', () => {
  it('oddaje polski tekst dla domyślnego języka', () => {
    expect(translate('nav.logout')).toBe('Wyloguj');
  });

  it('przełącza się na angielski po setLocale', () => {
    setLocale('en');
    expect(translate('nav.logout')).toBe('Sign out');
  });

  it('podstawia parametry w miejsce {nazwa}', () => {
    expect(translate('pagination.page', { page: 3 })).toBe('Strona 3');
  });

  it('podstawia ten sam parametr niezależnie od typu', () => {
    expect(
      translate('rating.stars.label', { value: '4,9', max: 5 }),
    ).toBe('Ocena 4,9 na 5');
  });

  it('zostawia placeholder nietknięty, gdy brakuje parametru', () => {
    expect(translate('pagination.page')).toBe('Strona {page}');
  });
});

describe('translatePlural', () => {
  // pułapka polskiej odmiany: 12–14 kończą się cyfrą 2–4, ale biorą formę „many"
  it.each([
    [1, '1 opinia'],
    [2, '2 opinie'],
    [4, '4 opinie'],
    [5, '5 opinii'],
    [12, '12 opinii'],
    [13, '13 opinii'],
    [14, '14 opinii'],
    [22, '22 opinie'],
    [25, '25 opinii'],
    [0, '0 opinii'],
  ])('po polsku odmienia %i przez liczbę', (count, expected) => {
    expect(translatePlural('rating.reviewCount', count)).toBe(expected);
  });

  it.each([
    [1, '1 review'],
    [2, '2 reviews'],
    [5, '5 reviews'],
    [13, '13 reviews'],
    [0, '0 reviews'],
  ])('po angielsku rozróżnia tylko one/other dla %i', (count, expected) => {
    setLocale('en');
    expect(translatePlural('rating.reviewCount', count)).toBe(expected);
  });

  it('łączy {count} z dodatkowymi parametrami', () => {
    expect(translatePlural('search.resultCount', 3)).toBe('Znaleziono 3 firmy');
  });
});
