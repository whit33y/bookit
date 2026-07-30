import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import PendingBookings from './pending-bookings';
import { CalendarBooking } from '../calendar/booking-details-dialog';
import { PendingCountStore } from '../pending-count-store';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

// dostęp do protected pól/metod bez `any` — wzorzec z calendar.spec.ts
interface TestAccess {
  bookings: WritableSignal<CalendarBooking[]>;
  loading: Signal<boolean>;
  serverError: Signal<string | null>;
  confirmingCancelId: WritableSignal<string | null>;
  onAccept(b: CalendarBooking): void;
  onReject(b: CalendarBooking): void;
  onCancel(b: CalendarBooking): void;
  onRequestCancel(id: string): void;
}

function mkBooking(overrides: Partial<CalendarBooking> = {}): CalendarBooking {
  return {
    id: 'b1',
    startsAt: '2026-08-12T08:00:00Z',
    endsAt: '2026-08-12T08:30:00Z',
    status: 'PENDING',
    clientNote: null,
    client: { firstName: 'Jan', lastName: 'Kowalski', phone: '600100200' },
    service: {
      id: 's1',
      name: 'Strzyżenie',
      description: null,
      durationMin: 30,
      priceCents: 8000,
    },
    employee: { id: 'e1', name: 'Ola' },
    ...overrides,
  };
}

describe('PendingBookings', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [PendingBookings],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  function setRole(role: 'OWNER' | 'EMPLOYEE'): void {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role }),
    );
  }

  function setup(role: 'OWNER' | 'EMPLOYEE' = 'OWNER') {
    setRole(role);
    const fixture = TestBed.createComponent(PendingBookings);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const comp = fixture.componentInstance as unknown as TestAccess;
    return { fixture, http, comp };
  }

  function bookingsReq(http: HttpTestingController) {
    return http.expectOne((r) => r.url.startsWith('/api/businesses/mine/bookings'));
  }

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('filtruje wyłącznie rezerwacje PENDING z odpowiedzi API', async () => {
    const { comp, http } = setup();
    bookingsReq(http).flush([
      mkBooking({ id: 'b1', status: 'PENDING' }),
      mkBooking({ id: 'b2', status: 'CONFIRMED' }),
      mkBooking({ id: 'b3', status: 'PENDING' }),
    ]);
    await tick();

    expect(comp.bookings().map((b) => b.id)).toEqual(['b1', 'b3']);
  });

  it('pusta lista PENDING pokazuje komunikat o braku oczekujących', async () => {
    const { fixture, http } = setup();
    bookingsReq(http).flush([mkBooking({ id: 'b1', status: 'CONFIRMED' })]);
    await tick();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Brak oczekujących rezerwacji');
  });

  it('EMPLOYEE widzi listę bez przycisków akcji', async () => {
    const { fixture, http } = setup('EMPLOYEE');
    bookingsReq(http).flush([mkBooking()]);
    await tick();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Strzyżenie');
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    expect(buttons).toHaveLength(0);
  });

  it('klik „Zaakceptuj" usuwa kartę z listy i dekrementuje licznik', async () => {
    const { fixture, http, comp } = setup();
    const store = TestBed.inject(PendingCountStore);
    bookingsReq(http).flush([mkBooking({ id: 'b1' })]);
    await tick();
    expect(store.count()).toBe(1);
    fixture.detectChanges();

    const acceptBtn = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => (b as HTMLButtonElement).textContent?.trim() === 'Zaakceptuj') as
      | HTMLButtonElement
      | undefined;
    acceptBtn?.click();

    http.expectOne('/api/bookings/b1/confirm').flush({ id: 'b1', status: 'CONFIRMED' });
    await tick();

    expect(comp.bookings()).toHaveLength(0);
    expect(store.count()).toBe(0);
  });

  it('„Odwołaj" wymaga potwierdzenia przed wysłaniem żądania', async () => {
    const { fixture, http } = setup();
    bookingsReq(http).flush([mkBooking({ id: 'b1' })]);
    await tick();
    fixture.detectChanges();

    const findBtn = (label: string) =>
      Array.from(fixture.nativeElement.querySelectorAll('button')).find(
        (b) => (b as HTMLButtonElement).textContent?.trim() === label,
      ) as HTMLButtonElement | undefined;

    findBtn('Odwołaj')?.click();
    fixture.detectChanges();

    http.expectNone('/api/bookings/b1/cancel-by-business');
    expect(fixture.nativeElement.textContent).toContain('Na pewno odwołać');

    findBtn('Tak, odwołaj')?.click();
    http
      .expectOne('/api/bookings/b1/cancel-by-business')
      .flush({ id: 'b1', status: 'CANCELLED_BY_BUSINESS' });
  });

  it('409 przy akcji przeładowuje listę zamiast usuwać kartę', async () => {
    const { fixture, http, comp } = setup();
    bookingsReq(http).flush([mkBooking({ id: 'b1' })]);
    await tick();
    fixture.detectChanges();

    const rejectBtn = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => (b as HTMLButtonElement).textContent?.trim() === 'Odrzuć') as
      | HTMLButtonElement
      | undefined;
    rejectBtn?.click();

    http
      .expectOne('/api/bookings/b1/decline')
      .flush(
        { message: 'Status rezerwacji zmienił się w międzyczasie' },
        { status: 409, statusText: 'Conflict' },
      );
    await tick();

    // po 409 komponent robi cichy refetch (silent=true, bez ponownego loading)
    bookingsReq(http).flush([mkBooking({ id: 'b1', status: 'CONFIRMED' })]);
    await tick();

    expect(comp.bookings()).toHaveLength(0);
  });
});
