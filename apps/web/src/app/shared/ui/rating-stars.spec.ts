import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import RatingStars from './rating-stars';

async function render(inputs: Record<string, unknown>) {
  await TestBed.configureTestingModule({ imports: [RatingStars] }).compileComponents();
  const fixture = TestBed.createComponent(RatingStars);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return {
    label: () => el.querySelector('[aria-label]')?.getAttribute('aria-label'),
    filled: () => (el.textContent?.match(/★/g) ?? []).length,
    empty: () => (el.textContent?.match(/☆/g) ?? []).length,
    text: () => el.textContent ?? '',
  };
}

describe('RatingStars', () => {
  it('rysuje tyle wypełnionych gwiazdek, ile wynosi ocena', async () => {
    const ctx = await render({ value: 3 });

    expect(ctx.filled()).toBe(3);
    expect(ctx.empty()).toBe(2);
  });

  it('opisuje ocenę dla czytnika ekranu — same glify są aria-hidden', async () => {
    const ctx = await render({ value: 4 });

    expect(ctx.label()).toBe('Ocena 4 na 5');
  });

  it('średnią pokazuje z przecinkiem dziesiętnym i zaokrągla gwiazdki', async () => {
    const ctx = await render({ value: 4.6 });

    expect(ctx.label()).toBe('Ocena 4,6 na 5');
    expect(ctx.text()).toContain('4,6');
    expect(ctx.filled()).toBe(5);
  });

  // odmiana „opinia/opinie/opinii" wchodzi w grę dopiero na profilu firmy (#49), ale reguła
  // liczebnika jest łatwa do zepsucia przy nastkach — pilnujemy jej od razu
  it.each([
    [1, 'Ocena 5 na 5, 1 opinia'],
    [132, 'Ocena 5 na 5, 132 opinie'],
    [12, 'Ocena 5 na 5, 12 opinii'],
    [25, 'Ocena 5 na 5, 25 opinii'],
  ])('z liczbą opinii (%i) odmienia rzeczownik po polsku', async (count, expected) => {
    const ctx = await render({ value: 5, count });

    expect(ctx.label()).toBe(expected);
  });

  it('showValue=false zostawia same gwiazdki, ale etykieta nadal niesie liczbę', async () => {
    const ctx = await render({ value: 2, showValue: false });

    expect(ctx.text()).not.toContain('2 ');
    expect(ctx.label()).toBe('Ocena 2 na 5');
  });
});
