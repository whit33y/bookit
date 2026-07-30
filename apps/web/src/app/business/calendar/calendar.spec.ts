import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import BusinessCalendar from './calendar';
import { CalendarBooking } from './booking-details-dialog';
import { addDays, startOfWeekMonday } from './calendar-date';
import { todayInBusinessTz } from '../../shared/business-time';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

interface CalendarEmployee {
  id: string;
  name: string;
  isActive: boolean;
}

interface CalendarColumn {
  key: string;
  title: string;
  bookings: CalendarBooking[];
}

// dostęp do protected pól/metod bez `any` — wzorzec z schedule.spec.ts/employees.spec.ts
interface TestAccess {
  viewMode: WritableSignal<'day' | 'week'>;
  anchorDate: WritableSignal<string>;
  selectedEmployeeId: WritableSignal<string | null>;
  employees: WritableSignal<CalendarEmployee[]>;
  bookings: WritableSignal<CalendarBooking[]>;
  columns: Signal<CalendarColumn[]>;
  selectedBooking: WritableSignal<CalendarBooking | null>;
  setViewMode(mode: 'day' | 'week'): void;
  navigate(delta: 1 | -1 | 'today'): void;
  onEmployeeChange(event: Event): void;
  openDetails(b: CalendarBooking): void;
  onBookingChanged(event: { id: string; status: CalendarBooking['status'] }): void;
  onBookingConflict(event: { id: string }): void;
}

const TODAY = todayInBusinessTz();
const ACTIVE_1: CalendarEmployee = { id: 'e1', name: 'Ala', isActive: true };
const ACTIVE_2: CalendarEmployee = { id: 'e2', name: 'Basia', isActive: true };
const INACTIVE: CalendarEmployee = { id: 'e3', name: 'Stary', isActive: false };

function mkBooking(overrides: Partial<CalendarBooking> = {}): CalendarBooking {
  return {
    id: 'b1',
    startsAt: `${TODAY}T08:00:00Z`,
    endsAt: `${TODAY}T08:30:00Z`,
    status: 'CONFIRMED',
    clientNote: null,
    client: { firstName: 'Jan', lastName: 'Kowalski', phone: '600100200' },
    service: {
      id: 's1',
      name: 'Strzyżenie',
      description: null,
      durationMin: 30,
      priceCents: 8000,
    },
    employee: { id: 'e1', name: 'Ala' },
    ...overrides,
  };
}

describe('BusinessCalendar', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [BusinessCalendar],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  function setToken(role: 'OWNER' | 'EMPLOYEE'): void {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role }),
    );
  }

  function setup(role: 'OWNER' | 'EMPLOYEE') {
    setToken(role);
    const fixture = TestBed.createComponent(BusinessCalendar);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges(); // konstruktor odpala fetch(e)
    const comp = fixture.componentInstance as unknown as TestAccess;
    return { fixture, http, comp };
  }

  function bookingsReq(http: HttpTestingController) {
    return http.expectOne((r) => r.url.startsWith('/api/businesses/mine/bookings'));
  }

  // firstValueFrom resolves via microtask — sygnały ustawiane w .then() nie są jeszcze
  // zaktualizowane tuż po flush(), trzeba dać kolejce mikrozadań się rozwinąć (jak w
  // employees.spec.ts/schedule.spec.ts)
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('OWNER, widok dnia — GET employees + GET bookings bez employeeId', () => {
    const { http } = setup('OWNER');
    const empReq = http.expectOne('/api/businesses/mine/employees');
    empReq.flush([ACTIVE_1, ACTIVE_2]);

    const req = bookingsReq(http);
    expect(req.request.url).toContain(`from=${TODAY}`);
    expect(req.request.url).toContain(`to=${TODAY}`);
    expect(req.request.url).not.toContain('employeeId');
    req.flush([]);
  });

  it('EMPLOYEE, widok dnia — brak requestu do /employees, bookings bez employeeId', () => {
    const { http } = setup('EMPLOYEE');
    http.expectNone('/api/businesses/mine/employees');

    const req = bookingsReq(http);
    expect(req.request.url).not.toContain('employeeId');
    req.flush([]);
  });

  it('OWNER, przełączenie na tydzień wysyła employeeId pierwszego aktywnego pracownika', async () => {
    const { http, comp } = setup('OWNER');
    http.expectOne('/api/businesses/mine/employees').flush([ACTIVE_1, ACTIVE_2]);
    bookingsReq(http).flush([]);
    await tick();

    comp.setViewMode('week');

    const req = bookingsReq(http);
    const monday = startOfWeekMonday(TODAY);
    const sunday = addDays(monday, 6);
    expect(req.request.url).toContain(`from=${monday}`);
    expect(req.request.url).toContain(`to=${sunday}`);
    expect(req.request.url).toContain('employeeId=e1');
    req.flush([]);
  });

  it('EMPLOYEE, widok tygodnia nigdy nie wysyła employeeId', () => {
    const { http, comp } = setup('EMPLOYEE');
    bookingsReq(http).flush([]);

    comp.setViewMode('week');

    const req = bookingsReq(http);
    expect(req.request.url).not.toContain('employeeId');
    req.flush([]);
  });

  it('przełączenie dzień→tydzień zmienia grupowanie kolumn (pracownik vs dzień tygodnia)', async () => {
    const { http, comp } = setup('OWNER');
    http.expectOne('/api/businesses/mine/employees').flush([ACTIVE_1, ACTIVE_2]);
    bookingsReq(http).flush([
      mkBooking({ id: 'b1', employee: { id: 'e1', name: 'Ala' } }),
      mkBooking({ id: 'b2', employee: { id: 'e2', name: 'Basia' } }),
    ]);
    await tick();

    expect(comp.columns().map((c) => c.key)).toEqual(['e1', 'e2']);

    comp.setViewMode('week');
    bookingsReq(http).flush([
      mkBooking({ id: 'b1', employee: { id: 'e1', name: 'Ala' } }),
    ]);
    await tick();

    expect(comp.columns()).toHaveLength(7);
    expect(comp.columns()[0].key).toBe(startOfWeekMonday(TODAY));
  });

  it('nawigacja: next/prev przesuwa zakres, „dziś" resetuje niezależnie od offsetu', async () => {
    const { http, comp } = setup('EMPLOYEE');
    bookingsReq(http).flush([]);
    await tick();

    comp.navigate(1);
    const nextDay = addDays(TODAY, 1);
    const nextReq = bookingsReq(http);
    expect(nextReq.request.url).toContain(`from=${nextDay}`);
    nextReq.flush([]);
    await tick();

    comp.navigate('today');
    expect(comp.anchorDate()).toBe(TODAY);
    bookingsReq(http).flush([]);
  });

  it('zmiana pracownika w selektorze wywołuje nowy fetch z nowym employeeId', () => {
    const { http, comp } = setup('OWNER');
    http.expectOne('/api/businesses/mine/employees').flush([ACTIVE_1, ACTIVE_2]);
    bookingsReq(http).flush([]);

    comp.setViewMode('week');
    bookingsReq(http).flush([]);

    comp.onEmployeeChange({ target: { value: 'e2' } } as unknown as Event);
    expect(comp.selectedEmployeeId()).toBe('e2');
    expect(bookingsReq(http).request.url).toContain('employeeId=e2');
  });

  it('klik w kafelek ustawia selectedBooking', () => {
    const { http, comp } = setup('EMPLOYEE');
    const b = mkBooking();
    bookingsReq(http).flush([b]);

    expect(comp.selectedBooking()).toBeNull();
    comp.openDetails(b);
    expect(comp.selectedBooking()).toEqual(b);
  });

  it('EMPLOYEE nigdy nie renderuje selektora pracownika ani kolumn per pracownik', async () => {
    const { http, comp, fixture } = setup('EMPLOYEE');
    bookingsReq(http).flush([
      mkBooking({ id: 'b1', employee: { id: 'e1', name: 'Ala' } }),
      mkBooking({ id: 'b2', employee: { id: 'e2', name: 'Basia' } }),
    ]);
    await tick();

    comp.setViewMode('week');
    bookingsReq(http).flush([]);
    await tick();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#employee-picker')).toBeNull();

    comp.setViewMode('day');
    bookingsReq(http).flush([
      mkBooking({ id: 'b1', employee: { id: 'e1', name: 'Ala' } }),
      mkBooking({ id: 'b2', employee: { id: 'e2', name: 'Basia' } }),
    ]);
    await tick();

    expect(comp.columns()).toHaveLength(1);
    expect(comp.columns()[0].key).toBe('me');
    expect(comp.columns()[0].bookings).toHaveLength(2);
  });

  it('OWNER z zerem aktywnych pracowników — stan pusty zamiast siatki', async () => {
    const { http, fixture } = setup('OWNER');
    http.expectOne('/api/businesses/mine/employees').flush([INACTIVE]);
    bookingsReq(http).flush([]);
    await tick();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Nie masz aktywnych pracowników');
    expect(fixture.nativeElement.querySelector('.grid')).toBeNull();
  });

  it('błąd pobrania pracowników pokazuje komunikat błędu, nie stan pustej listy', async () => {
    const { http, fixture } = setup('OWNER');
    http
      .expectOne('/api/businesses/mine/employees')
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    bookingsReq(http).flush([]);
    await tick();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Nie masz aktywnych pracowników');
    expect(text).toContain('Nie udało się wczytać pracowników');
  });

  it('przełączenie na tydzień przed wczytaniem pracowników dogania refetch z employeeId, gdy oni wrócą', async () => {
    const { http, comp } = setup('OWNER');
    const empReq = http.expectOne('/api/businesses/mine/employees');
    bookingsReq(http).flush([]); // dzień, jeszcze bez pracowników

    comp.setViewMode('week');
    const weekReqBeforeEmployees = bookingsReq(http);
    expect(weekReqBeforeEmployees.request.url).not.toContain('employeeId');
    weekReqBeforeEmployees.flush([]);

    empReq.flush([ACTIVE_1, ACTIVE_2]);
    await tick();

    const followUp = bookingsReq(http);
    expect(followUp.request.url).toContain('employeeId=e1');
    followUp.flush([]);
  });

  it('rezerwacja pracownika spoza activeEmployees (np. zdezaktywowanego) dostaje własną kolumnę', async () => {
    const { http, comp } = setup('OWNER');
    http.expectOne('/api/businesses/mine/employees').flush([ACTIVE_1]);
    bookingsReq(http).flush([
      mkBooking({ id: 'b1', employee: { id: 'e1', name: 'Ala' } }),
      mkBooking({ id: 'b2', employee: { id: 'e9', name: 'Była Basia' } }),
    ]);
    await tick();

    const cols = comp.columns();
    expect(cols.map((c) => c.key)).toEqual(['e1', 'e9']);
    expect(cols[1].title).toBe('Była Basia');
    expect(cols[1].bookings).toHaveLength(1);
  });

  it('onBookingChanged podmienia status rezerwacji i zamyka dialog (#33)', async () => {
    const { http, comp } = setup('OWNER');
    http.expectOne('/api/businesses/mine/employees').flush([ACTIVE_1]);
    const b = mkBooking({ id: 'b1', status: 'PENDING' });
    bookingsReq(http).flush([b]);
    await tick();

    comp.openDetails(b);
    expect(comp.selectedBooking()).not.toBeNull();

    comp.onBookingChanged({ id: 'b1', status: 'CONFIRMED' });

    expect(comp.bookings().find((x) => x.id === 'b1')?.status).toBe('CONFIRMED');
    expect(comp.selectedBooking()).toBeNull();
  });

  it('onBookingConflict zamyka dialog i odświeża rezerwacje (#33)', () => {
    const { http, comp } = setup('EMPLOYEE');
    const b = mkBooking({ id: 'b1' });
    bookingsReq(http).flush([b]);
    comp.openDetails(b);

    comp.onBookingConflict({ id: 'b1' });
    expect(comp.selectedBooking()).toBeNull();

    bookingsReq(http).flush([]);
  });

  // regresja code-review #33: spóźniona odpowiedź na akcję dla A nie może zamknąć dialogu,
  // jeśli użytkownik w międzyczasie zamknął A i otworzył inną rezerwację (B)
  it('onBookingChanged/onBookingConflict dla nieaktualnego id nie zamyka dialogu innej rezerwacji', async () => {
    const { http, comp } = setup('EMPLOYEE');
    const a = mkBooking({ id: 'a1' });
    const b = mkBooking({ id: 'b1' });
    bookingsReq(http).flush([a, b]);
    await tick();

    comp.openDetails(b);
    expect(comp.selectedBooking()).toEqual(b);

    // spóźniona odpowiedź dotyczy 'a1', ale dialog pokazuje już 'b1'
    comp.onBookingChanged({ id: 'a1', status: 'CONFIRMED' });
    expect(comp.selectedBooking()).toEqual(b);
    expect(comp.bookings().find((x) => x.id === 'a1')?.status).toBe('CONFIRMED');

    comp.onBookingConflict({ id: 'a1' });
    expect(comp.selectedBooking()).toEqual(b);

    bookingsReq(http).flush([]);
  });
});
