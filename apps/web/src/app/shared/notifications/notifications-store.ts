import { DestroyRef, Service, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { AuthStore } from '../../core/auth/auth-store';

// lustrzane typy backendu — GET /notifications i POST /notifications/:id/read (#54)
export type NotificationType =
  | 'BOOKING_CREATED'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_DECLINED'
  | 'BOOKING_CANCELLED_BY_CLIENT'
  | 'BOOKING_CANCELLED_BY_BUSINESS'
  | 'BOOKING_REMINDER';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Ścieżka w tej aplikacji — deep-link do wizyty, liczony po stronie backendu. */
  url: string;
  readAt: string | null;
  createdAt: string;
  bookingId: string | null;
}

interface NotificationsPage {
  items: AppNotification[];
  total: number;
  page: number;
  limit: number;
  unread: number;
}

interface UnreadCount {
  unread: number;
}

/** Bez websocketów (decyzja z #54) — minuta jest kompromisem między świeżością i ruchem. */
const POLL_MS = 60_000;

/**
 * Stan dzwoneczka powiadomień (#54): licznik nieprzeczytanych odpytywany pollingiem oraz
 * lista pobierana przy otwarciu panelu. Osobno od komponentu, bo nawigacja żyje dłużej niż
 * jedno otwarcie panelu, a licznik musi tykać niezależnie od tego, czy panel jest widoczny
 * (ten sam powód, dla którego istnieje PendingCountStore).
 */
@Service()
export class NotificationsStore {
  private readonly api = inject(ApiClient);
  private readonly authStore = inject(AuthStore);

  private readonly unreadSignal = signal(0);
  private readonly itemsSignal = signal<AppNotification[]>([]);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);

  readonly unread = this.unreadSignal.asReadonly();
  readonly items = this.itemsSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  // strażniki wyścigu jak w PendingCountStore: polling i ręczne akcje mogą się wyprzedzać,
  // a spóźniona odpowiedź nie może nadpisać świeższego stanu
  private unreadRequestId = 0;
  private listRequestId = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);

    // Powrót do karty odświeża licznik od razu — po kilku godzinach w tle plakietka byłaby
    // nieaktualna aż do kolejnego ticku, co wygląda na zepsutą funkcję.
    const onVisible = () => {
      if (!document.hidden) {
        void this.refreshUnread();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onVisible));

    // Keyed na zalogowaniu: login startuje polling, wylogowanie go zatrzymuje i zeruje stan.
    effect((onCleanup) => {
      if (!this.authStore.isLoggedIn()) {
        this.reset();
        return;
      }
      void this.refreshUnread();
      const timer = setInterval(() => {
        // w ukrytej karcie nie ma komu patrzeć na plakietkę — nie płacimy za nią żądaniem
        if (!document.hidden) {
          void this.refreshUnread();
        }
      }, POLL_MS);
      onCleanup(() => clearInterval(timer));
    });
  }

  /**
   * Licznik do plakietki. Cicho: to nie jest treść, na którą użytkownik czeka, więc błąd
   * pobrania nie może przesłonić reszty UI alertem — zostawiamy poprzednią wartość
   * (ten sam kompromis co w PendingCountStore).
   */
  async refreshUnread(): Promise<void> {
    if (!this.authStore.isLoggedIn()) {
      this.reset();
      return;
    }
    const requestId = ++this.unreadRequestId;
    try {
      const { unread } = await firstValueFrom(
        this.api.get<UnreadCount>('/notifications/unread-count'),
      );
      if (requestId !== this.unreadRequestId) return;
      this.unreadSignal.set(unread);
    } catch {
      // patrz komentarz metody — brak zmiany stanu przy błędzie
    }
  }

  /** Lista do panelu. Tu błąd jest widoczny, bo użytkownik właśnie o nią poprosił. */
  async loadList(): Promise<void> {
    if (!this.authStore.isLoggedIn()) return;

    const requestId = ++this.listRequestId;
    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    try {
      const page = await firstValueFrom(
        this.api.get<NotificationsPage>('/notifications'),
      );
      if (requestId !== this.listRequestId) return;
      this.itemsSignal.set(page.items);
      // licznik jedzie razem z listą, więc plakietka nie kłamie po otwarciu panelu
      this.unreadSignal.set(page.unread);
      this.unreadRequestId++;
    } catch (err) {
      if (requestId !== this.listRequestId) return;
      this.errorSignal.set(apiErrorMessage(err));
    } finally {
      if (requestId === this.listRequestId) {
        this.loadingSignal.set(false);
      }
    }
  }

  /**
   * Oznaczenie jako przeczytane. Optymistycznie, bo zaraz po tym następuje nawigacja do wizyty
   * i panel znika — czekanie na odpowiedź zostawiłoby plakietkę ze starą liczbą na czas
   * przejścia. Nieudany zapis naprawia się sam: bierzemy świeży licznik z serwera.
   */
  async markRead(id: string): Promise<void> {
    const target = this.itemsSignal().find((n) => n.id === id);
    if (target && target.readAt !== null) return;

    const readAt = new Date().toISOString();
    this.patch(id, readAt);
    this.unreadSignal.update((count) => Math.max(0, count - 1));
    try {
      await firstValueFrom(this.api.post(`/notifications/${id}/read`, {}));
    } catch {
      await this.refreshUnread();
    }
  }

  /** „Oznacz wszystkie jako przeczytane" — ta sama optymistyczna zasada co markRead. */
  async markAllRead(): Promise<void> {
    if (this.unreadSignal() === 0) return;

    const readAt = new Date().toISOString();
    this.itemsSignal.update((list) =>
      list.map((n) => (n.readAt === null ? { ...n, readAt } : n)),
    );
    this.unreadSignal.set(0);
    this.unreadRequestId++;
    try {
      await firstValueFrom(this.api.post('/notifications/read-all', {}));
    } catch {
      await this.refreshUnread();
    }
  }

  private patch(id: string, readAt: string): void {
    this.itemsSignal.update((list) =>
      list.map((n) => (n.id === id ? { ...n, readAt } : n)),
    );
  }

  private reset(): void {
    // bump obu strażników: odpowiedzi zamówione dla poprzedniej sesji nie mogą wrócić
    // i wpisać cudzego licznika po wylogowaniu
    this.unreadRequestId++;
    this.listRequestId++;
    this.unreadSignal.set(0);
    this.itemsSignal.set([]);
    this.errorSignal.set(null);
    this.loadingSignal.set(false);
  }
}
