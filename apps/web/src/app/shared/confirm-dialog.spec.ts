import { ComponentFixture, TestBed } from '@angular/core/testing';
import ConfirmDialog from './confirm-dialog';

// jsdom nie implementuje showModal()/close() — ten sam lokalny polyfill co w
// business/calendar/booking-details-dialog.spec.ts
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

async function setup(open = true, busy = false) {
  await TestBed.configureTestingModule({
    imports: [ConfirmDialog],
  }).compileComponents();

  const fixture = TestBed.createComponent(ConfirmDialog);
  fixture.componentRef.setInput('open', open);
  fixture.componentRef.setInput('busy', busy);
  fixture.componentRef.setInput('heading', 'Zablokować firmę?');
  fixture.componentRef.setInput('message', 'Firma zniknie z wyszukiwarki.');
  fixture.componentRef.setInput('confirmLabel', 'Zablokuj firmę');
  fixture.componentRef.setInput('busyLabel', 'Blokowanie…');
  fixture.detectChanges();

  const cancelled: number[] = [];
  const confirmed: number[] = [];
  fixture.componentInstance.cancelled.subscribe(() => cancelled.push(1));
  fixture.componentInstance.confirmed.subscribe(() => confirmed.push(1));

  return { fixture, cancelled, confirmed };
}

const dialogOf = (fixture: ComponentFixture<ConfirmDialog>) =>
  (fixture.nativeElement as HTMLElement).querySelector(
    'dialog',
  ) as HTMLDialogElement;

const buttonWith = (fixture: ComponentFixture<ConfirmDialog>, label: string) =>
  Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
  ).find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;

/** Escape na natywnym <dialog> to zdarzenie `cancel`, którego domyślną akcją jest zamknięcie. */
function pressEscape(fixture: ComponentFixture<ConfirmDialog>): Event {
  const event = new Event('cancel', { cancelable: true });
  dialogOf(fixture).dispatchEvent(event);
  if (!event.defaultPrevented) {
    dialogOf(fixture).close();
  }
  fixture.detectChanges();
  return event;
}

describe('ConfirmDialog', () => {
  it('otwiera się i zamyka razem z wejściem open()', async () => {
    const { fixture } = await setup(false);
    expect(dialogOf(fixture).hasAttribute('open')).toBe(false);

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(dialogOf(fixture).hasAttribute('open')).toBe(true);
  });

  it('zamknięcie przez rodzica nie zgłasza anulowania — akcja już się rozliczyła', async () => {
    const { fixture, cancelled } = await setup(true);

    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();

    expect(dialogOf(fixture).hasAttribute('open')).toBe(false);
    expect(cancelled).toHaveLength(0);
  });

  it('Escape zamyka modal i zgłasza anulowanie, gdy nic nie leci na serwer', async () => {
    const { fixture, cancelled } = await setup(true, false);

    const event = pressEscape(fixture);

    expect(event.defaultPrevented).toBe(false);
    expect(cancelled).toHaveLength(1);
  });

  it('Escape w trakcie zapytania nie zamyka modala — akcja i tak by się dokończyła', async () => {
    const { fixture, cancelled } = await setup(true, true);

    const event = pressEscape(fixture);

    expect(event.defaultPrevented).toBe(true);
    expect(dialogOf(fixture).hasAttribute('open')).toBe(true);
    expect(cancelled).toHaveLength(0);
  });

  it('klik w tło zamyka modal, ale nie w trakcie zapytania', async () => {
    const { fixture, cancelled } = await setup(true, true);
    dialogOf(fixture).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(dialogOf(fixture).hasAttribute('open')).toBe(true);
    expect(cancelled).toHaveLength(0);

    fixture.componentRef.setInput('busy', false);
    fixture.detectChanges();
    dialogOf(fixture).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(dialogOf(fixture).hasAttribute('open')).toBe(false);
    expect(cancelled).toHaveLength(1);
  });

  it('w trakcie zapytania blokuje przyciski i pokazuje etykietę postępu', async () => {
    const { fixture, confirmed } = await setup(true, true);

    expect(buttonWith(fixture, 'Blokowanie…').disabled).toBe(true);
    expect(buttonWith(fixture, 'Wróć').disabled).toBe(true);
    expect(buttonWith(fixture, 'Zablokuj firmę')).toBeUndefined();
    expect(confirmed).toHaveLength(0);
  });

  it('potwierdzenie zgłasza rodzicowi decyzję, nie zamykając modala samo z siebie', async () => {
    const { fixture, confirmed, cancelled } = await setup(true, false);

    buttonWith(fixture, 'Zablokuj firmę').click();
    fixture.detectChanges();

    expect(confirmed).toHaveLength(1);
    expect(cancelled).toHaveLength(0);
    // modal zostaje otwarty — rodzic zamknie go dopiero po odpowiedzi serwera
    expect(dialogOf(fixture).hasAttribute('open')).toBe(true);
  });

  it('opisuje treść modala dla czytnika ekranu', async () => {
    const { fixture } = await setup(true);
    const dialog = dialogOf(fixture);

    const labelledBy = dialog.getAttribute('aria-labelledby');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(`#${labelledBy}`)
        ?.textContent,
    ).toContain('Zablokować firmę?');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(`#${describedBy}`)
        ?.textContent,
    ).toContain('Firma zniknie z wyszukiwarki.');
  });
});
