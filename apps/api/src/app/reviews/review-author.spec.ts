import { describe, expect, it } from 'vitest';
import { maskAuthor } from './review-author';

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
