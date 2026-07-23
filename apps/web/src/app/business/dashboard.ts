import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// ponytail: placeholder — kalendarz/usługi/pracownicy to osobne issue
@Component({
  selector: 'app-business-dashboard',
  imports: [RouterLink],
  template: `
    <h1>Panel firmy</h1>
    <nav class="flex gap-4">
      <a routerLink="/business/services" class="text-brand-600 underline"
        >Usługi</a
      >
      <a routerLink="/business/employees" class="text-brand-600 underline"
        >Pracownicy</a
      >
      <a routerLink="/business/settings" class="text-brand-600 underline"
        >Ustawienia firmy</a
      >
    </nav>
  `,
})
export default class BusinessDashboard {}
