import { PricePlnPipe } from './price-pln.pipe';

// Intl wstawia spację nierozdzielającą (NBSP/U+202F) przed „zł" — normalizujemy do zwykłej.
const norm = (s: string) => s.replace(/\s/g, ' ');

describe('PricePlnPipe', () => {
  const pipe = new PricePlnPipe();

  it('pełne złote bez groszy', () => {
    expect(norm(pipe.transform(7000))).toBe('70 zł');
  });

  it('niepełne złote z groszami', () => {
    expect(norm(pipe.transform(4550))).toBe('45,50 zł');
  });

  it('zero', () => {
    expect(norm(pipe.transform(0))).toBe('0 zł');
  });
});
