import { BusinessStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  isBusinessAvailable,
  publicBusinessSql,
  publicBusinessWhere,
} from './public-business';

describe('publicBusinessWhere / publicBusinessSql', () => {
  it('wpuszcza wyłącznie firmę zaakceptowaną i niezablokowaną', () => {
    expect(publicBusinessWhere).toEqual({
      isBlocked: false,
      status: BusinessStatus.APPROVED,
    });
  });

  // Ten sam warunek zapisany dwa razy: raz dla Prismy, raz dla zapytania Haversine w surowym
  // SQL-u. Test pilnuje, żeby nie rozjechały się na jedną oś — wyszukiwarka geograficzna
  // pokazywałaby wtedy firmy, których alfabetyczna nie pokazuje.
  it('wariant SQL niesie oba warunki i status z parametru, nie wklejony w tekst', () => {
    expect(publicBusinessSql.sql).toContain('"isBlocked" = false');
    expect(publicBusinessSql.sql).toContain('"status"');
    expect(publicBusinessSql.sql).toContain('::"BusinessStatus"');
    expect(publicBusinessSql.values).toEqual([BusinessStatus.APPROVED]);
  });

  // Trzeci zapis tego samego warunku, tym razem na wczytanym wierszu — potrzebuje go
  // `isAvailable` na liście ulubionych (#181). Czyta wartości z predykatu, więc test pilnuje
  // nie literałów, a tego, że firma niedziałająca nie przechodzi na żadnej z dwóch osi.
  describe('isBusinessAvailable', () => {
    it('zaakceptowana i niezablokowana działa', () => {
      expect(
        isBusinessAvailable({ isBlocked: false, status: BusinessStatus.APPROVED }),
      ).toBe(true);
    });

    it('zablokowana albo niezaakceptowana nie działa', () => {
      expect(
        isBusinessAvailable({ isBlocked: true, status: BusinessStatus.APPROVED }),
      ).toBe(false);
      expect(
        isBusinessAvailable({ isBlocked: false, status: BusinessStatus.PENDING }),
      ).toBe(false);
      expect(
        isBusinessAvailable({ isBlocked: false, status: BusinessStatus.REJECTED }),
      ).toBe(false);
    });
  });
});
