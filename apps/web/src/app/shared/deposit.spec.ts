import { describe, expect, it } from 'vitest';
import { DepositFields, depositAmountCents, depositError } from './deposit';

// te same przypadki co apps/api/src/app/payments/deposit.spec.ts — rozjazd lustra
// (inne zaokrąglenie, inny komunikat) ma wywalić CI, nie zdziwić właściciela w panelu
const noDeposit: DepositFields = {
  depositType: null,
  depositValue: null,
  priceCents: 10_000,
};
const percent = (depositValue: number, priceCents = 10_000): DepositFields => ({
  depositType: 'PERCENT',
  depositValue,
  priceCents,
});
const fixed = (depositValue: number, priceCents = 10_000): DepositFields => ({
  depositType: 'FIXED',
  depositValue,
  priceCents,
});

describe('depositAmountCents', () => {
  it('brak zaliczki → null, nie 0 (0 zł to inna informacja niż „bez zaliczki")', () => {
    expect(depositAmountCents(noDeposit)).toBeNull();
  });

  it('FIXED → kwota bez przeliczania', () => {
    expect(depositAmountCents(fixed(3000))).toBe(3000);
  });

  it('PERCENT → procent ceny', () => {
    expect(depositAmountCents(percent(30, 22_000))).toBe(6600);
  });

  it('PERCENT zaokrągla w dół, gdy ułamek grosza < 0,5', () => {
    // 10% z 45,51 zł = 455,1 gr
    expect(depositAmountCents(percent(10, 4551))).toBe(455);
  });

  it('PERCENT zaokrągla w górę, gdy ułamek grosza >= 0,5', () => {
    // 10% z 45,55 zł = 455,5 gr
    expect(depositAmountCents(percent(10, 4555))).toBe(456);
  });

  it('sam typ bez wartości → null', () => {
    expect(
      depositAmountCents({
        depositType: 'FIXED',
        depositValue: null,
        priceCents: 10_000,
      }),
    ).toBeNull();
  });
});

describe('depositError', () => {
  it('oba pola null → brak błędu (usługa bez zaliczki)', () => {
    expect(depositError(noDeposit)).toBeNull();
  });

  it('typ bez wartości → błąd', () => {
    expect(
      depositError({
        depositType: 'PERCENT',
        depositValue: null,
        priceCents: 10_000,
      }),
    ).toMatch(/razem/);
  });

  it('wartość bez typu → błąd', () => {
    expect(
      depositError({ depositType: null, depositValue: 30, priceCents: 10_000 }),
    ).toMatch(/razem/);
  });

  it.each([1, 50, 100])('PERCENT %i%% mieści się w zakresie', (value) => {
    expect(depositError(percent(value))).toBeNull();
  });

  it.each([0, -5, 101, 1000])('PERCENT %i%% poza zakresem → błąd', (value) => {
    expect(depositError(percent(value))).toMatch(/1–100/);
  });

  it('PERCENT zaokrąglający się do 0 gr → błąd (Stripe nie pobierze 0)', () => {
    // 1% z 0,40 zł = 0,4 gr → 0
    expect(depositError(percent(1, 40))).toMatch(/0 gr/);
  });

  it('FIXED równy cenie → brak błędu (przedpłata 100%)', () => {
    expect(depositError(fixed(10_000))).toBeNull();
  });

  it('FIXED wyższy niż cena → błąd', () => {
    expect(depositError(fixed(10_001))).toMatch(/wyższa niż cena/);
  });

  it.each([0, -1])('FIXED %i gr → błąd', (value) => {
    expect(depositError(fixed(value))).toMatch(/większa od zera/);
  });

  it('cena 0 gr z zaliczką FIXED → błąd (nie ma z czego pobrać zaliczki)', () => {
    expect(depositError(fixed(500, 0))).toMatch(/wyższa niż cena/);
  });
});
