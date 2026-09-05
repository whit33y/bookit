import { describe, expect, it } from 'vitest';
import { etagMatches } from './etag';

describe('etagMatches', () => {
  it('rozpoznaje ETag dokładny, słaby i z listy', () => {
    expect(etagMatches('"abc"', '"abc"')).toBe(true);
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true);
    expect(etagMatches('"inny", "abc"', '"abc"')).toBe(true);
    expect(etagMatches('*', '"abc"')).toBe(true);
  });

  it('brak nagłówka albo inna wersja to trafienie obok', () => {
    expect(etagMatches(undefined, '"abc"')).toBe(false);
    expect(etagMatches('"stary"', '"abc"')).toBe(false);
  });
});
