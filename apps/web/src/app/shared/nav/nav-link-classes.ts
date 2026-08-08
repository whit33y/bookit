// pigułki nawigacji wg design systemu §10 — rozdzielone, bo [class] podmienia cały zestaw
// zamiast nakładać klasy na siebie (dwie konkurujące klasy text-* zależałyby od kolejności w CSS).
// Wspólne dla nawigacji głównej (#125) i przełącznika sekcji w panelu admina (#42).
export const ACTIVE_LINK = 'bg-brand-50 font-semibold text-brand-700';
export const INACTIVE_LINK =
  'font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900';
