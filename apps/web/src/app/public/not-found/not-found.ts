import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nStore } from '../../core/i18n/i18n-store';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <div class="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <p class="text-sm font-semibold uppercase tracking-wider text-brand-700">404</p>
      <h1 class="mt-2 text-2xl font-bold tracking-tight">
        {{ i18n.t('notFound.title') }}
      </h1>
      <p class="mt-2 max-w-md text-sm text-stone-500">
        {{ i18n.t('notFound.body') }}
      </p>
      <a routerLink="/" class="btn-primary mt-6">{{ i18n.t('notFound.home') }}</a>
    </div>
  `,
})
export default class NotFound {
  protected readonly i18n = inject(I18nStore);
}
