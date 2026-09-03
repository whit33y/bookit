import { Signal, signal } from '@angular/core';
import { apiErrorMessage } from '../core/api-client';

/** Wynik akcji wiersza. Błąd wraca do wołającego, bo niektóre statusy zmieniają samą listę:
 *  409 z decyzji o zgłoszeniu znaczy „ktoś inny już zdecydował", a nie „spróbuj ponownie". */
export type RowActionResult = { ok: true } | { ok: false; error: unknown };

/**
 * Stan akcji wykonywanych na pojedynczych wierszach tabel admina: blokada firmy (#42),
 * decyzja o zgłoszeniu (#145). Wszystkie takie akcje mają ten sam kształt — jeden wiersz
 * jest „w locie", nieudana kończy się komunikatem przypisanym do tego wiersza (a nie nad
 * całą tabelą), udana ogłasza się czytnikowi ekranu, bo sama zmiana w tabeli jest dla niego
 * niema.
 */
export interface RowActions {
  /** Treść dla `<p role="status">` — ostatnia udana akcja opisana słowami. */
  readonly statusMessage: Signal<string>;
  /** True, dopóki akcja dla tego wiersza jest w locie. */
  isBusy(id: string): boolean;
  /** Komunikat nieudanej akcji tego wiersza albo null. Naraz istnieje najwyżej jeden —
   *  modal dopuszcza tylko jedną akcję w danym momencie. */
  errorFor(id: string): string | null;
  /** Kasuje komunikat błędu — przy otwarciu modala dla kolejnej decyzji. */
  clearError(): void;
  /**
   * Uruchamia akcję dla wiersza i pilnuje jej stanu: powtórne kliknięcie w wiersz, który
   * jest w locie, odpada, błąd ląduje pod jego id, a komunikat zwrócony przez akcję trafia
   * do `statusMessage`. Wynik mówi rodzicowi, co zrobić z modalem i z wierszem.
   */
  run(id: string, action: () => Promise<string>): Promise<RowActionResult>;
}

export function createRowActions(): RowActions {
  const statusMessage = signal('');
  const error = signal<{ id: string; message: string } | null>(null);
  // zbiór, nie pojedyncze id: dwa wiersze mogą być w locie równolegle
  const busy = signal<ReadonlySet<string>>(new Set());

  function setBusy(id: string, value: boolean): void {
    busy.update((ids) => {
      const next = new Set(ids);
      if (value) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  const isBusy = (id: string) => busy().has(id);

  return {
    statusMessage: statusMessage.asReadonly(),
    isBusy,

    errorFor(id: string): string | null {
      const current = error();
      return current?.id === id ? current.message : null;
    },

    clearError(): void {
      error.set(null);
    },

    async run(id: string, action: () => Promise<string>): Promise<RowActionResult> {
      if (isBusy(id)) {
        return { ok: false, error: null };
      }

      error.set(null);
      setBusy(id, true);
      try {
        statusMessage.set(await action());
        return { ok: true };
      } catch (err) {
        // komunikat pod id wiersza pokazujemy zawsze; czy poza tym coś zrobić ze samym
        // wierszem, rozstrzyga wołający — tylko on wie, co dany status znaczy dla jego listy
        error.set({ id, message: apiErrorMessage(err) });
        return { ok: false, error: err };
      } finally {
        setBusy(id, false);
      }
    },
  };
}
