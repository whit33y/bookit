import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PendingCountStore } from './pending-count-store';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

describe('PendingCountStore', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('rola CLIENT — refresh() ustawia 0 bez wywołania HTTP', async () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
    );
    const store = TestBed.inject(PendingCountStore);
    store.set(5);

    await store.refresh();

    expect(store.count()).toBe(0);
  });

  it('brak sesji — refresh() ustawia 0 bez wywołania HTTP', async () => {
    const store = TestBed.inject(PendingCountStore);

    await store.refresh();

    expect(store.count()).toBe(0);
  });

  it('OWNER — refresh() liczy tylko rezerwacje PENDING', async () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'OWNER' }),
    );
    const store = TestBed.inject(PendingCountStore);
    const http = TestBed.inject(HttpTestingController);

    const promise = store.refresh();
    const req = http.expectOne((r) => r.url.startsWith('/api/businesses/mine/bookings'));
    req.flush([
      { status: 'PENDING' },
      { status: 'CONFIRMED' },
      { status: 'PENDING' },
    ]);
    await promise;

    expect(store.count()).toBe(2);
  });

  it('decrement() nigdy nie schodzi poniżej zera', () => {
    const store = TestBed.inject(PendingCountStore);
    store.set(0);
    store.decrement();
    expect(store.count()).toBe(0);
  });

  // regresja code-review #33: spóźniona odpowiedź na refresh() nie może nadpisać dekrementacji
  // wykonanej w międzyczasie (np. przez akcję na liście /business/pending) nieaktualną wartością
  it('spóźniony refresh() nie nadpisuje decrement() wykonanego w międzyczasie', async () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'OWNER' }),
    );
    const store = TestBed.inject(PendingCountStore);
    const http = TestBed.inject(HttpTestingController);

    const promise = store.refresh();
    const req = http.expectOne((r) => r.url.startsWith('/api/businesses/mine/bookings'));

    // w trakcie trwania requestu ktoś już zdążył zaakceptować/odrzucić rezerwację z listy
    store.set(3);
    store.decrement();
    expect(store.count()).toBe(2);

    // spóźniona odpowiedź refresh() niesie stary, wyższy stan — musi zostać odrzucona
    req.flush([{ status: 'PENDING' }, { status: 'PENDING' }, { status: 'PENDING' }]);
    await promise;

    expect(store.count()).toBe(2);
  });
});
