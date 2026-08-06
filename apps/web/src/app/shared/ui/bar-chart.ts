import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  ChartConfiguration,
  LinearScale,
  Legend,
  Tooltip,
} from 'chart.js';

export interface BarChartSeries {
  label: string;
  data: number[];
  /** Kolor słupka — konkretna wartość CSS, bo canvas nie zna klas Tailwinda. */
  color: string;
}

export interface BarChartData {
  labels: string[];
  series: BarChartSeries[];
}

// Tylko potrzebne kontrolery — `registerables` doklada linie, kółka, radar i skale czasu,
// czyli kilkadziesiąt kilobajtów, których ten wykres nie używa.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip);

/**
 * Konfiguracja skumulowanego wykresu słupkowego. Czysta funkcja, żeby dała się przetestować
 * bez DOM — sam canvas w jsdom nie ma kontekstu 2D.
 */
export function toStackedBarConfig(data: BarChartData): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: data.series.map((series) => ({
        label: series.label,
        data: series.data,
        backgroundColor: series.color,
        borderWidth: 0,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // wykres jest duplikatem tabeli sr-only, więc jego własne aria nie jest potrzebne
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12 } },
        tooltip: { itemSort: (a, b) => b.datasetIndex - a.datasetIndex },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        // liczba rezerwacji jest całkowita — bez tego oś dorabia 0,5 przy małych wartościach
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  };
}

/**
 * Cienki wrapper na chart.js (#56). Wykres jest tylko warstwą wizualną: te same liczby stoją
 * w tabeli `sr-only`, która niesie informację dla czytników ekranu i dla przypadków bez canvasa
 * (WCAG 1.4.1 — kolor i długość słupka nie mogą być jedynym nośnikiem).
 */
@Component({
  selector: 'app-bar-chart',
  host: { class: 'block' },
  template: `
    <div class="relative h-64" [style.height.px]="heightPx()">
      <canvas #canvas aria-hidden="true"></canvas>
    </div>

    <table class="sr-only">
      <caption>
        {{ caption() }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ categoryHeader() }}</th>
          @for (series of data().series; track series.label) {
            <th scope="col">{{ series.label }}</th>
          }
        </tr>
      </thead>
      <tbody>
        @for (label of data().labels; track label; let i = $index) {
          <tr>
            <th scope="row">{{ label }}</th>
            @for (series of data().series; track series.label) {
              <td>{{ series.data[i] }}</td>
            }
          </tr>
        }
      </tbody>
    </table>
  `,
})
export default class BarChart {
  readonly data = input.required<BarChartData>();
  readonly caption = input.required<string>();
  readonly categoryHeader = input('Okres');
  readonly heightPx = input(256);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart<'bar'> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());

    effect(() => {
      const config = toStackedBarConfig(this.data());
      if (this.chart) {
        // podmiana danych na istniejącym wykresie zamiast destroy/create — inaczej każda
        // zmiana zakresu miga na biało i gubi animację przejścia
        this.chart.data = config.data;
        this.chart.update();
        return;
      }
      // Brak kontekstu 2D: jsdom w testach, wyłączony canvas, egzotyczna przeglądarka.
      // Wykres wtedy nie powstaje, a strona i tak pokazuje pełne dane w tabeli sr-only —
      // to ona jest źródłem informacji, canvas ją tylko ilustruje.
      const context = this.canvas().nativeElement.getContext('2d');
      if (!context) {
        return;
      }
      this.chart = new Chart(context, config);
    });
  }
}
