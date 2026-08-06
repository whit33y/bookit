import { describe, expect, it } from 'vitest';
import { currentLocale, localeTag, resetLocale, setLocale } from './locale';

const LOCALE_KEY = 'bookit.locale';

describe('locale', () => {
  it('startuje na polskim, gdy nic nie zapisano', () => {
    expect(currentLocale()).toBe('pl');
    expect(localeTag()).toBe('pl-PL');
  });

  it('zapisuje wybór w localStorage pod kluczem z prefiksem bookit', () => {
    setLocale('en');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('en');
    expect(currentLocale()).toBe('en');
    expect(localeTag()).toBe('en-GB');
  });

  it('ustawia atrybut lang na <html> (WCAG 3.1.1)', () => {
    setLocale('en');
    expect(document.documentElement.lang).toBe('en');
    setLocale('pl');
    expect(document.documentElement.lang).toBe('pl');
  });

  it('resetLocale czyści zapis i wraca do polskiego', () => {
    setLocale('en');
    resetLocale();
    expect(localStorage.getItem(LOCALE_KEY)).toBeNull();
    expect(currentLocale()).toBe('pl');
  });
});
