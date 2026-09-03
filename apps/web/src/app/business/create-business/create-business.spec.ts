import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, WritableSignal, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import CreateBusiness from './create-business';
import { AuthStore } from '../../core/auth/auth-store';
import AppMap from '../../shared/map/map';

// Podmiana mapy — nie wołamy Leafletu (jsdom nie ma pełnego DOM/rozmiarów).
@Component({ selector: 'app-map', template: '' })
class MapStub {
  readonly lat = input<number | null>(null);
  readonly lng = input<number | null>(null);
}

const VALID_MODEL = {
  name: 'Salon Fryzjerski',
  categoryId: 'cat-1',
  description: '',
  phone: '',
  street: 'Główna 1',
  city: 'Kraków',
  postalCode: '',
};

const APPLICATION_URL = '/api/businesses/mine/application';
const CATEGORIES = [{ id: 'cat-1', name: 'Fryzjer', slug: 'fryzjer' }];

interface Application {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
}

/** Brak zgłoszenia API zgłasza 404 — dla ekranu to nie błąd, tylko „wypełnij formularz". */
function flushNoApplication(http: HttpTestingController): void {
  http.expectOne(APPLICATION_URL).flush(
    {
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Nie znaleziono zgłoszenia',
    },
    { status: 404, statusText: 'Not Found' },
  );
}

// dostęp do protected sygnałów komponentu w teście, bez `any`
interface TestAccess {
  model: WritableSignal<typeof VALID_MODEL>;
  coords: WritableSignal<{ lat: number; lng: number } | null>;
}

describe('CreateBusiness', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [CreateBusiness],
      providers: [
        // catch-all: po akceptacji ekran przekierowuje na /business
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    })
      .overrideComponent(CreateBusiness, {
        remove: { imports: [AppMap] },
        add: { imports: [MapStub] },
      })
      .compileComponents();
  });

  /** Ekran zaczyna od pobrania zgłoszenia; `null` = 404, czyli użytkownik bez zgłoszenia. */
  async function setup(application: Application | null = null) {
    const fixture = TestBed.createComponent(CreateBusiness);
    const http = TestBed.inject(HttpTestingController);
    if (application) {
      http.expectOne(APPLICATION_URL).flush(application);
    } else {
      flushNoApplication(http);
    }
    // firma ma kategorię — konstruktor pobiera słownik
    http.expectOne('/api/categories').flush(CATEGORIES);
    await fixture.whenStable();
    fixture.detectChanges();
    const comp = fixture.componentInstance as unknown as TestAccess;
    return { fixture, http, comp, el: fixture.nativeElement as HTMLElement };
  }

  it('brak zgłoszenia: formularz jak dotąd', async () => {
    const { el } = await setup();

    expect(el.querySelector('form')).not.toBeNull();
    expect(el.textContent).toContain('Załóż firmę');
    expect(el.textContent).not.toContain('czeka na akceptację');
  });

  it('PENDING: ekran „czeka na akceptację", bez formularza i bez akcji', async () => {
    const { el } = await setup({ status: 'PENDING', rejectionReason: null });

    expect(el.textContent).toContain('Zgłoszenie czeka na akceptację');
    expect(el.querySelector('form')).toBeNull();
    // wycofać zgłoszenia się nie da — na ekranie nie ma czego kliknąć
    expect(el.querySelector('button')).toBeNull();
  });

  it('REJECTED: powód odrzucenia nad pustym formularzem', async () => {
    const { el } = await setup({
      status: 'REJECTED',
      rejectionReason: 'Adres nie istnieje',
    });

    expect(el.textContent).toContain('Twoje zgłoszenie zostało odrzucone');
    expect(el.textContent).toContain('Adres nie istnieje');
    expect(el.querySelector('form')).not.toBeNull();
    // pola puste — to nowe zgłoszenie, nie edycja odrzuconego
    expect(el.querySelector<HTMLInputElement>('#name')?.value).toBe('');
    expect(el.querySelector<HTMLInputElement>('#street')?.value).toBe('');
  });

  it('REJECTED bez powodu: nadal widać, że zgłoszenie odrzucono', async () => {
    const { el } = await setup({ status: 'REJECTED', rejectionReason: null });

    expect(el.textContent).toContain('Twoje zgłoszenie zostało odrzucone');
    expect(el.querySelector('form')).not.toBeNull();
  });

  it('APPROVED: odświeżenie sesji i przekierowanie do panelu firmy', async () => {
    // refresh potrzebuje tokenu z poprzedniego logowania — rola w tokenie to wciąż CLIENT
    localStorage.setItem('bookit.refreshToken', 'refresh-token');
    const fixture = TestBed.createComponent(CreateBusiness);
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne(APPLICATION_URL)
      .flush({ status: 'APPROVED', rejectionReason: null });
    http.expectOne('/api/categories').flush(CATEGORIES);
    await fixture.whenStable();
    fixture.detectChanges();

    // bez nowego tokenu roleGuard odbiłby /business i użytkownik wróciłby na formularz
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('form'),
    ).toBeNull();
    http
      .expectOne('/api/auth/refresh')
      .flush({ accessToken: 'access', refreshToken: 'refresh' });
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/business');
  });

  it('nieudane pobranie zgłoszenia: komunikat i ponowna próba', async () => {
    const fixture = TestBed.createComponent(CreateBusiness);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(APPLICATION_URL).error(new ProgressEvent('error'), {
      status: 0,
      statusText: 'Unknown Error',
    });
    http.expectOne('/api/categories').flush(CATEGORIES);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Nie udało się sprawdzić statusu',
    );
    // dopóki nie wiemy, w jakim stanie jest zgłoszenie, formularza nie pokazujemy
    expect(el.querySelector('form')).toBeNull();

    el.querySelector<HTMLButtonElement>('button')?.click();
    await fixture.whenStable();
    flushNoApplication(http);
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('form')).not.toBeNull();
  });

  it('nieudane pobranie kategorii: komunikat i ponowna próba, nie ślepy zaułek', async () => {
    const fixture = TestBed.createComponent(CreateBusiness);
    const http = TestBed.inject(HttpTestingController);
    flushNoApplication(http);
    http.expectOne('/api/categories').error(new ProgressEvent('error'), {
      status: 0,
      statusText: 'Unknown Error',
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Nie udało się wczytać listy kategorii',
    );

    // kategoria jest wymagana — bez retry jedynym wyjściem byłoby przeładowanie strony
    const retry = [...el.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.includes('Spróbuj ponownie'),
    );
    retry?.click();
    await fixture.whenStable();

    http.expectOne('/api/categories').flush(CATEGORIES);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelectorAll('#categoryId option')).toHaveLength(2);
  });

  it('bez współrzędnych: nie wysyła żądania i pokazuje komunikat', async () => {
    const { fixture, http, comp, el } = await setup();
    comp.model.set({ ...VALID_MODEL }); // coords null
    await fixture.whenStable();

    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();

    http.expectNone('/api/businesses');
    expect(el.textContent).toContain('Najpierw znajdź adres na mapie');
  });

  it('ze współrzędnymi: POST /businesses, ekran przechodzi w „czeka na akceptację"', async () => {
    const { fixture, http, comp, el } = await setup();
    const refresh = vi.spyOn(TestBed.inject(AuthStore), 'refresh');
    comp.model.set({ ...VALID_MODEL });
    await fixture.whenStable(); // efekt czyszczący pinezkę reaguje na adres, gdy coords są jeszcze null
    comp.coords.set({ lat: 52.2, lng: 21.01 }); // geokod dopiero po ustaleniu adresu
    await fixture.whenStable();

    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();

    const req = http.expectOne('/api/businesses');
    expect(req.request.body.lat).toBe(52.2);
    expect(req.request.body.lng).toBe(21.01);
    expect(req.request.body.name).toBe('Salon Fryzjerski');
    // pustych pól opcjonalnych nie wysyłamy (pusty string nie przejdzie @Matches)
    expect('phone' in req.request.body).toBe(false);
    req.flush({ status: 'PENDING', rejectionReason: null });
    await fixture.whenStable();
    fixture.detectChanges();

    // zgłoszenie nie zmienia roli — bez odświeżania sesji i bez wejścia do panelu
    expect(refresh).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).url).not.toBe('/business');
    expect(el.textContent).toContain('Zgłoszenie czeka na akceptację');
    expect(el.querySelector('form')).toBeNull();
  });

  it('edycja adresu po geokodowaniu: unieważnia pinezkę, submit nie wysyła', async () => {
    const { fixture, http, comp, el } = await setup();
    comp.model.set({ ...VALID_MODEL });
    await fixture.whenStable();
    comp.coords.set({ lat: 52.2, lng: 21.01 });
    await fixture.whenStable();
    // użytkownik zmienia ulicę bez ponownego „Znajdź na mapie"
    comp.model.set({ ...VALID_MODEL, street: 'Inna 9' });
    await fixture.whenStable();

    expect(comp.coords()).toBeNull();

    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();

    http.expectNone('/api/businesses');
  });
});
