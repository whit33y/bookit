import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import BusinessLogo from './business-logo';

// wejścia gospodarza jako sygnały, nie zwykłe pola: przy domyślnym OnPush podmiana pola
// w trakcie testu nie oznaczyłaby gospodarza jako brudnego i szablon nie przeliczyłby się
@Component({
  imports: [BusinessLogo],
  template: `
    <app-business-logo
      class="h-14 w-14"
      [name]="name()"
      [src]="src()"
      [eager]="eager()"
    />
  `,
})
class Host {
  readonly name = signal('Studio Fryzur');
  readonly src = signal<string | null>(null);
  readonly eager = signal(false);
}

async function setup(src: string | null = null) {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.src.set(src);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  return { fixture, root, box: root.querySelector('app-business-logo')! };
}

describe('BusinessLogo', () => {
  it('pokazuje logo firmy, gdy jest adres', async () => {
    const { root } = await setup('/api/businesses/b1/images/logo?v=abc');

    const img = root.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/businesses/b1/images/logo?v=abc');
    // alt opisuje firmę, a nie rodzaj pliku — „logo firmy X" nic nie wnosi ponad nazwę
    expect(img?.getAttribute('alt')).toBe('Studio Fryzur');
    expect(root.textContent?.trim()).toBe('');
  });

  it('bez adresu pokazuje monogram, a nie pustą ramkę', async () => {
    const { root } = await setup();

    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent?.trim()).toBe('SF');
  });

  // monogram to zastępnik wizualny; nazwa firmy stoi obok w nagłówku albo w linku,
  // więc czytnik ekranu nie ma go czytać po literach
  it('monogram jest ukryty przed czytnikiem ekranu', async () => {
    const { box } = await setup();

    expect(box.querySelector('span')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('kafelek ma rozmiar niezależny od tego, czy obraz się wczytał', async () => {
    const { fixture, box } = await setup();

    // rozmiar niesie host, a nie zawartość: ten sam węzeł DOM zostaje na miejscu przy
    // przełączeniu monogram → obraz, a obraz wypełnia go, zamiast narzucać własne wymiary
    const monogramBox = box;
    expect(monogramBox.className).toContain('shrink-0');
    expect(monogramBox.className).toContain('h-14 w-14');

    fixture.componentInstance.src.set('/api/businesses/b1/images/logo?v=a');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-business-logo'),
    ).toBe(monogramBox);
    const img = monogramBox.querySelector('img')!;
    expect(img.className).toContain('h-full w-full object-cover');
    expect(img.hasAttribute('width')).toBe(false);
  });

  // 404 zdarza się realnie: obraz można usunąć między pobraniem listy a pobraniem bajtów
  it('obraz, który się nie wczytał, wraca do monogramu', async () => {
    const { fixture, root } = await setup('/api/businesses/b1/images/logo?v=a');

    root.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent?.trim()).toBe('SF');
  });

  it('nowy adres dostaje własną szansę po błędzie poprzedniego', async () => {
    const { fixture, root } = await setup('/api/businesses/b1/images/logo?v=a');
    root.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    // ta sama pozycja listy, inna firma — nie dziedziczy porażki poprzedniej
    fixture.componentInstance.src.set('/api/businesses/b2/images/logo?v=b');
    fixture.detectChanges();

    expect(root.querySelector('img')?.getAttribute('src')).toBe(
      '/api/businesses/b2/images/logo?v=b',
    );
  });

  it('leniwie na liście, pilnie tam, gdzie logo jest nad linią zgięcia', async () => {
    const { fixture, root } = await setup('/api/businesses/b1/images/logo?v=a');
    expect(root.querySelector('img')?.getAttribute('loading')).toBe('lazy');

    fixture.componentInstance.eager.set(true);
    fixture.detectChanges();
    expect(root.querySelector('img')?.hasAttribute('loading')).toBe(false);
  });
});
