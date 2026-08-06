import { TestBed } from '@angular/core/testing';
import BarChart, { BarChartData, toStackedBarConfig } from './bar-chart';

const data: BarChartData = {
  labels: ['pon., 3 sie', 'wt., 4 sie'],
  series: [
    { label: 'Zakończona', data: [2, 0], color: '#c2410c' },
    { label: 'Oczekująca', data: [1, 3], color: '#d97706' },
  ],
};

describe('toStackedBarConfig', () => {
  it('przepisuje serie na skumulowane słupki z zachowaniem kolejności i kolorów', () => {
    const config = toStackedBarConfig(data);

    expect(config.type).toBe('bar');
    expect(config.data.labels).toEqual(data.labels);
    expect(config.data.datasets.map((d) => d.label)).toEqual([
      'Zakończona',
      'Oczekująca',
    ]);
    expect(config.data.datasets[0].backgroundColor).toBe('#c2410c');
    expect(config.data.datasets[1].data).toEqual([1, 3]);
  });

  it('obie osie skumulowane, oś Y od zera i bez ułamków rezerwacji', () => {
    const { scales } = toStackedBarConfig(data).options ?? {};

    expect(scales?.x?.stacked).toBe(true);
    expect(scales?.y?.stacked).toBe(true);
    expect(scales?.y).toMatchObject({ beginAtZero: true, ticks: { precision: 0 } });
  });
});

describe('BarChart', () => {
  beforeEach(async () => {
    // jsdom nie implementuje getContext — komponent ma wtedy pominąć wykres i zostawić tabelę
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await TestBed.configureTestingModule({ imports: [BarChart] }).compileComponents();
  });

  it('renderuje tabelę sr-only z tymi samymi liczbami co wykres', async () => {
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('caption', 'Rezerwacje wg statusu: sierpień 2026');
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('table');
    expect(table.className).toContain('sr-only');
    expect(table.querySelector('caption').textContent).toContain('sierpień 2026');
    // nagłówek kategorii + po jednej kolumnie na serię
    expect(table.querySelectorAll('thead th')).toHaveLength(3);
    const firstRow = table.querySelectorAll('tbody tr')[0];
    expect(firstRow.querySelector('th').textContent).toContain('pon., 3 sie');
    expect(
      Array.from(firstRow.querySelectorAll('td'), (cell) =>
        (cell as HTMLElement).textContent?.trim(),
      ),
    ).toEqual(['2', '1']);
  });

  it('canvas jest ukryty dla czytników ekranu (informację niesie tabela)', async () => {
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('caption', 'Wykres');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('canvas').getAttribute('aria-hidden'),
    ).toBe('true');
  });
});
