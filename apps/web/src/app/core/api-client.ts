import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';

/** Cienki wrapper na HttpClient z bazowym prefiksem /api (proxy dev → :3000). */
@Service()
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  get<T>(path: string) {
    return this.http.get<T>(this.base + path);
  }

  post<T>(path: string, body: unknown) {
    return this.http.post<T>(this.base + path, body);
  }

  patch<T>(path: string, body: unknown) {
    return this.http.patch<T>(this.base + path, body);
  }

  delete<T>(path: string) {
    return this.http.delete<T>(this.base + path);
  }
}
