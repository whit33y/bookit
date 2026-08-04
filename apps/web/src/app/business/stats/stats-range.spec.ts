import {
  firstOfMonth,
  formatMinutes,
  isStatsPreset,
  lastOfMonth,
  rangeForPreset,
  rangeLabel,
  shiftAnchor,
} from './stats-range';

describe('rangeForPreset', () => {
  it('tydzień: poniedziałek–niedziela zawierające datę', () => {
    // 2026-08-05 to środa
    expect(rangeForPreset('week', '2026-08-05')).toEqual({
      from: '2026-08-03',
      to: '2026-08-09',
    });
  });

  it('tydzień z niedzieli nie przeskakuje na kolejny', () => {
    expect(rangeForPreset('week', '2026-08-09')).toEqual({
      from: '2026-08-03',
      to: '2026-08-09',
    });
  });

  it('miesiąc: pierwszy i ostatni dzień', () => {
    expect(rangeForPreset('month', '2026-08-17')).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('luty roku przestępnego ma 29 dni', () => {
    expect(lastOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(firstOfMonth('2028-02-10')).toBe('2028-02-01');
  });
});

describe('shiftAnchor', () => {
  it('tydzień: ±7 dni od poniedziałku', () => {
    expect(shiftAnchor('week', '2026-08-05', -1)).toBe('2026-07-27');
    expect(shiftAnchor('week', '2026-08-05', 1)).toBe('2026-08-10');
  });

  it('miesiąc: kotwica na pierwszym dniu, więc 31 marca nie wraca do marca', () => {
    expect(shiftAnchor('month', '2026-03-31', -1)).toBe('2026-02-01');
    expect(rangeForPreset('month', shiftAnchor('month', '2026-03-31', -1))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('miesiąc przez granicę roku', () => {
    expect(shiftAnchor('month', '2026-01-15', -1)).toBe('2025-12-01');
    expect(shiftAnchor('month', '2026-12-15', 1)).toBe('2027-01-01');
  });

  it('przewijanie tygodni przez zmianę czasu nie gubi doby', () => {
    // 25 października 2026 — powrót z czasu letniego; arytmetyka po UTC
    expect(shiftAnchor('week', '2026-10-20', 1)).toBe('2026-10-26');
  });
});

describe('rangeLabel', () => {
  it('miesiąc: nazwa miesiąca i rok', () => {
    expect(rangeLabel('month', { from: '2026-08-01', to: '2026-08-31' })).toBe(
      'sierpień 2026',
    );
  });

  it('tydzień i zakres własny: obie granice', () => {
    expect(rangeLabel('week', { from: '2026-08-03', to: '2026-08-09' })).toContain('3 sie');
    expect(rangeLabel('custom', { from: '2026-08-03', to: '2026-09-01' })).toContain(
      '1 wrz',
    );
  });
});

describe('isStatsPreset', () => {
  it('przepuszcza tylko znane presety', () => {
    expect(isStatsPreset('week')).toBe(true);
    expect(isStatsPreset('custom')).toBe(true);
    expect(isStatsPreset('rok')).toBe(false);
  });
});

describe('formatMinutes', () => {
  it('godziny i minuty', () => {
    expect(formatMinutes(390)).toBe('6 h 30 min');
  });

  it('pełne godziny bez minut', () => {
    expect(formatMinutes(480)).toBe('8 h');
  });

  it('poniżej godziny same minuty', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(0)).toBe('0 min');
  });
});
