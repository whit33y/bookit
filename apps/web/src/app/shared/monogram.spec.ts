import { describe, expect, it } from 'vitest';
import { monogramInitials, personMonogram, signatureMonogram } from './monogram';

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

describe('signatureMonogram', () => {
  it('bierze literę imienia i literę inicjału nazwiska', () => {
    expect(signatureMonogram('Anna K.')).toBe('AK');
  });

  // ten sam wynik, co personMonogram('Anna Maria', 'Kowalska') — dwuczłonowe imię nie może
  // zjeść miejsca nazwiska, inaczej ta osoba miałaby inny monogram przy recenzji niż w menu
  it('przy dwuczłonowym imieniu wciąż bierze inicjał nazwiska', () => {
    expect(signatureMonogram('Anna Maria K.')).toBe('AK');
    expect(signatureMonogram('Anna Maria K.')).toBe(personMonogram('Anna Maria', 'Kowalska'));
  });

  it('podpis bez nazwiska (konto z samym imieniem) → jedna litera', () => {
    expect(signatureMonogram('Anna')).toBe('A');
    expect(signatureMonogram('   ')).toBe('');
  });
});
