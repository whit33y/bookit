import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signInAs, verifyIgnoringProfile } from '../../core/auth/auth-testing';
import { setLocale } from '../../core/i18n/locale';
import FavoriteHeart from './favorite-heart';

const IDS_URL = '/api/favorites/ids';

async function setup() {
  const fixture = TestBed.createComponent(FavoriteHeart);
  fixture.componentRef.setInput('businessId', 'b1');
  await fixture.whenStable();
  return fixture;
}

const heart = (fixture: { nativeElement: HTMLElement }) =>
  fixture.nativeElement.querySelector('button');

/** Tick makrotaska + stabilizacja: łańcuch promisów store'u musi się rozliczyć przed asercją. */
const settle = async (fixture: ComponentFixture<FavoriteHeart>) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
};

describe('FavoriteHeart', () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale('pl');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => {
    verifyIgnoringProfile(TestBed.inject(HttpTestingController));
  });

  // AC #182: OWNER, EMPLOYEE i ADMIN nie widzą serca — nieaktywny przycisk obiecywałby
  // funkcję, której te role nie dostaną
  it.each(['OWNER', 'EMPLOYEE', 'ADMIN'] as const)(
    'rola %s nie widzi serca',
    async (role) => {
      signInAs({ role });
      const fixture = await setup();

      expect(heart(fixture)).toBeNull();
    },
  );

  it('gość widzi puste, klikalne serce', async () => {
    const fixture = await setup();

    const button = heart(fixture);
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute('aria-label')).toBe('Dodaj do ulubionych');
  });

  // AC #182: klik gościa ląduje na /login z bieżącą ścieżką jako returnUrl — ten sam
  // wzorzec co finalizacja w kreatorze rezerwacji
  it('klik gościa prowadzi na /login z returnUrl bieżącej ścieżki', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/salon-x');
    const fixture = await setup();

    heart(fixture)?.click();
    await fixture.whenStable();

    expect(router.url).toBe('/login?returnUrl=%2Fsalon-x');
  });

  it('gość nie wysyła żądania o ulubione', async () => {
    await setup();

    TestBed.inject(HttpTestingController).expectNone(IDS_URL);
  });

  it('klient widzi zapalone serce firmy z listy ulubionych', async () => {
    signInAs();
    const fixture = await setup();
    TestBed.inject(HttpTestingController).expectOne(IDS_URL).flush({ ids: ['b1'] });
    await settle(fixture);

    expect(heart(fixture)?.getAttribute('aria-label')).toBe('Usuń z ulubionych');
  });

  // AC #182: klik przerysowuje serce przed odpowiedzią, żądanie leci w tle
  it('klik klienta przerysowuje serce przed odpowiedzią serwera', async () => {
    signInAs();
    const fixture = await setup();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(IDS_URL).flush({ ids: [] });
    await settle(fixture);

    heart(fixture)?.click();
    await fixture.whenStable();

    expect(heart(fixture)?.getAttribute('aria-label')).toBe('Usuń z ulubionych');
    http
      .expectOne('/api/businesses/b1/favorite')
      .flush(null, { status: 204, statusText: 'No Content' });
  });

  it('nieudane żądanie cofa stan serca', async () => {
    signInAs();
    const fixture = await setup();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(IDS_URL).flush({ ids: [] });
    await settle(fixture);

    heart(fixture)?.click();
    await settle(fixture);
    http
      .expectOne('/api/businesses/b1/favorite')
      .flush({ message: 'Błąd' }, { status: 500, statusText: 'Server Error' });
    await settle(fixture);

    expect(heart(fixture)?.getAttribute('aria-label')).toBe('Dodaj do ulubionych');
  });

  // Bez aria-pressed (AC #182): czytnik ma przeczytać akcję, którą klik wykona
  it('nie używa aria-pressed', async () => {
    signInAs();
    const fixture = await setup();
    TestBed.inject(HttpTestingController).expectOne(IDS_URL).flush({ ids: ['b1'] });
    await settle(fixture);

    expect(heart(fixture)?.hasAttribute('aria-pressed')).toBe(false);
  });

  it('etykieta jest po angielsku przy EN', async () => {
    setLocale('en');
    const fixture = await setup();

    expect(heart(fixture)?.getAttribute('aria-label')).toBe('Add to favorites');
  });
});
