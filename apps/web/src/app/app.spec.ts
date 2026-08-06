import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      // provideHttpClientTesting() dodane dla #33 (licznik oczekujących w nawigacji) — dla
      // niezalogowanego usera PendingCountStore.refresh() nie robi requestu, więc istniejący
      // test poniżej działa bez zmian
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('renderuje nawigację z linkiem logowania dla niezalogowanego', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav')?.textContent).toContain('Zaloguj');
  });

  it('niezalogowany nie ma dzwoneczka powiadomień (#54)', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('app-notification-bell')).toBeNull();
  });

  it('OWNER zalogowany — plakietka pokazuje liczbę oczekujących rezerwacji z API (#33)', async () => {
    localStorage.setItem(
      'bookit.accessToken',
      fakeJwt({ sub: '1', email: 'a@b.pl', role: 'OWNER' }),
    );
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    const req = http.expectOne((r) => r.url.startsWith('/api/businesses/mine/bookings'));
    req.flush([{ status: 'PENDING' }, { status: 'PENDING' }, { status: 'CONFIRMED' }]);
    // dzwoneczek (#54) odpytuje licznik nieprzeczytanych dla każdej zalogowanej roli —
    // bez tego flusha verify() w afterEach wywaliłby ten test na zaległym żądaniu
    http.expectOne('/api/notifications/unread-count').flush({ unread: 0 });
    await fixture.whenStable();
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('nav a[href="/business"]');
    expect(link?.textContent).toContain('Panel firmy');
    expect(link?.textContent).toContain('2');
    expect(fixture.nativeElement.querySelector('app-notification-bell')).not.toBeNull();
  });
});
