import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import UserPhoto from './user-photo';

// wejścia gospodarza jako sygnały, nie zwykłe pola: przy domyślnym OnPush podmiana pola
// w trakcie testu nie oznaczyłaby gospodarza jako brudnego i szablon nie przeliczyłby się
@Component({
  imports: [UserPhoto],
  template: `
    <app-user-photo
      class="h-9 w-9"
      [src]="src()"
      [monogram]="monogram()"
      [alt]="alt()"
    />
  `,
})
class Host {
  readonly src = signal<string | null>(null);
  readonly monogram = signal('AK');
  readonly alt = signal('');
}

async function setup() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host: fixture.componentInstance,
    root,
    box: root.querySelector('app-user-photo')!,
    render: () => fixture.detectChanges(),
  };
}

describe('UserPhoto', () => {
  it('pokazuje zdjęcie profilowe, gdy jest adres', async () => {
    const ctx = await setup();
    ctx.host.src.set('/api/users/u1/avatar?v=abc123');
    ctx.render();

    expect(ctx.root.querySelector('img')?.getAttribute('src')).toBe(
      '/api/users/u1/avatar?v=abc123',
    );
    expect(ctx.root.textContent?.trim()).toBe('');
  });

  it('bez adresu pokazuje monogram, a nie pustą ramkę', async () => {
    const ctx = await setup();

    expect(ctx.root.querySelector('img')).toBeNull();
    expect(ctx.root.textContent?.trim()).toBe('AK');
  });

  // monogram to zastępnik wizualny; imię i nazwisko stoi obok — w podpisie recenzji,
  // w etykiecie przycisku menu — więc czytnik ekranu nie ma go czytać po literach
  it('monogram jest ukryty przed czytnikiem ekranu', async () => {
    const ctx = await setup();

    expect(ctx.box.querySelector('span')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('bez adresu i bez monogramu zostaje ikona sylwetki', async () => {
    const ctx = await setup();
    ctx.host.monogram.set('');
    ctx.render();

    expect(ctx.box.querySelector('svg')).not.toBeNull();
    expect(ctx.root.textContent?.trim()).toBe('');
  });

  it('pusty alt chowa zdjęcie przed czytnikiem ekranu, podany — opisuje je', async () => {
    const ctx = await setup();
    ctx.host.src.set('/api/users/u1/avatar?v=abc123');
    ctx.render();

    const img = () => ctx.root.querySelector('img')!;
    expect(img().getAttribute('alt')).toBe('');
    expect(img().getAttribute('aria-hidden')).toBe('true');

    ctx.host.alt.set('Twoje zdjęcie profilowe');
    ctx.render();

    expect(img().getAttribute('alt')).toBe('Twoje zdjęcie profilowe');
    expect(img().hasAttribute('aria-hidden')).toBe(false);
  });

  it('kafelek ma rozmiar niezależny od tego, czy obraz się wczytał', async () => {
    const ctx = await setup();

    // rozmiar niesie host, a nie zawartość: ten sam węzeł DOM zostaje na miejscu przy
    // przełączeniu monogram → obraz, a obraz wypełnia go, zamiast narzucać własne wymiary
    expect(ctx.box.className).toContain('shrink-0');
    expect(ctx.box.className).toContain('h-9 w-9');

    ctx.host.src.set('/api/users/u1/avatar?v=abc123');
    ctx.render();

    expect(ctx.root.querySelector('app-user-photo')).toBe(ctx.box);
    expect(ctx.box.querySelector('img')!.className).toContain('h-full w-full object-cover');
  });

  // 404 zdarza się realnie: zdjęcie można usunąć między pobraniem recenzji a pobraniem bajtów
  it('nieudane wczytanie obrazu wraca do monogramu', async () => {
    const ctx = await setup();
    ctx.host.src.set('/api/users/u1/avatar?v=abc123');
    ctx.render();

    ctx.box.querySelector('img')!.dispatchEvent(new Event('error'));
    ctx.render();

    expect(ctx.box.querySelector('img')).toBeNull();
    expect(ctx.root.textContent?.trim()).toBe('AK');
  });

  it('nowa wersja zdjęcia dostaje własną szansę po nieudanym wczytaniu', async () => {
    const ctx = await setup();
    ctx.host.src.set('/api/users/u1/avatar?v=abc123');
    ctx.render();
    ctx.box.querySelector('img')!.dispatchEvent(new Event('error'));
    ctx.render();

    // wgranie nowego zdjęcia zmienia wersję w adresie — to inny obraz, więc próbujemy znowu
    ctx.host.src.set('/api/users/u1/avatar?v=def456');
    ctx.render();

    expect(ctx.box.querySelector('img')?.getAttribute('src')).toBe(
      '/api/users/u1/avatar?v=def456',
    );
  });
});
