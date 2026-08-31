import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import DashboardTile, { type TileState } from './dashboard-tile';

/** Treść rzutowana w slot — musi znikać w stanach zastępczych. */
const CONTENT = 'Dziś 3 wizyty';

@Component({
  imports: [DashboardTile],
  template: `
    <app-dashboard-tile
      [heading]="heading()"
      [link]="link()"
      [state]="state()"
      [errorMessage]="errorMessage()"
      [noticeTitle]="noticeTitle()"
      [noticeCta]="noticeCta()"
      (retry)="retries.update((n) => n + 1)"
    >
      <p>{{ CONTENT }}</p>
    </app-dashboard-tile>
  `,
})
class TileHost {
  protected readonly CONTENT = CONTENT;
  readonly heading = signal('Kalendarz');
  readonly link = signal('/business/calendar');
  readonly state = signal<TileState>('content');
  readonly errorMessage = signal('');
  readonly noticeTitle = signal('');
  readonly noticeCta = signal('');
  readonly retries = signal(0);
}

/**
 * Kafelek dostaje wejścia przez gospodarza, bo tylko tak da się sprawdzić rzutowanie slotu.
 * Gospodarz trzyma je w sygnałach: `componentRef.setInput()` brudzi komponent sam z siebie,
 * ale zwykłe przypisanie do pola gospodarza już nie — a aplikacja jest zoneless.
 */
async function render(arrange: (host: TileHost) => void = () => undefined) {
  await TestBed.configureTestingModule({
    imports: [TileHost],
    providers: [provideRouter([{ path: '**', children: [] }])],
  }).compileComponents();
  const fixture = TestBed.createComponent(TileHost);
  arrange(fixture.componentInstance);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, host: fixture.componentInstance };
}

/** Wszystko, co łapie tabulator — AC „jeden przystanek na kafelek". */
const focusable = (el: HTMLElement) =>
  el.querySelectorAll('a, button, input, select, textarea, [tabindex]');

describe('DashboardTile', () => {
  it('tytuł jest nagłówkiem i jednocześnie treścią linku kafelka', async () => {
    const { el } = await render();
    const link = el.querySelector('h2 a');

    expect(link?.textContent).toContain('Kalendarz');
    expect(link?.getAttribute('href')).toBe('/business/calendar');
  });

  it('cały kafelek jest jednym linkiem — nakładka na całą kartę, jeden przystanek tabulatora', async () => {
    const { el } = await render();
    const link = el.querySelector('h2 a');

    // stretched link: pseudoelement linku przykrywa kartę, zamiast opakowywać ją w <a>
    expect(link?.className).toContain('after:absolute');
    expect(link?.className).toContain('after:inset-0');
    expect(focusable(el)).toHaveLength(1);
  });

  it('nie zagnieżdża linku w linku', async () => {
    const { el } = await render();

    expect(el.querySelectorAll('a a')).toHaveLength(0);
  });

  it('w stanie ładowania pokazuje app-loading-state zamiast treści', async () => {
    const { el } = await render((host) => host.state.set('loading'));

    expect(el.querySelector('[role="status"]')).not.toBeNull();
    expect(el.textContent).not.toContain(CONTENT);
  });

  it('w stanie błędu zachowuje tytuł i link, a komunikat pokazuje jako alert', async () => {
    const { el } = await render((host) => {
      host.state.set('error');
      host.errorMessage.set('Nie udało się pobrać');
    });

    expect(el.querySelector('h2 a')?.getAttribute('href')).toBe(
      '/business/calendar',
    );
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Nie udało się pobrać',
    );
    expect(el.textContent).not.toContain(CONTENT);
  });

  it('błąd daje przycisk „Spróbuj ponownie", który emituje retry', async () => {
    const { el, host } = await render((host) => {
      host.state.set('error');
      host.errorMessage.set('Błąd');
    });
    const button = el.querySelector('button');

    expect(button?.textContent?.trim()).toBe('Spróbuj ponownie');
    button?.click();
    expect(host.retries()).toBe(1);
  });

  it('w stanie pustym pokazuje app-empty-state z CTA, nadal bez drugiego linku', async () => {
    const { el } = await render((host) => {
      host.state.set('empty');
      host.noticeTitle.set('Brak wizyt na dziś.');
      host.noticeCta.set('Otwórz kalendarz');
    });
    const text = el.textContent ?? '';

    expect(text).toContain('Brak wizyt na dziś.');
    expect(text).toContain('Otwórz kalendarz');
    // CTA jest tekstem, nie odnośnikiem — kafelek już linkuje w to samo miejsce
    expect(focusable(el)).toHaveLength(1);
  });

  it('ostrzeżenie czyta te same wejścia co stan pusty, ale nie jest stanem pustym', async () => {
    const { el } = await render((host) => {
      host.state.set('warning');
      host.noticeTitle.set('Nie masz aktywnych usług.');
      host.noticeCta.set('Dodaj pierwszą usługę');
    });
    const text = el.textContent ?? '';

    expect(text).toContain('Nie masz aktywnych usług.');
    expect(text).toContain('Dodaj pierwszą usługę');
    expect(text).not.toContain(CONTENT);
    // waga ostrzeżenia idzie zdaniem, nie samym kolorem (WCAG 1.4.1) — a app-empty-state
    // powiedziałoby „nic tu nie ma", gdy chodzi o „bez tego firma nie działa"
    expect(el.querySelector('app-empty-state')).toBeNull();
    expect(focusable(el)).toHaveLength(1);
  });

  it('w stanie treści rzutuje slot i nie pokazuje żadnego ze stanów zastępczych', async () => {
    const { el } = await render((host) => host.state.set('content'));

    expect(el.textContent).toContain(CONTENT);
    expect(el.querySelector('[role="status"]')).toBeNull();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('przełącza stany bez utraty tytułu', async () => {
    const { fixture, el, host } = await render((host) =>
      host.state.set('loading'),
    );

    host.state.set('content');
    fixture.detectChanges();

    expect(el.querySelector('h2 a')?.textContent).toContain('Kalendarz');
    expect(el.querySelector('[role="status"]')).toBeNull();
    expect(el.textContent).toContain(CONTENT);
  });
});
