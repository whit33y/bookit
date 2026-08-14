import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Route } from '@angular/router';
import { describe, expect, it } from 'vitest';
import Footer from './footer';

/** Atrapa ekranu — `routerLink` renderuje `href` tylko dla tras, które router zna. */
@Component({ template: '' })
class StubPage {}

/** Trasy istotne dla stopki, w tym samym kształcie co `app.routes.ts` (bez `:slug` i `**`). */
const APP_ROUTES: Route[] = [
  { path: '', component: StubPage },
  { path: 'search', component: StubPage },
  { path: 'create-business', component: StubPage },
  { path: 'client', component: StubPage },
  { path: 'business', component: StubPage },
];

async function setup(routes: Route[] = APP_ROUTES) {
  await TestBed.configureTestingModule({
    imports: [Footer],
    providers: [provideRouter(routes)],
  }).compileComponents();

  const fixture = TestBed.createComponent(Footer);
  await fixture.whenStable();

  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    el,
    footer: () => el.querySelector('footer'),
    columns: () => Array.from(el.querySelectorAll('footer nav')),
    href: (path: string) => el.querySelector(`footer a[href="${path}"]`),
  };
}

describe('Footer', () => {
  it('renderuje <footer> z etykietą dostępności (#126)', async () => {
    const { footer } = await setup();

    expect(footer()).not.toBeNull();
    expect(footer()?.getAttribute('aria-label')).toBe('Stopka');
  });

  it('pokazuje kolumny opisane własnym nagłówkiem (#126)', async () => {
    const { el, columns } = await setup();

    const titles = columns().map((nav) => {
      const id = nav.getAttribute('aria-labelledby');
      return el.querySelector(`#${id}`)?.textContent?.trim();
    });
    expect(titles).toEqual(['Dla klientów', 'Dla firm', 'Kontakt']);
  });

  it('linki wewnętrzne prowadzą do istniejących tras (#126)', async () => {
    const { href } = await setup();

    expect(href('/search')?.textContent).toContain('Wyszukiwarka');
    expect(href('/client')?.textContent).toContain('Moje wizyty');
    expect(href('/create-business')?.textContent).toContain('Załóż firmę');
    expect(href('/business')?.textContent).toContain('Panel firmy');
  });

  it('pozycja bez trasy w ogóle się nie renderuje (#126)', async () => {
    const { el, href } = await setup();

    expect(href('/help')).toBeNull();
    expect(href('/faq')).toBeNull();
    expect(el.textContent).not.toContain('Pomoc');
  });

  it('ta sama pozycja pojawia się, gdy trasa istnieje (#126)', async () => {
    const { href } = await setup([
      ...APP_ROUTES,
      { path: 'help', component: StubPage },
    ]);

    expect(href('/help')?.textContent).toContain('Pomoc');
  });

  it('kolumna kontaktowa ma adres e-mail jako link wychodzący (#126)', async () => {
    const { el } = await setup();

    const mail = el.querySelector('footer a[href^="mailto:"]');
    expect(mail?.getAttribute('href')).toBe('mailto:kontakt@bookit.pl');
    expect(mail?.textContent).toContain('kontakt@bookit.pl');
    expect(mail?.getAttribute('aria-label')).toContain('kontakt@bookit.pl');
  });

  it('nota o prawach autorskich zawiera bieżący rok (#126)', async () => {
    const { el } = await setup();

    expect(el.textContent).toContain(`© ${new Date().getFullYear()} BookIt`);
  });
});
