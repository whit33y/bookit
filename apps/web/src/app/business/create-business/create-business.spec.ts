import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, WritableSignal, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import CreateBusiness from './create-business';
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
        // catch-all: po submit auth.refresh() bez tokenu wywoła logout→navigate('/login')
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

  function setup() {
    const fixture = TestBed.createComponent(CreateBusiness);
    const http = TestBed.inject(HttpTestingController);
    // firma ma kategorię — konstruktor pobiera słownik
    http.expectOne('/api/categories').flush([
      { id: 'cat-1', name: 'Fryzjer', slug: 'fryzjer' },
    ]);
    const comp = fixture.componentInstance as unknown as TestAccess;
    return { fixture, http, comp };
  }

  it('nieudane pobranie kategorii: komunikat i ponowna próba, nie ślepy zaułek', async () => {
    const fixture = TestBed.createComponent(CreateBusiness);
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne('/api/categories')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Nie udało się wczytać listy kategorii',
    );

    // kategoria jest wymagana — bez retry jedynym wyjściem byłoby przeładowanie strony
    const retry = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Spróbuj ponownie'),
    );
    retry?.click();
    await fixture.whenStable();

    http
      .expectOne('/api/categories')
      .flush([{ id: 'cat-1', name: 'Fryzjer', slug: 'fryzjer' }]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelectorAll('#categoryId option')).toHaveLength(2);
  });

  it('bez współrzędnych: nie wysyła żądania i pokazuje komunikat', async () => {
    const { fixture, http, comp } = setup();
    comp.model.set({ ...VALID_MODEL }); // coords null
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();

    http.expectNone('/api/businesses');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Najpierw znajdź adres na mapie',
    );
  });

  it('ze współrzędnymi: POST /businesses z lat/lng', async () => {
    const { fixture, http, comp } = setup();
    comp.model.set({ ...VALID_MODEL });
    await fixture.whenStable(); // efekt czyszczący pinezkę reaguje na adres, gdy coords są jeszcze null
    comp.coords.set({ lat: 52.2, lng: 21.01 }); // geokod dopiero po ustaleniu adresu
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();

    const req = http.expectOne('/api/businesses');
    expect(req.request.body.lat).toBe(52.2);
    expect(req.request.body.lng).toBe(21.01);
    expect(req.request.body.name).toBe('Salon Fryzjerski');
    // pustych pól opcjonalnych nie wysyłamy (pusty string nie przejdzie @Matches)
    expect('phone' in req.request.body).toBe(false);
    req.flush({ slug: 'salon-fryzjerski' });
  });

  it('edycja adresu po geokodowaniu: unieważnia pinezkę, submit nie wysyła', async () => {
    const { fixture, http, comp } = setup();
    comp.model.set({ ...VALID_MODEL });
    await fixture.whenStable();
    comp.coords.set({ lat: 52.2, lng: 21.01 });
    await fixture.whenStable();
    // użytkownik zmienia ulicę bez ponownego „Znajdź na mapie"
    comp.model.set({ ...VALID_MODEL, street: 'Inna 9' });
    await fixture.whenStable();

    expect(comp.coords()).toBeNull();

    (fixture.nativeElement as HTMLElement)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();

    http.expectNone('/api/businesses');
  });
});
