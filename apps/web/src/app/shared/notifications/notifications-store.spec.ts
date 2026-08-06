import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStore } from '../../core/auth/auth-store';
import { AppNotification, NotificationsStore } from './notifications-store';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

const notification = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1',
  type: 'BOOKING_CONFIRMED',
  title: 'Rezerwacja potwierdzona',
  body: 'Salon Ola potwierdziła wizytę.',
  url: '/client?booking=b1',
  readAt: null,
  createdAt: '2026-08-03T10:00:00.000Z',
  bookingId: 'b1',
  ...overrides,
});

const page = (items: AppNotification[], unread = items.length) => ({
  items,
  total: items.length,
  page: 1,
  limit: 10,
  unread,
});

describe('NotificationsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  function login(role = 'CLIENT') {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role }),
    );
  }

  /** Pozwala wybrzmieć obsłudze błędu (catch → kolejne żądanie) przed asercją. */
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** Store czyta zalogowanie sygnałem, a efekt startowy odpala się przy pierwszym tick. */
  function setup() {
    const store = TestBed.inject(NotificationsStore);
    TestBed.tick();
    return { store, http: TestBed.inject(HttpTestingController) };
  }

  it('niezalogowany nie odpytuje API i ma zerowy licznik', () => {
    const { store, http } = setup();

    http.expectNone('/api/notifications/unread-count');
    expect(store.unread()).toBe(0);
  });

  it('zalogowany pobiera licznik nieprzeczytanych od razu po starcie', async () => {
    login();
    const { store, http } = setup();

    http.expectOne('/api/notifications/unread-count').flush({ unread: 3 });
    await Promise.resolve();

    expect(store.unread()).toBe(3);
  });

  // Plakietka w nawigacji nie jest na tyle krytyczna, żeby przesłaniać UI alertem
  it('błąd licznika nie zmienia stanu i nie rzuca', async () => {
    login();
    const { store, http } = setup();
    http.expectOne('/api/notifications/unread-count').flush({ unread: 2 });
    await Promise.resolve();

    const refresh = store.refreshUnread();
    http
      .expectOne('/api/notifications/unread-count')
      .flush({ message: 'Błąd' }, { status: 500, statusText: 'Server Error' });
    await expect(refresh).resolves.toBeUndefined();

    expect(store.unread()).toBe(2);
    expect(store.error()).toBeNull();
  });

  it('loadList zapisuje listę i licznik z tej samej odpowiedzi', async () => {
    login();
    const { store, http } = setup();
    http.expectOne('/api/notifications/unread-count').flush({ unread: 0 });
    await Promise.resolve();

    const load = store.loadList();
    http.expectOne('/api/notifications').flush(page([notification()], 1));
    await load;

    expect(store.items()).toHaveLength(1);
    expect(store.unread()).toBe(1);
    expect(store.loading()).toBe(false);
  });

  it('błąd listy pokazuje komunikat po polsku', async () => {
    login();
    const { store, http } = setup();
    http.expectOne('/api/notifications/unread-count').flush({ unread: 0 });
    await Promise.resolve();

    const load = store.loadList();
    http
      .expectOne('/api/notifications')
      .flush({ message: 'Błąd' }, { status: 500, statusText: 'Server Error' });
    await load;

    expect(store.error()).toBeTruthy();
    expect(store.loading()).toBe(false);
  });

  it('markRead dekrementuje licznik i oznacza wiersz przed odpowiedzią serwera', async () => {
    login();
    const { store, http } = setup();
    http.expectOne('/api/notifications/unread-count').flush({ unread: 2 });
    await Promise.resolve();
    const load = store.loadList();
    http
      .expectOne('/api/notifications')
      .flush(page([notification({ id: 'n1' }), notification({ id: 'n2' })], 2));
    await load;

    const marking = store.markRead('n1');

    // stan zmienia się natychmiast — panel znika razem z nawigacją do wizyty
    expect(store.unread()).toBe(1);
    expect(store.items().find((n) => n.id === 'n1')?.readAt).not.toBeNull();

    http.expectOne('/api/notifications/n1/read').flush({ id: 'n1', readAt: 'now' });
    await marking;
  });

  it('już przeczytane powiadomienie nie wysyła żądania ponownie', async () => {
    login();
    const { store, http } = setup();
    http.expectOne('/api/notifications/unread-count').flush({ unread: 0 });
    await Promise.resolve();
    const load = store.loadList();
    http
      .expectOne('/api/notifications')
      .flush(page([notification({ readAt: '2026-08-03T11:00:00.000Z' })], 0));
    await load;

    await store.markRead('n1');

    http.expectNone('/api/notifications/n1/read');
  });

  // Optymistyczna zmiana bez rollbacku — świeży licznik z serwera naprawia stan sam
  it('nieudany markRead dociąga licznik z serwera', async () => {
    login();
    const { store, http } = setup();
    http.expectOne('/api/notifications/unread-count').flush({ unread: 1 });
    await Promise.resolve();

    const marking = store.markRead('n1');
    http
      .expectOne('/api/notifications/n1/read')
      .flush({ message: 'Błąd' }, { status: 500, statusText: 'Server Error' });
    await tick();
    http.expectOne('/api/notifications/unread-count').flush({ unread: 1 });
    await marking;

    expect(store.unread()).toBe(1);
  });

  it('markAllRead zeruje licznik i oznacza wszystkie wiersze', async () => {
    login();
    const { store, http } = setup();
    http.expectOne('/api/notifications/unread-count').flush({ unread: 2 });
    await Promise.resolve();
    const load = store.loadList();
    http
      .expectOne('/api/notifications')
      .flush(page([notification({ id: 'n1' }), notification({ id: 'n2' })], 2));
    await load;

    const marking = store.markAllRead();
    expect(store.unread()).toBe(0);
    expect(store.items().every((n) => n.readAt !== null)).toBe(true);

    http.expectOne('/api/notifications/read-all').flush({ updated: 2 });
    await marking;
  });

  it('brak nieprzeczytanych → markAllRead nie wysyła żądania', async () => {
    login();
    const { store, http } = setup();
    http.expectOne('/api/notifications/unread-count').flush({ unread: 0 });
    await Promise.resolve();

    await store.markAllRead();

    http.expectNone('/api/notifications/read-all');
  });

  it('wylogowanie zeruje stan i zatrzymuje odpytywanie', async () => {
    login();
    const { store, http } = setup();
    http.expectOne('/api/notifications/unread-count').flush({ unread: 5 });
    const load = store.loadList();
    http.expectOne('/api/notifications').flush(page([notification()], 5));
    await load;
    expect(store.unread()).toBe(5);

    TestBed.inject(AuthStore).logout();
    TestBed.tick();

    // stan poprzedniej sesji nie może zostać na ekranie ani w plakietce
    expect(store.unread()).toBe(0);
    expect(store.items()).toHaveLength(0);
    // i nic już nie leci do API — resztę załatwia verify() w afterEach
    await store.refreshUnread();
    http.expectNone('/api/notifications/unread-count');
  });
});
