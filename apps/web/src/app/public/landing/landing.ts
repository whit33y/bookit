import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';

interface Category {
  id: string;
  name: string;
  slug: string;
}

@Component({
  selector: 'app-landing',
  template: `
    <div class="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-4 py-12 text-center">
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Bookit</h1>
      <p class="mt-2 text-stone-500">Znajdź firmę i zarezerwuj wizytę online.</p>

      <form
        class="mt-8 w-full rounded-2xl border border-stone-200 bg-white p-6 text-left shadow-card"
        novalidate
        (submit)="onSubmit($event)"
      >
        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label for="category" class="mb-1.5 block text-sm font-medium">
              Kategoria
            </label>
            <select
              id="category"
              [value]="category()"
              (change)="onCategoryChange($event)"
              class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
            >
              <option value="">Wszystkie kategorie</option>
              @for (c of categories(); track c.id) {
                <option [value]="c.slug">{{ c.name }}</option>
              }
            </select>
            @if (categoriesError(); as msg) {
              <p class="mt-1.5 text-[13px] font-medium text-rose-600">{{ msg }}</p>
            }
          </div>

          <div>
            <label for="city" class="mb-1.5 block text-sm font-medium">Miasto</label>
            <input
              id="city"
              type="text"
              [value]="city()"
              (input)="onCityInput($event)"
              placeholder="np. Kraków"
              class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm placeholder-stone-400 shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>

          <div>
            <label for="q" class="mb-1.5 block text-sm font-medium">
              Czego szukasz?
            </label>
            <input
              id="q"
              type="text"
              [value]="q()"
              (input)="onQueryInput($event)"
              placeholder="np. strzyżenie"
              class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm placeholder-stone-400 shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>
        </div>

        <button type="submit" class="btn-primary mt-5">Szukaj</button>
      </form>
    </div>
  `,
})
export default class Landing {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);

  protected readonly categories = signal<Category[]>([]);
  protected readonly categoriesError = signal<string | null>(null);
  protected readonly category = signal('');
  protected readonly city = signal('');
  protected readonly q = signal('');

  constructor() {
    firstValueFrom(this.api.get<Category[]>('/categories'))
      .then((cats) => this.categories.set(cats))
      .catch((err) => {
        this.categories.set([]);
        // wyszukiwanie bez filtra kategorii nadal działa — błąd tylko informuje,
        // że lista kategorii akurat nie jest dostępna, nie blokuje formularza
        this.categoriesError.set(
          'Nie udało się wczytać listy kategorii. ' + apiErrorMessage(err),
        );
      });
  }

  protected onCategoryChange(event: Event): void {
    this.category.set((event.target as HTMLSelectElement).value);
  }

  protected onCityInput(event: Event): void {
    this.city.set((event.target as HTMLInputElement).value);
  }

  protected onQueryInput(event: Event): void {
    this.q.set((event.target as HTMLInputElement).value);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    const queryParams: Record<string, string> = {};
    if (this.category()) {
      queryParams['category'] = this.category();
    }
    if (this.city().trim()) {
      queryParams['city'] = this.city().trim();
    }
    if (this.q().trim()) {
      queryParams['q'] = this.q().trim();
    }
    this.router.navigate(['/search'], { queryParams });
  }
}
