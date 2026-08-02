import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import RatingDistributionChart, { RatingDistribution } from './rating-distribution';

async function render(distribution: RatingDistribution) {
  await TestBed.configureTestingModule({
    imports: [RatingDistributionChart],
  }).compileComponents();

  const fixture = TestBed.createComponent(RatingDistributionChart);
  fixture.componentRef.setInput('distribution', distribution);
  fixture.detectChanges();

  const el = fixture.nativeElement as HTMLElement;
  return {
    rows: () => [...el.querySelectorAll<HTMLElement>('li')],
    listLabel: () => el.querySelector('ul')?.getAttribute('aria-label'),
    // pasek jest ozdobą — informację niesie etykieta na role="img" (jak w RatingStars)
    labels: () =>
      [...el.querySelectorAll('[role="img"]')].map((r) => r.getAttribute('aria-label')),
    barWidths: () =>
      [...el.querySelectorAll<HTMLElement>('.bg-brand-700')].map((b) => b.style.width),
    text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
  };
}

const DISTRIBUTION: RatingDistribution = { 1: 3, 2: 5, 3: 9, 4: 31, 5: 84 };

describe('RatingDistributionChart', () => {
  it('rysuje pięć stopni od najwyższego, z liczbą i udziałem', async () => {
    const ctx = await render(DISTRIBUTION);

    expect(ctx.rows()).toHaveLength(5);
    // 132 ocen łącznie: 84 → 64%, 31 → 23%, 9 → 7%, 5 → 4%, 3 → 2%
    expect(ctx.text()).toBe('5 ★ 84 · 64% 4 ★ 31 · 23% 3 ★ 9 · 7% 2 ★ 5 · 4% 1 ★ 3 · 2%');
  });

  it('szerokość paska zgadza się z procentem obok — dwa nośniki nie mogą sobie przeczyć', async () => {
    const ctx = await render(DISTRIBUTION);

    expect(ctx.barWidths()).toEqual(['64%', '23%', '7%', '4%', '2%']);
  });

  it('cała lista ma nazwę — w spisie elementów stoi obok listy opinii', async () => {
    const ctx = await render(DISTRIBUTION);

    expect(ctx.listLabel()).toBe('Rozkład ocen');
  });

  it('opisuje każdy stopień dla czytnika ekranu, z polską odmianą liczebnika', async () => {
    const ctx = await render({ 1: 1, 2: 2, 3: 12, 4: 0, 5: 5 });

    expect(ctx.labels()).toEqual([
      '5 gwiazdek: 5 opinii, 25% ocen',
      '4 gwiazdki: 0 opinii, 0% ocen',
      '3 gwiazdki: 12 opinii, 60% ocen',
      '2 gwiazdki: 2 opinie, 10% ocen',
      '1 gwiazdka: 1 opinia, 5% ocen',
    ]);
  });

  it('firma bez recenzji nie dostaje pustego histogramu', async () => {
    const ctx = await render({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

    expect(ctx.rows()).toHaveLength(0);
    expect(ctx.text()).toBe('');
  });

  it('stopień bez ocen daje pusty pasek, nie NaN%', async () => {
    const ctx = await render({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 4 });

    expect(ctx.text()).toContain('4 ★ 0 · 0%');
    expect(ctx.text()).not.toContain('NaN');
    expect(ctx.barWidths()).toEqual(['100%', '0%', '0%', '0%', '0%']);
  });
});
