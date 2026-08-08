// pigułki nawigacji wg design systemu §10 — pełne zestawy zamiast bazy nakładanej osobno,
// bo [class] podmienia całość zamiast nakładać klasy na siebie (dwie konkurujące klasy text-*
// zależałyby od kolejności w CSS), a statyczny `class=` obok bindingu oznaczał kopiowanie tej
// samej ściany utility w każdym szablonie.
// Wspólne dla nawigacji głównej (#125) i przełącznika sekcji w panelu admina (#42).
const LINK_BASE =
  'rounded-lg px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';

export const ACTIVE_LINK = `${LINK_BASE} bg-brand-50 font-semibold text-brand-700`;
export const INACTIVE_LINK = `${LINK_BASE} font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900`;
