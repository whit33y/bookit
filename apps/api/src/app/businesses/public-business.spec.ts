import { BusinessStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { publicBusinessSql, publicBusinessWhere } from './public-business';

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
});
