import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import type { UserRole } from './core/auth/auth-store';

const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload))}.signature`;

/** Atrapa docelowych ekranów — `routerLinkActive` potrzebuje tras, które da się dopasować. */
@Component({ template: '' })
class StubPage {}

const login = (role: UserRole) =>
  localStorage.setItem('bookit.accessToken', fakeJwt({ sub: '1', email: 'a@b.pl', role }));

/** Zalogowanie uruchamia dzwoneczek (#54), a dla firmy też licznik oczekujących (#33) —
 *  bez flusha `verify()` w afterEach wywaliłby test na zaległym żądaniu. */
function flushNavRequests(pending: string[] = []) {
  const http = TestBed.inject(HttpTestingController);
  if (pending.length) {
    http
      .expectOne((r) => r.url.startsWith('/api/businesses/mine/bookings'))
      .flush(pending.map((status) => ({ status })));
  }
  http.expectOne('/api/notifications/unread-count').flush({ unread: 0 });
}

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      // provideHttpClientTesting() dodane dla #33 (licznik oczekujących w nawigacji) — dla
      // niezalogowanego usera PendingCountStore.refresh() nie robi requestu, więc istniejący
      // test poniżej działa bez zmian
      providers: [
        provideRouter([
          { path: 'client', component: StubPage },
          { path: 'business', component: StubPage },
          { path: 'admin', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
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
    login('OWNER');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    flushNavRequests(['PENDING', 'PENDING', 'CONFIRMED']);
    await fixture.whenStable();
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('nav a[href="/business"]');
    expect(link?.textContent).toContain('Panel firmy');
    expect(link?.textContent).toContain('2');
    expect(fixture.nativeElement.querySelector('app-notification-bell')).not.toBeNull();
  });

  it('CLIENT nie widzi panelu firmy ani admina (#125)', async () => {
    login('CLIENT');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    flushNavRequests();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav a[href="/client"]')).not.toBeNull();
    expect(el.querySelector('nav a[href="/business"]')).toBeNull();
    expect(el.querySelector('nav a[href="/admin"]')).toBeNull();
  });

  it('ADMIN widzi pozycję panelu admina (#125)', async () => {
    login('ADMIN');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    flushNavRequests();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav a[href="/admin"]')).not.toBeNull();
    expect(el.querySelector('nav a[href="/business"]')).toBeNull();
  });

  it('aktywna trasa dostaje aria-current="page" i pigułkę marki (#125)', async () => {
    login('CLIENT');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    flushNavRequests();
    await TestBed.inject(Router).navigateByUrl('/client');
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const active = el.querySelector('nav a[href="/client"]');
    expect(active?.getAttribute('aria-current')).toBe('page');
    expect(active?.className).toContain('bg-brand-50');
    expect(active?.className).toContain('text-brand-700');
  });

  it('hamburger rozwija i zwija menu mobilne (#125)', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const trigger = el.querySelector<HTMLButtonElement>(
      'button[aria-controls="main-menu"]',
    );

    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('#main-menu')).toBeNull();

    trigger?.click();
    fixture.detectChanges();
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('#main-menu')?.textContent).toContain('Zaloguj');

    trigger?.click();
    fixture.detectChanges();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('#main-menu')).toBeNull();
  });

  it('Escape zamyka menu mobilne i oddaje fokus hamburgerowi (#125)', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const trigger = el.querySelector<HTMLButtonElement>(
      'button[aria-controls="main-menu"]',
    );
    trigger?.click();
    fixture.detectChanges();

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(el.querySelector('#main-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('przejście na inną trasę zamyka menu mobilne (#125)', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('button[aria-controls="main-menu"]')?.click();
    fixture.detectChanges();
    expect(el.querySelector('#main-menu')).not.toBeNull();

    await TestBed.inject(Router).navigateByUrl('/client');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('#main-menu')).toBeNull();
  });
});
