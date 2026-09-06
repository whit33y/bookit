import { describe, expect, it } from 'vitest';
import { monogramInitials, personMonogram } from './monogram';

describe('monogramInitials', () => {
  it('bierze pierwsze litery maks. dwóch pierwszych słów', () => {
    expect(monogramInitials('Studio Fryzur Kraków')).toBe('SF');
    expect(monogramInitials('Barber')).toBe('B');
  });

  it('ignoruje nadmiarowe odstępy', () => {
    expect(monogramInitials('  Salon   Piękna  ')).toBe('SP');
  });
});

describe('personMonogram', () => {
  it('bierze literę z imienia i literę z nazwiska', () => {
    expect(personMonogram('Anna', 'Kowalska')).toBe('AK');
  });

  // dwuczłonowe imię nie może zjeść miejsca nazwiska
  it('przy dwuczłonowym imieniu wciąż bierze nazwisko', () => {
    expect(personMonogram('Anna Maria', 'Kowalska')).toBe('AK');
  });

  it('pomija puste pola zamiast zostawiać dziurę', () => {
    expect(personMonogram('Anna', '')).toBe('A');
    expect(personMonogram('', '')).toBe('');
  });
});
