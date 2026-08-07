import { describe, expect, it, vi } from 'vitest';
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

  // regresja: atrybut ustawiał tylko setLocale, więc po odświeżeniu strony z zapisanym EN
  // dokument zostawał z lang="pl" z index.html. Świeży import modułu odtwarza start aplikacji.
  it('ustawia lang już przy starcie, dla języka odczytanego z localStorage', async () => {
    localStorage.setItem(LOCALE_KEY, 'en');
    document.documentElement.lang = 'pl';

    vi.resetModules();
    const fresh = await import('./locale');

    expect(fresh.currentLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('resetLocale czyści zapis i wraca do polskiego', () => {
    setLocale('en');
    resetLocale();
    expect(localStorage.getItem(LOCALE_KEY)).toBeNull();
    expect(currentLocale()).toBe('pl');
  });
});
