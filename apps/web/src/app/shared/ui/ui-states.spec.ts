import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import EmptyState from './empty-state';
import ErrorState from './error-state';
import LoadingState from './loading-state';

async function render<T extends object>(
  component: new (...args: never[]) => T,
  inputs: Record<string, unknown>,
) {
  await TestBed.configureTestingModule({ imports: [component] }).compileComponents();
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges();
  return fixture;
}

describe('LoadingState', () => {
  it('ogłasza ładowanie przez role="status"', async () => {
    const fixture = await render(LoadingState, { message: 'Ładowanie wizyt…' });
    const status = (fixture.nativeElement as HTMLElement).querySelector('[role="status"]');

    expect(status?.textContent?.trim()).toBe('Ładowanie wizyt…');
  });
});

describe('ErrorState', () => {
  it('pokazuje komunikat jako alert', async () => {
    const fixture = await render(ErrorState, { message: 'Nie znaleziono firmy' });
    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');

    expect(alert?.textContent?.trim()).toBe('Nie znaleziono firmy');
  });

  it('nie pokazuje przycisku ponowienia, gdy retry nie ma sensu', async () => {
    const fixture = await render(ErrorState, { message: 'Błąd' });

    expect((fixture.nativeElement as HTMLElement).querySelector('button')).toBeNull();
  });

  it('emituje retry po kliknięciu', async () => {
    const fixture = await render(ErrorState, { message: 'Błąd', retryable: true });
    const retries: number[] = [];
    fixture.componentInstance.retry.subscribe(() => retries.push(1));

    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();

    expect(retries).toHaveLength(1);
  });
});

describe('EmptyState', () => {
  it('pokazuje tytuł i opis', async () => {
    const fixture = await render(EmptyState, {
      title: 'Brak wyników dla podanych filtrów.',
      description: 'Spróbuj zmienić kategorię.',
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Brak wyników dla podanych filtrów.');
    expect(text).toContain('Spróbuj zmienić kategorię.');
  });

  it('nie renderuje pustego akapitu bez opisu', async () => {
    const fixture = await render(EmptyState, { title: 'Nie masz jeszcze usług.' });

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('p')).toHaveLength(1);
  });

  it('domyślnie jest zwykłym akapitem, bez ramki karty', async () => {
    const fixture = await render(EmptyState, { title: 'Pusto' });

    expect((fixture.nativeElement as HTMLElement).querySelector('.border')).toBeNull();
  });

  it('w wariancie boxed rysuje kartę', async () => {
    const fixture = await render(EmptyState, { title: 'Pusto', boxed: true });

    expect((fixture.nativeElement as HTMLElement).querySelector('.border')).not.toBeNull();
  });
});
