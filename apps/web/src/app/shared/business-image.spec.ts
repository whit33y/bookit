import { describe, expect, it } from 'vitest';
import { businessCoverUrl, businessLogoUrl } from './business-image';

describe('adresy obrazów firmy', () => {
  it('składają adres publicznej trasy z wersją jako cache-busterem', () => {
    expect(businessLogoUrl({ id: 'b1', logoVersion: 'abc123' })).toBe(
      '/api/businesses/b1/images/logo?v=abc123',
    );
    expect(businessCoverUrl({ id: 'b1', coverVersion: 'abc123' })).toBe(
      '/api/businesses/b1/images/cover?v=abc123',
    );
  });

  // null z API znaczy „firma nie ma tego obrazu" — wywołujący ma wtedy narysować monogram
  // albo gradient, a nie odpytywać serwer o coś, czego nie ma
  it('zwracają null, gdy firma nie ma obrazu w tym slocie', () => {
    expect(businessLogoUrl({ id: 'b1', logoVersion: null })).toBeNull();
    expect(businessCoverUrl({ id: 'b1', coverVersion: null })).toBeNull();
  });

  it('escapują wersję w query stringu', () => {
    expect(businessLogoUrl({ id: 'b1', logoVersion: 'v 1' })).toBe(
      '/api/businesses/b1/images/logo?v=v%201',
    );
  });
});
