import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStore } from '../../core/auth/auth-store';
import { signInAs, verifyIgnoringProfile } from '../../core/auth/auth-testing';
import { FavoritesStore } from './favorites-store';

const IDS_URL = '/api/favorites/ids';

describe('FavoritesStore', () => {
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
    verifyIgnoringProfile(TestBed.inject(HttpTestingController));
  });

  /** Store czyta rolę sygnałem, a efekt startowy odpala się przy pierwszym tick. */
  function setup() {
    const store = TestBed.inject(FavoritesStore);
    TestBed.tick();
    return { store, http: TestBed.inject(HttpTestingController) };
  }

  it('gość nie pyta o ulubione i ma pusty zbiór', () => {
    const { store, http } = setup();

    http.expectNone(IDS_URL);
    expect(store.isFavorite('b1')).toBe(false);
  });

  // AC #182: rola inna niż CLIENT nie wywołuje /favorites/ids — endpoint i tak odda jej 403
  it.each(['OWNER', 'EMPLOYEE', 'ADMIN'] as const)(
    'rola %s nie pyta o ulubione',
    (role) => {
      signInAs({ role });
      const { http } = setup();

      http.expectNone(IDS_URL);
    },
  );

  it('zalogowany klient pobiera zbiór identyfikatorów raz, przy starcie', async () => {
    signInAs();
    const { store, http } = setup();

    http.expectOne(IDS_URL).flush({ ids: ['b1', 'b2'] });
    await Promise.resolve();

    expect(store.isFavorite('b1')).toBe(true);
    expect(store.isFavorite('b3')).toBe(false);
    // drugi konsument (wejście na wyszukiwarkę) czyta gotowy zbiór, nie odpytuje ponownie
    http.expectNone(IDS_URL);
  });

  // Zbiór jest dodatkiem do ekranu, nie treścią, o którą klient prosił — puste serca są
  // znośniejsze niż alert na wyszukiwarce.
  it('nieudane pobranie zostawia pusty zbiór i nie rzuca', async () => {
    signInAs();
    const { store, http } = setup();

    http
      .expectOne(IDS_URL)
      .flush({ message: 'Błąd' }, { status: 500, statusText: 'Server Error' });
    await Promise.resolve();

    expect(store.isFavorite('b1')).toBe(false);
  });

  it('wylogowanie czyści zbiór', async () => {
    signInAs();
    const { store, http } = setup();
    http.expectOne(IDS_URL).flush({ ids: ['b1'] });
    await Promise.resolve();

    TestBed.inject(AuthStore).logout();
    TestBed.tick();

    expect(store.isFavorite('b1')).toBe(false);
    http.expectNone(IDS_URL);
  });

  it('dodanie zapala serce przed odpowiedzią i wysyła PUT', async () => {
    signInAs();
    const { store, http } = setup();
    http.expectOne(IDS_URL).flush({ ids: [] });
    await Promise.resolve();

    const toggle = store.toggle('b1');
    expect(store.isFavorite('b1')).toBe(true);

    const req = http.expectOne('/api/businesses/b1/favorite');
    expect(req.request.method).toBe('PUT');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await toggle;

    expect(store.isFavorite('b1')).toBe(true);
  });

  it('usunięcie gasi serce przed odpowiedzią i wysyła DELETE', async () => {
    signInAs();
    const { store, http } = setup();
    http.expectOne(IDS_URL).flush({ ids: ['b1'] });
    await Promise.resolve();

    const toggle = store.toggle('b1');
    expect(store.isFavorite('b1')).toBe(false);

    const req = http.expectOne('/api/businesses/b1/favorite');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await toggle;

    expect(store.isFavorite('b1')).toBe(false);
  });

  // AC #182: nieudane żądanie cofa stan serca
  it('nieudane dodanie cofa zapalone serce', async () => {
    signInAs();
    const { store, http } = setup();
    http.expectOne(IDS_URL).flush({ ids: [] });
    await Promise.resolve();

    const toggle = store.toggle('b1');
    http
      .expectOne('/api/businesses/b1/favorite')
      .flush({ message: 'Błąd' }, { status: 500, statusText: 'Server Error' });
    await toggle;

    expect(store.isFavorite('b1')).toBe(false);
  });

  it('nieudane usunięcie przywraca zgaszone serce', async () => {
    signInAs();
    const { store, http } = setup();
    http.expectOne(IDS_URL).flush({ ids: ['b1'] });
    await Promise.resolve();

    const toggle = store.toggle('b1');
    http
      .expectOne('/api/businesses/b1/favorite')
      .flush({ message: 'Błąd' }, { status: 500, statusText: 'Server Error' });
    await toggle;

    expect(store.isFavorite('b1')).toBe(true);
  });

  // Dwa kliknięcia w to samo serce: drugie wraca do stanu wyjściowego, więc cofnięcie po
  // błędzie pierwszego nie może nadpisać świeższej decyzji klienta.
  it('błąd starszego żądania nie cofa nowszego kliknięcia', async () => {
    signInAs();
    const { store, http } = setup();
    http.expectOne(IDS_URL).flush({ ids: [] });
    await Promise.resolve();

    const first = store.toggle('b1');
    const second = store.toggle('b1');
    expect(store.isFavorite('b1')).toBe(false);

    const [add, remove] = http.match('/api/businesses/b1/favorite');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    add.flush({ message: 'Błąd' }, { status: 500, statusText: 'Server Error' });
    await Promise.all([first, second]);

    expect(store.isFavorite('b1')).toBe(false);
  });

  // regresja z code-review #182: kliknięcie w trakcie startowego pobrania nie może wywalić
  // całej odpowiedzi — inaczej pozostałe serca zostałyby zgaszone do końca sesji
  it('kliknięcie w trakcie pobrania nakłada się na zbiór z serwera, nie kasuje go', async () => {
    signInAs();
    const { store, http } = setup();
    const ids = http.expectOne(IDS_URL);

    // klient klika serce firmy, której nie ma w odpowiedzi jeszcze w locie
    const toggle = store.toggle('b3');
    ids.flush({ ids: ['b1', 'b2'] });
    await Promise.resolve();

    expect(store.isFavorite('b1')).toBe(true);
    expect(store.isFavorite('b2')).toBe(true);
    expect(store.isFavorite('b3')).toBe(true);

    http
      .expectOne('/api/businesses/b3/favorite')
      .flush(null, { status: 204, statusText: 'No Content' });
    await toggle;
  });

  it('rola inna niż CLIENT nie wysyła żądania przy toggle', async () => {
    signInAs({ role: 'OWNER' });
    const { store, http } = setup();

    await store.toggle('b1');

    http.expectNone('/api/businesses/b1/favorite');
    expect(store.isFavorite('b1')).toBe(false);
  });
});
