/**
 * Czy `If-None-Match` pasuje do naszego ETagu. Nagłówek bywa listą i bywa oznaczony jako słaby
 * (`W/"..."`), a `*` znaczy „cokolwiek masz". Zasoby, które tędy chodzą, są niezmienne w obrębie
 * wersji, więc słaba i mocna walidacja dają ten sam wynik.
 */
export const etagMatches = (ifNoneMatch: string | undefined, etag: string): boolean => {
  if (!ifNoneMatch) {
    return false;
  }
  return ifNoneMatch
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .some((candidate) => candidate === '*' || candidate === etag);
};
