import { convertToParamMap } from '@angular/router';
import {
  MAX_PAGE,
  MAX_QUERY_LENGTH,
  adminListPath,
  buildListQuery,
  readListParams,
} from './admin-list-params';

const queryFor = (params: Record<string, string>) =>
  buildListQuery(readListParams(convertToParamMap(params)));

describe('readListParams + buildListQuery', () => {
  it('pomija puste q zamiast wysyłać q= (backend odrzuca je jako @IsNotEmpty)', () => {
    expect(queryFor({ q: '   ' })).toBe('');
    expect(queryFor({})).toBe('');
  });

  it('przekazuje frazę zakodowaną, bez otaczających spacji', () => {
    expect(queryFor({ q: '  Salon & Spa  ' })).toBe('q=Salon+%26+Spa');
  });

  it('przycina frazę do limitu backendu, zamiast wywołać 400', () => {
    const params = readListParams(
      convertToParamMap({ q: 'a'.repeat(MAX_QUERY_LENGTH + 50) }),
    );
    expect(params.q).toHaveLength(MAX_QUERY_LENGTH);
  });

  it('przepuszcza blocked tylko dla literałów true/false', () => {
    expect(queryFor({ blocked: 'true' })).toBe('blocked=true');
    expect(queryFor({ blocked: 'false' })).toBe('blocked=false');
    expect(queryFor({ blocked: 'yes' })).toBe('');
    expect(queryFor({ blocked: '1' })).toBe('');
  });

  it('ignoruje page, które nie jest dodatnią liczbą całkowitą', () => {
    expect(queryFor({ page: 'abc' })).toBe('');
    expect(queryFor({ page: '0' })).toBe('');
    expect(queryFor({ page: '-3' })).toBe('');
    expect(queryFor({ page: '1.5' })).toBe('');
  });

  it('traktuje stronę 1 jak brak parametru — to i tak domyślna wartość backendu', () => {
    expect(queryFor({ page: '1' })).toBe('');
    expect(queryFor({ page: '3' })).toBe('page=3');
  });

  it('pomija stronę powyżej MAX_PAGE, zamiast wywołać 400 „page poza zakresem"', () => {
    expect(queryFor({ page: String(MAX_PAGE) })).toBe(`page=${MAX_PAGE}`);
    expect(queryFor({ page: String(MAX_PAGE + 1) })).toBe('');
    expect(queryFor({ page: '999999999' })).toBe('');
  });

  it('nie przepuszcza nieznanych parametrów z URL — backend odrzuca je kodem 400', () => {
    expect(queryFor({ q: 'salon', sort: 'name', limit: '999', foo: 'bar' })).toBe(
      'q=salon',
    );
  });

  it('składa komplet filtrów w jeden querystring', () => {
    expect(queryFor({ q: 'salon', blocked: 'true', page: '2' })).toBe(
      'q=salon&blocked=true&page=2',
    );
  });

  it('buduje ścieżkę bez znaku zapytania, gdy nie ma filtrów', () => {
    const empty = readListParams(convertToParamMap({}));
    expect(adminListPath('businesses', empty)).toBe('/admin/businesses');

    const filtered = readListParams(convertToParamMap({ q: 'salon' }));
    expect(adminListPath('users', filtered)).toBe('/admin/users?q=salon');
  });
});
