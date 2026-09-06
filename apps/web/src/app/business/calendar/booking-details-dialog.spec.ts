import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import BookingDetailsDialog, { CalendarBooking } from './booking-details-dialog';
import { verifyIgnoringProfile } from '../../core/auth/auth-testing';

// jsdom 22 nie implementuje showModal()/close() na HTMLDialogElement — lokalny polyfill,
// nie globalny setup, żeby nie wyciekał do innych speców (jak vi.spyOn(globalThis, 'confirm')
// w my-bookings.spec.ts/employees.spec.ts)
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

const booking: CalendarBooking = {
  id: 'b1',
  startsAt: '2026-08-12T08:00:00Z',
  endsAt: '2026-08-12T08:30:00Z',
  status: 'CONFIRMED',
  clientNote: 'Proszę o przypomnienie SMS',
  client: { firstName: 'Jan', lastName: 'Kowalski', phone: '600100200' },
  service: {
    id: 's1',
    name: 'Strzyżenie',
    description: null,
    durationMin: 30,
    priceCents: 8000,
  },
  employee: { id: 'e1', name: 'Ola' },
};

describe('BookingDetailsDialog', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [BookingDetailsDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  afterEach(() => {
    verifyIgnoringProfile(TestBed.inject(HttpTestingController));
  });

  function setRole(role: 'OWNER' | 'EMPLOYEE'): void {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role }),
    );
  }

  function setup() {
    const fixture = TestBed.createComponent(BookingDetailsDialog);
    const http = TestBed.inject(HttpTestingController);
    return { fixture, http };
  }

  it('bez rezerwacji dialog nie jest otwarty', () => {
    const { fixture } = setup();
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    expect(dialog.textContent?.trim()).toBe('');
  });

  it('ustawienie booking otwiera dialog i renderuje dane rezerwacji', () => {
    const { fixture } = setup();
    fixture.componentRef.setInput('booking', booking);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    const text = dialog.textContent ?? '';
    expect(text).toContain('Strzyżenie');
    expect(text).toContain('Jan Kowalski');
    expect(text).toContain('600100200');
    expect(text).toContain('Potwierdzona');
    expect(text).toContain('Proszę o przypomnienie SMS');
    expect(text).toContain('80');
  });

  it('brak notatki — sekcja notatki nie renderuje się', () => {
    const { fixture } = setup();
    fixture.componentRef.setInput('booking', { ...booking, clientNote: null });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Notatka klienta');
  });

  it('klik „Zamknij" zamyka dialog i emituje closed', () => {
    const { fixture } = setup();
    fixture.componentRef.setInput('booking', booking);
    fixture.detectChanges();

    let closedEmitted = false;
    fixture.componentInstance.closed.subscribe(() => (closedEmitted = true));

    const closeButton = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => (b as HTMLButtonElement).textContent?.trim() === 'Zamknij') as
      | HTMLButtonElement
      | undefined;
    closeButton?.click();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    expect(closedEmitted).toBe(true);
  });

  it('klik w tło (target === dialog) zamyka; klik w treść nie zamyka', () => {
    const { fixture } = setup();
    fixture.componentRef.setInput('booking', booking);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const content = dialog.querySelector('div') as HTMLElement;

    content.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(true);

    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(false);
  });

  function findButton(fixture: { nativeElement: HTMLElement }, label: string) {
    return Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined;
  }

  it('EMPLOYEE nie widzi żadnych przycisków akcji, tylko Zamknij', () => {
    setRole('EMPLOYEE');
    const { fixture } = setup();
    fixture.componentRef.setInput('booking', { ...booking, status: 'PENDING' });
    fixture.detectChanges();

    expect(findButton(fixture, 'Zaakceptuj')).toBeUndefined();
    expect(findButton(fixture, 'Odrzuć')).toBeUndefined();
    expect(findButton(fixture, 'Odwołaj')).toBeUndefined();
    expect(findButton(fixture, 'Zamknij')).toBeDefined();
  });

  it('OWNER, rezerwacja PENDING — widoczne Zaakceptuj/Odrzuć/Odwołaj', () => {
    setRole('OWNER');
    const { fixture } = setup();
    fixture.componentRef.setInput('booking', { ...booking, status: 'PENDING' });
    fixture.detectChanges();

    expect(findButton(fixture, 'Zaakceptuj')).toBeDefined();
    expect(findButton(fixture, 'Odrzuć')).toBeDefined();
    expect(findButton(fixture, 'Odwołaj')).toBeDefined();
  });

  it('OWNER, rezerwacja CONFIRMED — tylko Odwołaj, bez Zaakceptuj/Odrzuć', () => {
    setRole('OWNER');
    const { fixture } = setup();
    fixture.componentRef.setInput('booking', { ...booking, status: 'CONFIRMED' });
    fixture.detectChanges();

    expect(findButton(fixture, 'Zaakceptuj')).toBeUndefined();
    expect(findButton(fixture, 'Odrzuć')).toBeUndefined();
    expect(findButton(fixture, 'Odwołaj')).toBeDefined();
  });

  it('OWNER, rezerwacja DECLINED — brak przycisków akcji', () => {
    setRole('OWNER');
    const { fixture } = setup();
    fixture.componentRef.setInput('booking', { ...booking, status: 'DECLINED' });
    fixture.detectChanges();

    expect(findButton(fixture, 'Zaakceptuj')).toBeUndefined();
    expect(findButton(fixture, 'Odrzuć')).toBeUndefined();
    expect(findButton(fixture, 'Odwołaj')).toBeUndefined();
  });

  it('klik „Zaakceptuj" woła POST confirm i emituje changed', async () => {
    setRole('OWNER');
    const { fixture, http } = setup();
    fixture.componentRef.setInput('booking', { ...booking, status: 'PENDING' });
    fixture.detectChanges();

    let emitted: unknown = null;
    fixture.componentInstance.changed.subscribe((e) => (emitted = e));

    findButton(fixture, 'Zaakceptuj')?.click();

    const req = http.expectOne('/api/bookings/b1/confirm');
    expect(req.request.method).toBe('POST');
    req.flush({ id: 'b1', status: 'CONFIRMED' });
    await Promise.resolve();

    expect(emitted).toEqual({ id: 'b1', status: 'CONFIRMED' });
  });

  it('klik „Odrzuć" woła POST decline i emituje changed', async () => {
    setRole('OWNER');
    const { fixture, http } = setup();
    fixture.componentRef.setInput('booking', { ...booking, status: 'PENDING' });
    fixture.detectChanges();

    let emitted: unknown = null;
    fixture.componentInstance.changed.subscribe((e) => (emitted = e));

    findButton(fixture, 'Odrzuć')?.click();

    const req = http.expectOne('/api/bookings/b1/decline');
    req.flush({ id: 'b1', status: 'DECLINED' });
    await Promise.resolve();

    expect(emitted).toEqual({ id: 'b1', status: 'DECLINED' });
  });

  it('„Odwołaj" wymaga potwierdzenia przed wysłaniem żądania', () => {
    setRole('OWNER');
    const { fixture, http } = setup();
    fixture.componentRef.setInput('booking', { ...booking, status: 'CONFIRMED' });
    fixture.detectChanges();

    findButton(fixture, 'Odwołaj')?.click();
    fixture.detectChanges();

    http.expectNone('/api/bookings/b1/cancel-by-business');
    expect(fixture.nativeElement.textContent).toContain('Na pewno odwołać');

    findButton(fixture, 'Tak, odwołaj')?.click();
    const req = http.expectOne('/api/bookings/b1/cancel-by-business');
    req.flush({ id: 'b1', status: 'CANCELLED_BY_BUSINESS' });
  });

  it('„Odwołaj" → „Anuluj" wraca bez wysłania żądania', () => {
    setRole('OWNER');
    const { fixture, http } = setup();
    fixture.componentRef.setInput('booking', { ...booking, status: 'CONFIRMED' });
    fixture.detectChanges();

    findButton(fixture, 'Odwołaj')?.click();
    fixture.detectChanges();
    findButton(fixture, 'Anuluj')?.click();
    fixture.detectChanges();

    http.expectNone('/api/bookings/b1/cancel-by-business');
    expect(findButton(fixture, 'Odwołaj')).toBeDefined();
  });

  it('409 przy akcji emituje conflict zamiast changed', async () => {
    setRole('OWNER');
    const { fixture, http } = setup();
    fixture.componentRef.setInput('booking', { ...booking, status: 'PENDING' });
    fixture.detectChanges();

    let changedEmitted = false;
    let conflictEmitted = false;
    fixture.componentInstance.changed.subscribe(() => (changedEmitted = true));
    fixture.componentInstance.conflict.subscribe(() => (conflictEmitted = true));

    findButton(fixture, 'Zaakceptuj')?.click();
    http
      .expectOne('/api/bookings/b1/confirm')
      .flush(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Status rezerwacji zmienił się w międzyczasie',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await Promise.resolve();

    expect(changedEmitted).toBe(false);
    expect(conflictEmitted).toBe(true);
  });

  it('błąd inny niż 409 pokazuje komunikat, nie zamyka dialogu ani nie emituje conflict', async () => {
    setRole('OWNER');
    const { fixture, http } = setup();
    fixture.componentRef.setInput('booking', { ...booking, status: 'PENDING' });
    fixture.detectChanges();

    let conflictEmitted = false;
    fixture.componentInstance.conflict.subscribe(() => (conflictEmitted = true));

    findButton(fixture, 'Odrzuć')?.click();
    http
      .expectOne('/api/bookings/b1/decline')
      .flush(
        { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Serwer nie odpowiada' },
        { status: 500, statusText: 'Server Error' },
      );
    await Promise.resolve();
    fixture.detectChanges();

    expect(conflictEmitted).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Serwer nie odpowiada');
  });
});
