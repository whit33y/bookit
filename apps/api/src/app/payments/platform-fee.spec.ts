import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLATFORM_FEE_PERCENT,
  parsePlatformFeePercent,
  platformFeeCents,
} from './platform-fee';

describe('platformFeeCents', () => {
  it('liczy procent od kwoty zaliczki', () => {
    expect(platformFeeCents(10_000, 10)).toBe(1000);
  });

  it('stawka 0% → brak prowizji (platforma nie bierze nic)', () => {
    expect(platformFeeCents(10_000, 0)).toBe(0);
  });

  it('stawka 100% → cała zaliczka', () => {
    expect(platformFeeCents(10_000, 100)).toBe(10_000);
  });

  it('zaokrągla w dół, gdy ułamek grosza < 0,5', () => {
    // 10% z 45,51 zł = 455,1 gr
    expect(platformFeeCents(4551, 10)).toBe(455);
  });

  it('zaokrągla w górę, gdy ułamek grosza >= 0,5', () => {
    // 10% z 45,55 zł = 455,5 gr
    expect(platformFeeCents(4555, 10)).toBe(456);
  });

  it('stawka ułamkowa jest dozwolona', () => {
    expect(platformFeeCents(10_000, 2.5)).toBe(250);
  });

  // stawka spoza 0–100 nie przejdzie przez parsePlatformFeePercent, ale gdyby ktoś wywołał
  // helper wprost, prowizja wyższa od zaliczki znaczyłaby, że platforma dopłaca do przelewu
  it('nigdy nie przekracza kwoty zaliczki', () => {
    expect(platformFeeCents(10_000, 150)).toBe(10_000);
  });
});

describe('parsePlatformFeePercent', () => {
  it('brak zmiennej → stawka domyślna', () => {
    expect(parsePlatformFeePercent(undefined)).toBe(
      DEFAULT_PLATFORM_FEE_PERCENT,
    );
  });

  it('pusta wartość traktujemy jak brak (tak wygląda świeży .env)', () => {
    expect(parsePlatformFeePercent('   ')).toBe(DEFAULT_PLATFORM_FEE_PERCENT);
  });

  it.each(['0', '10', '2.5', '100'])('%s → poprawna stawka', (raw) => {
    expect(parsePlatformFeePercent(raw)).toBe(Number(raw));
  });

  it.each(['dziesięć', '10%', 'NaN'])(
    '%s nie jest liczbą → błąd konfiguracji',
    (raw) => {
      expect(() => parsePlatformFeePercent(raw)).toThrow(
        /PLATFORM_FEE_PERCENT/,
      );
    },
  );

  it.each(['-1', '101'])('%s jest poza zakresem → błąd konfiguracji', (raw) => {
    expect(() => parsePlatformFeePercent(raw)).toThrow(/0–100/);
  });
});
