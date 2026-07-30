import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMIT, MAX_LIMIT, MAX_PAGE, parsePagination } from './pagination';

describe('parsePagination', () => {
  it('bez parametrów → pierwsza strona i domyślny limit', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: DEFAULT_LIMIT, skip: 0 });
  });

  it('przelicza page/limit na skip', () => {
    expect(parsePagination({ page: '3', limit: '5' })).toEqual({ page: 3, limit: 5, skip: 10 });
  });

  it('respektuje własny defaultLimit i maxLimit', () => {
    expect(parsePagination({}, { defaultLimit: 50 }).limit).toBe(50);
    expect(() => parsePagination({ limit: '30' }, { maxLimit: 25 })).toThrowError(
      'limit poza zakresem 1..25',
    );
  });

  it('page poza zakresem → 400', () => {
    expect(() => parsePagination({ page: '0' })).toThrowError(`page poza zakresem 1..${MAX_PAGE}`);
    expect(() => parsePagination({ page: String(MAX_PAGE + 1) })).toThrowError(
      `page poza zakresem 1..${MAX_PAGE}`,
    );
  });

  // DTO dopuszcza dowolnie długi ciąg cyfr — Number() przepełnia się do Infinity, MAX_PAGE to łapie
  it('astronomiczny page (Infinity po Number()) → 400 zamiast pustej listy', () => {
    expect(() => parsePagination({ page: '9'.repeat(400) })).toThrowError(
      `page poza zakresem 1..${MAX_PAGE}`,
    );
  });

  // porównania z NaN są zawsze false — bez Number.isInteger takie query przeszłoby do Prismy jako skip: NaN
  it('nieliczbowe page/limit → 400, nie NaN w zapytaniu', () => {
    expect(() => parsePagination({ page: 'abc' })).toThrowError(`page poza zakresem 1..${MAX_PAGE}`);
    expect(() => parsePagination({ limit: '' })).toThrowError(`limit poza zakresem 1..${MAX_LIMIT}`);
    expect(() => parsePagination({ limit: '1.5' })).toThrowError(
      `limit poza zakresem 1..${MAX_LIMIT}`,
    );
  });

  it('limit poza zakresem → 400', () => {
    expect(() => parsePagination({ limit: '0' })).toThrowError(`limit poza zakresem 1..${MAX_LIMIT}`);
    expect(() => parsePagination({ limit: String(MAX_LIMIT + 1) })).toThrowError(
      `limit poza zakresem 1..${MAX_LIMIT}`,
    );
  });
});
