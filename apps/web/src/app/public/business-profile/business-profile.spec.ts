import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import AppMap from '../../shared/map/map';
import BusinessProfile from './business-profile';

// Podmiana mapy — Leaflet nie działa w jsdom (brak rozmiarów DOM).
@Component({ selector: 'app-map', template: '' })
class MapStub {
  readonly lat = input<number | null>(null);
  readonly lng = input<number | null>(null);
}

const MOCK = {
  id: 'b1',
  slug: 'test-slug',
  name: 'Studio Fryzur',
  description: 'Opis firmy',
  phone: null,
  street: 'Józefa 12',
  city: 'Kraków',
  postalCode: '31-056',
  lat: 50.05,
  lng: 19.94,
  cancellationHours: 24,
  category: { id: 'c1', name: 'Salon fryzjerski', slug: 'fryzjer' },
  services: [
    {
      id: 's1',
      name: 'Strzyżenie męskie',
      description: 'Klasyczne',
      durationMin: 30,
      priceCents: 7000,
      employees: [],
    },
  ],
  employees: [{ id: 'e1', name: 'Anna Kowalska' }],
};

async function setup(slug = 'test-slug') {
  await TestBed.configureTestingModule({
    imports: [BusinessProfile],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of(convertToParamMap({ slug })) },
      },
    ],
  })
    .overrideComponent(BusinessProfile, {
      remove: { imports: [AppMap] },
      add: { imports: [MapStub] },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(BusinessProfile);
  const http = TestBed.inject(HttpTestingController);
  return { fixture, http };
}

describe('BusinessProfile', () => {
  it('renderuje profil: nazwę i cenę usługi w zł', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/businesses/test-slug').flush(MOCK);
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Studio Fryzur');
    expect(text.replace(/\s/g, ' ')).toContain('70 zł');
    expect(text).toContain('Anna Kowalska');
  });

  it('404: pokazuje stronę „nie znaleziono", nie profil', async () => {
    const { fixture, http } = await setup('brak');
    http
      .expectOne('/api/businesses/brak')
      .flush('Nie znaleziono firmy', {
        status: 404,
        statusText: 'Not Found',
      });
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Nie znaleziono strony');
    expect(text).not.toContain('Studio Fryzur');
  });
});
