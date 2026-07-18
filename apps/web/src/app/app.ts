import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthStore } from './core/auth/auth-store';

@Component({
  imports: [RouterOutlet, RouterLink],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly auth = inject(AuthStore);
  protected readonly role = computed(() => this.auth.user()?.role);
}
