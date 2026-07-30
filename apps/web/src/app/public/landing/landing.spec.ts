import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { setValue } from '../testing-helpers';
import Landing from './landing';

const CATEGORIES = [
  { id: 'c1', name: 'Fryzjer', slug: 'fryzjer' },
  { id: 'c2', name: 'Kosmetyczka', slug: 'kosmetyczka' },
];

async function setup() {
  await TestBed.configureTestingModule({
    imports: [Landing],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(Landing);
  const http = TestBed.inject(HttpTestingController);
  return { fixture, http };
}

describe('Landing', () => {
  it('ładuje kategorie z API i pokazuje je w selekcie', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/categories').flush(CATEGORIES);
    await fixture.whenStable();

    const options = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll(
        '#category option',
      ),
    ].map((o) => o.textContent?.trim());
    expect(options).toEqual(['Wszystkie kategorie', 'Fryzjer', 'Kosmetyczka']);
  });

  it('submit z wypełnionymi polami prowadzi do /search z parametrami w URL', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/categories').flush(CATEGORIES);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const select = el.querySelector('#category') as HTMLSelectElement;
    select.value = 'fryzjer';
    select.dispatchEvent(new Event('change'));
    setValue(el.querySelector('#city') as HTMLInputElement, 'Kraków');
    setValue(el.querySelector('#q') as HTMLInputElement, 'strzyżenie');
    await fixture.whenStable();

    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );

    expect(navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { category: 'fryzjer', city: 'Kraków', q: 'strzyżenie' },
    });
  });

  it('submit z pustymi polami prowadzi do /search bez zbędnych parametrów', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/categories').flush(CATEGORIES);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector('form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );

    expect(navigate).toHaveBeenCalledWith(['/search'], { queryParams: {} });
  });
});
