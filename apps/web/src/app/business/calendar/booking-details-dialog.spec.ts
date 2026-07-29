import { TestBed } from '@angular/core/testing';
import BookingDetailsDialog, { CalendarBooking } from './booking-details-dialog';

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
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BookingDetailsDialog] });
  });

  function setup() {
    const fixture = TestBed.createComponent(BookingDetailsDialog);
    return fixture;
  }

  it('bez rezerwacji dialog nie jest otwarty', () => {
    const fixture = setup();
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    expect(dialog.textContent?.trim()).toBe('');
  });

  it('ustawienie booking otwiera dialog i renderuje dane rezerwacji', () => {
    const fixture = setup();
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
    const fixture = setup();
    fixture.componentRef.setInput('booking', { ...booking, clientNote: null });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Notatka klienta');
  });

  it('klik „Zamknij" zamyka dialog i emituje closed', () => {
    const fixture = setup();
    fixture.componentRef.setInput('booking', booking);
    fixture.detectChanges();

    let closedEmitted = false;
    fixture.componentInstance.closed.subscribe(() => (closedEmitted = true));

    const closeButton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    closeButton.click();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    expect(closedEmitted).toBe(true);
  });

  it('klik w tło (target === dialog) zamyka; klik w treść nie zamyka', () => {
    const fixture = setup();
    fixture.componentRef.setInput('booking', booking);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const content = dialog.querySelector('div') as HTMLElement;

    content.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(true);

    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(false);
  });
});
