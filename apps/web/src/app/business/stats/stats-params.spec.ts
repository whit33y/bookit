import { convertToParamMap } from '@angular/router';
import { buildStatsQueryParams, readStatsParams, statsPath } from './stats-params';

// 2026-08-05 to środa: tydzień pn–nd = 3–9 sierpnia, miesiąc = 1–31 sierpnia
const TODAY = '2026-08-05';

const read = (params: Record<string, string>) =>
  readStatsParams(convertToParamMap(params), TODAY);

describe('readStatsParams', () => {
  it('pusty adres → bieżący miesiąc', () => {
    expect(read({})).toEqual({
      preset: 'month',
      range: { from: '2026-08-01', to: '2026-08-31' },
    });
  });

  it('preset bez zakresu → zakres wyliczony z dzisiejszej daty', () => {
    expect(read({ preset: 'week' })).toEqual({
      preset: 'week',
      range: { from: '2026-08-03', to: '2026-08-09' },
    });
  });

  it('pełny stan z adresu wraca nietknięty (link odtwarza okres)', () => {
    expect(read({ preset: 'custom', from: '2026-07-10', to: '2026-09-02' })).toEqual({
      preset: 'custom',
      range: { from: '2026-07-10', to: '2026-09-02' },
    });
  });

  it('zakres jednodniowy jest poprawny (from = to)', () => {
    expect(read({ preset: 'custom', from: '2026-08-04', to: '2026-08-04' }).range).toEqual({
      from: '2026-08-04',
      to: '2026-08-04',
    });
  });

  it('nieznany preset ustępuje miesiącowi, ale zakres z adresu zostaje', () => {
    expect(read({ preset: 'rok', from: '2026-07-10', to: '2026-07-20' })).toEqual({
      preset: 'month',
      range: { from: '2026-07-10', to: '2026-07-20' },
    });
  });

  it('odwrócony zakres nie leci do API — wraca domyślny miesiąc', () => {
    expect(read({ preset: 'custom', from: '2026-09-01', to: '2026-08-01' })).toEqual({
      preset: 'month',
      range: { from: '2026-08-01', to: '2026-08-31' },
    });
  });

  it('data w złym formacie albo nieistniejąca w kalendarzu → domyślny zakres presetu', () => {
    expect(read({ preset: 'week', from: '1.07.2026', to: '2026-07-20' }).range).toEqual({
      from: '2026-08-03',
      to: '2026-08-09',
    });
    expect(read({ preset: 'week', from: '2026-02-30', to: '2026-03-05' }).range).toEqual({
      from: '2026-08-03',
      to: '2026-08-09',
    });
  });

  it('sam from bez to jest ignorowany', () => {
    expect(read({ from: '2026-07-10' }).range).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('„własny" bez poprawnego zakresu nie zostaje wybrany (przełącznik nie kłamie)', () => {
    expect(read({ preset: 'custom' }).preset).toBe('month');
  });
});

describe('buildStatsQueryParams', () => {
  it('zapisuje pełny stan, żeby odświeżenie strony pokazało ten sam okres', () => {
    expect(
      buildStatsQueryParams({
        preset: 'week',
        range: { from: '2026-08-03', to: '2026-08-09' },
      }),
    ).toEqual({ preset: 'week', from: '2026-08-03', to: '2026-08-09' });
  });

  it('to, co zapisane, daje się odczytać z powrotem (round-trip)', () => {
    const params = { preset: 'custom', range: { from: '2026-07-10', to: '2026-09-02' } } as const;

    expect(readStatsParams(convertToParamMap(buildStatsQueryParams(params)), TODAY)).toEqual(
      params,
    );
  });
});

describe('statsPath', () => {
  it('wysyła do API tylko from/to — ValidationPipe odrzuca nieznane klucze', () => {
    expect(statsPath({ from: '2026-08-01', to: '2026-08-31' })).toBe(
      '/businesses/mine/stats?from=2026-08-01&to=2026-08-31',
    );
  });
});
