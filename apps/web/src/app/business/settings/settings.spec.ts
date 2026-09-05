import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, WritableSignal, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import BusinessSettings from './settings';
import AppMap from '../../shared/map/map';

// Podmiana mapy — nie wołamy Leafletu (jsdom nie ma pełnego DOM/rozmiarów).
@Component({ selector: 'app-map', template: '' })
class MapStub {
  readonly lat = input<number | null>(null);
  readonly lng = input<number | null>(null);
}

// odpowiedź GET /businesses/mine (businessSelect)
const BUSINESS = {
  id: 'biz-1',
  name: 'Salon Fryzjerski',
  description: 'Opis',
  phone: '',
  street: 'Główna 1',
  city: 'Kraków',
  postalCode: '',
  lat: 50.06,
  lng: 19.94,
  cancellationHours: 24,
  logoVersion: null,
  coverVersion: null,
};

interface Model {
  name: string;
  description: string;
  phone: string;
  street: string;
  city: string;
  postalCode: string;
  cancellationHours: number;
}

// dostęp do protected sygnałów komponentu w teście, bez `any`
interface TestAccess {
  model: WritableSignal<Model>;
  coords: WritableSignal<{ lat: number; lng: number } | null>;
}

describe('BusinessSettings', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [BusinessSettings],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    })
      .overrideComponent(BusinessSettings, {
        remove: { imports: [AppMap] },
        add: { imports: [MapStub] },
      })
      .compileComponents();
  });

  function setup() {
    const fixture = TestBed.createComponent(BusinessSettings);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges(); // odpala konstruktor + fetch
    http.expectOne('/api/businesses/mine').flush(BUSINESS);
    const comp = fixture.componentInstance as unknown as TestAccess;
    return { fixture, http, comp };
  }

  async function submit(fixture: { whenStable: () => Promise<unknown> }, el: HTMLElement) {
    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();
  }

  it('prefill: wypełnia model i pinezkę danymi firmy', async () => {
    const { fixture, comp } = setup();
    await fixture.whenStable();

    expect(comp.model().name).toBe('Salon Fryzjerski');
    expect(comp.model().cancellationHours).toBe(24);
    expect(comp.coords()).toEqual({ lat: 50.06, lng: 19.94 });
  });

  it('zmiana polityki odwołań bez zmiany adresu: PATCH /businesses/mine z nową wartością', async () => {
    const { fixture, http, comp } = setup();
    await fixture.whenStable();
    // właściciel zmienia politykę odwołań; adres bez zmian → geokodowanie nie jest wymagane
    comp.model.set({ ...comp.model(), cancellationHours: 48 });
    await fixture.whenStable();

    await submit(fixture, fixture.nativeElement as HTMLElement);

    const req = http.expectOne('/api/businesses/mine');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.lat).toBe(50.06);
    expect(req.request.body.cancellationHours).toBe(48);
    expect(req.request.body.name).toBe('Salon Fryzjerski');
    // pusty telefon/kod pomijamy (pusty string nie przejdzie @Matches)
    expect('phone' in req.request.body).toBe(false);
    req.flush({ ...BUSINESS });
  });

  it('puste pole polityki odwołań: submit nie wysyła PATCH (nie idzie null do bazy)', async () => {
    const { fixture, http, comp } = setup();
    await fixture.whenStable();
    // wyczyszczenie inputu number daje null w modelu
    comp.model.set({
      ...comp.model(),
      cancellationHours: null as unknown as number,
    });
    await fixture.whenStable();

    await submit(fixture, fixture.nativeElement as HTMLElement);

    http.expectNone('/api/businesses/mine');
  });

  it('ułamkowa liczba godzin: submit nie wysyła PATCH (DTO ma @IsInt)', async () => {
    const { fixture, http, comp } = setup();
    await fixture.whenStable();
    comp.model.set({ ...comp.model(), cancellationHours: 24.5 });
    await fixture.whenStable();

    await submit(fixture, fixture.nativeElement as HTMLElement);

    http.expectNone('/api/businesses/mine');
  });

  it('błąd wczytania firmy: pokazuje komunikat i nie renderuje formularza', async () => {
    const fixture = TestBed.createComponent(BusinessSettings);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/businesses/mine').flush('err', {
      status: 500,
      statusText: 'Server Error',
    });
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Nie udało się wczytać');
    expect(el.querySelector('form')).toBeNull();
  });

  it('zmiana adresu bez ponownego geokodowania: submit nie wysyła PATCH', async () => {
    const { fixture, http, comp } = setup();
    await fixture.whenStable();
    // użytkownik zmienia ulicę bez „Znajdź na mapie" — geocodedKey się rozjeżdża
    comp.model.set({ ...comp.model(), street: 'Inna 9' });
    await fixture.whenStable();

    await submit(fixture, fixture.nativeElement as HTMLElement);

    http.expectNone('/api/businesses/mine');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Zmieniono adres',
    );
  });
});
