import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Employee } from '../employees/employee-response';
import { employeeResponse } from '../employees/testing-helpers';
import EmployeesTile from './employees-tile';

const setup = () => {
  const fixture = TestBed.createComponent(EmployeesTile);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges(); // konstruktor odpala GET
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
};

const employeesRequest = (http: HttpTestingController) =>
  http.expectOne('/api/businesses/mine/employees');

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s/g, ' ');

async function respond(
  fixture: ComponentFixture<EmployeesTile>,
  http: HttpTestingController,
  employees: Employee[],
) {
  employeesRequest(http).flush(employees);
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('EmployeesTile', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmployeesTile],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('liczy aktywnych pracowników, a nieaktywnych podaje osobno', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, [
      employeeResponse({ id: 'a', name: 'Ola' }),
      employeeResponse({ id: 'b', name: 'Ala' }),
      employeeResponse({ id: 'c', name: 'Ela', isActive: false }),
    ]);

    const content = text(el);
    expect(content).toContain('2 aktywni pracownicy');
    expect(content).toContain('Nieaktywni: 1');
  });

  it('bez nieaktywnych nie ma o nich wzmianki — zero nie jest informacją', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, [employeeResponse()]);

    expect(text(el)).not.toContain('Nieaktywni');
  });

  it('próbka pokazuje imiona samych aktywnych, najwyżej czworo', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, [
      ...Array.from({ length: 5 }, (_, i) =>
        employeeResponse({ id: `e${i}`, name: `Pracownik ${i}` }),
      ),
      employeeResponse({ id: 'x', name: 'Zwolniony', isActive: false }),
    ]);

    expect(el.querySelectorAll('li')).toHaveLength(4);
    expect(text(el)).not.toContain('Zwolniony');
    expect(text(el)).toContain('5 aktywnych pracowników');
  });

  it('zero aktywnych pracowników to ostrzeżenie z CTA, nie „0" i nie pusta lista', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, []);

    const content = text(el);
    expect(content).toContain('Nie masz aktywnych pracowników');
    expect(content).toContain('Dodaj pierwszego pracownika');
    expect(content).not.toContain('0 ');
    expect(el.querySelectorAll('li')).toHaveLength(0);
  });

  it('ostrzeżenie przy zerze aktywnych nie gubi liczby nieaktywnych', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, [
      employeeResponse({ id: 'a', name: 'Ola', isActive: false }),
      employeeResponse({ id: 'b', name: 'Ala', isActive: false }),
    ]);

    const content = text(el);
    expect(content).toContain('Nie masz aktywnych pracowników');
    // przy zerze aktywnych ta liczba waży najwięcej — jest kogo przywrócić
    expect(content).toContain('Nieaktywni: 2');
    expect(content).toContain('Przywróć pracownika');
    expect(content).not.toContain('Dodaj pierwszego pracownika');
  });

  it('do czasu odpowiedzi pokazuje stan ładowania, nie zero pracowników', () => {
    const { el, http } = setup();

    expect(el.querySelector('app-loading-state')).not.toBeNull();
    expect(text(el)).not.toContain('pracown');

    employeesRequest(http).flush([]);
  });

  it('błąd pokazuje komunikat i ponowienie, które pobiera dane jeszcze raz', async () => {
    const { fixture, http, el } = setup();
    employeesRequest(http).flush(
      {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Coś poszło nie tak',
      },
      { status: 500, statusText: 'Server Error' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('app-error-state')).not.toBeNull();
    expect(text(el)).toContain('Coś poszło nie tak');

    el.querySelector('app-error-state button')?.dispatchEvent(
      new Event('click'),
    );
    fixture.detectChanges();

    await respond(fixture, http, [employeeResponse({ name: 'Ola' })]);
    expect(el.querySelector('app-error-state')).toBeNull();
    expect(text(el)).toContain('1 aktywny pracownik');
  });

  it('prowadzi na /business/employees jednym linkiem, bez akcji w treści', async () => {
    const { fixture, http, el } = setup();
    await respond(fixture, http, [employeeResponse()]);

    expect(
      [...el.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    ).toEqual(['/business/employees']);
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });
});
