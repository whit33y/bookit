import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// ponytail: placeholder — kalendarz/usługi/pracownicy to osobne issue
@Component({
  selector: 'app-business-dashboard',
  imports: [RouterLink],
  template: `
    <h1>Panel firmy</h1>
    <a routerLink="/business/settings" class="text-brand-600 underline"
      >Ustawienia firmy</a
    >
  `,
})
export default class BusinessDashboard {}
