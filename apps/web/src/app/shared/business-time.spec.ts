import { formatDate, formatRelativeTime } from './business-time';

const NOW = new Date('2026-08-03T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

describe('formatRelativeTime', () => {
  it('minuty i godziny liczone od teraz', () => {
    expect(formatRelativeTime(minutesAgo(2), NOW)).toBe('2 minuty temu');
    expect(formatRelativeTime(minutesAgo(120), NOW)).toBe('2 godziny temu');
    // rozpoczęta godzina nie awansuje na następną (trunc, nie round)
    expect(formatRelativeTime(minutesAgo(90), NOW)).toBe('1 godzinę temu');
  });

  it('doby zwija na „wczoraj" — Intl z numeric: auto', () => {
    expect(formatRelativeTime(minutesAgo(60 * 24), NOW)).toBe('wczoraj');
    expect(formatRelativeTime(minutesAgo(60 * 24 * 3), NOW)).toBe('3 dni temu');
  });

  // „8 dni temu" mówi mniej niż data, a lista powiadomień sięga wstecz bez ograniczeń
  it('powyżej tygodnia oddaje zwykłą datę', () => {
    const old = minutesAgo(60 * 24 * 10);

    expect(formatRelativeTime(old, NOW)).toBe(formatDate(old));
  });

  // zegar przeglądarki może wyprzedzać serwer o kilka sekund — nie chcemy „-1 minutę temu"
  it('znacznik z przyszłości nie daje ujemnych minut', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 5_000).toISOString(), NOW)).toBe(
      'ta minuta',
    );
  });
});
