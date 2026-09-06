import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import NotificationBell from './notification-bell';
import { AppNotification } from './notifications-store';
import { verifyIgnoringProfile } from '../../core/auth/auth-testing';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

const notification = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1',
  type: 'BOOKING_CONFIRMED',
  title: 'Rezerwacja potwierdzona',
  body: 'Salon Ola potwierdziła wizytę Strzyżenie damskie.',
  url: '/client?booking=b1',
  readAt: null,
  createdAt: new Date().toISOString(),
  bookingId: 'b1',
  ...overrides,
});

const page = (items: AppNotification[], unread = items.filter((n) => !n.readAt).length) => ({
  items,
  total: items.length,
  page: 1,
  limit: 10,
  unread,
});

describe('NotificationBell', () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'CLIENT' }),
    );
    await TestBed.configureTestingModule({
      imports: [NotificationBell],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    verifyIgnoringProfile(TestBed.inject(HttpTestingController));
  });

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** Dzwoneczek startuje od licznika — każdy scenariusz zaczyna się jego odpowiedzią. */
  function setup(unread = 0) {
    const fixture = TestBed.createComponent(NotificationBell);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/notifications/unread-count').flush({ unread });
    return { fixture, http };
  }

  const trigger = (fixture: ComponentFixture<NotificationBell>) =>
    fixture.nativeElement.querySelector('button') as HTMLButtonElement;

  const panel = (fixture: ComponentFixture<NotificationBell>) =>
    fixture.nativeElement.querySelector('#notifications-panel') as HTMLElement | null;

  async function open(fixture: ComponentFixture<NotificationBell>, items: AppNotification[]) {
    trigger(fixture).click();
    await tick();
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/notifications')
      .flush(page(items));
    await tick();
    fixture.detectChanges();
  }

  it('plakietka pokazuje liczbę nieprzeczytanych, a etykieta mówi czego dotyczy', async () => {
    const { fixture } = setup(3);
    await tick();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('3');
    expect(trigger(fixture).getAttribute('aria-label')).toBe(
      'Powiadomienia — 3 nieprzeczytane powiadomienia',
    );
  });

  it('powyżej dziewiątki plakietka pokazuje 9+, ale etykieta dokładną liczbę', async () => {
    const { fixture } = setup(12);
    await tick();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('9+');
    expect(trigger(fixture).getAttribute('aria-label')).toContain(
      '12 nieprzeczytanych powiadomień',
    );
  });

  it('brak nieprzeczytanych → bez plakietki', async () => {
    const { fixture } = setup(0);
    await tick();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('0');
    expect(trigger(fixture).getAttribute('aria-label')).toBe(
      'Powiadomienia — brak nieprzeczytanych',
    );
  });

  it('otwarcie panelu pobiera listę i przełącza aria-expanded', async () => {
    const { fixture } = setup(1);
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');

    await open(fixture, [notification()]);

    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(panel(fixture)?.textContent).toContain('Rezerwacja potwierdzona');
    expect(panel(fixture)?.textContent).toContain('Salon Ola potwierdziła wizytę');
  });

  it('nieprzeczytane ma marker tekstowy, nie tylko kolor (WCAG 1.4.1)', async () => {
    const { fixture } = setup(1);
    await open(fixture, [notification()]);

    expect(panel(fixture)?.querySelector('.sr-only')?.textContent).toContain(
      'nieprzeczytane',
    );
  });

  it('pusta lista pokazuje komunikat, nie pustą kartę', async () => {
    const { fixture } = setup(0);
    await open(fixture, []);

    expect(panel(fixture)?.textContent).toContain('Brak powiadomień.');
  });

  it('błąd listy pokazuje komunikat z możliwością ponowienia', async () => {
    const { fixture, http } = setup(0);
    trigger(fixture).click();
    await tick();
    fixture.detectChanges();
    http
      .expectOne('/api/notifications')
      .flush({ message: 'Nie udało się' }, { status: 500, statusText: 'Server Error' });
    await tick();
    fixture.detectChanges();

    expect(panel(fixture)?.querySelector('[role="alert"]')?.textContent).toBeTruthy();

    const retry = Array.from(panel(fixture)?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === 'Spróbuj ponownie',
    ) as HTMLButtonElement | undefined;
    retry?.click();
    await tick();
    http.expectOne('/api/notifications').flush(page([notification()]));
    await tick();
    fixture.detectChanges();

    expect(panel(fixture)?.textContent).toContain('Rezerwacja potwierdzona');
  });

  it('klik w powiadomienie oznacza je jako przeczytane i prowadzi do wizyty', async () => {
    const { fixture, http } = setup(1);
    await open(fixture, [notification()]);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const link = panel(fixture)?.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/client?booking=b1');
    link.click();
    await tick();
    fixture.detectChanges();

    http.expectOne('/api/notifications/n1/read').flush({ id: 'n1', readAt: 'now' });
    expect(navigate).toHaveBeenCalledWith('/client?booking=b1');
    // panel zamyka się razem z nawigacją
    expect(panel(fixture)).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('1');
  });

  it('Escape zamyka panel i oddaje fokus przyciskowi', async () => {
    const { fixture } = setup(1);
    await open(fixture, [notification()]);

    fixture.nativeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();

    expect(panel(fixture)).toBeNull();
    expect(document.activeElement).toBe(trigger(fixture));
  });

  it('klik poza dzwoneczkiem zamyka panel', async () => {
    const { fixture } = setup(1);
    await open(fixture, [notification()]);

    document.body.click();
    fixture.detectChanges();

    expect(panel(fixture)).toBeNull();
  });

  it('„Oznacz wszystkie" zeruje licznik i chowa akcję', async () => {
    const { fixture, http } = setup(2);
    await open(fixture, [notification({ id: 'n1' }), notification({ id: 'n2' })]);

    const markAll = Array.from(panel(fixture)?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === 'Oznacz wszystkie',
    ) as HTMLButtonElement;
    markAll.click();
    await tick();
    fixture.detectChanges();

    http.expectOne('/api/notifications/read-all').flush({ updated: 2 });
    expect(
      Array.from(panel(fixture)?.querySelectorAll('button') ?? []).some(
        (b) => b.textContent?.trim() === 'Oznacz wszystkie',
      ),
    ).toBe(false);
  });
});
