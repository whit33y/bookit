import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import BusinessEmployees from './employees';

interface LinkedUser {
  email: string;
  firstName: string | null;
  lastName: string | null;
}
interface Employee {
  id: string;
  name: string;
  isActive: boolean;
  user: LinkedUser | null;
}

const ACTIVE: Employee = { id: 'e1', name: 'Ala Kowalska', isActive: true, user: null };
const INACTIVE: Employee = {
  id: 'e2',
  name: 'Były Pracownik',
  isActive: false,
  user: null,
};

interface Model {
  name: string;
  email: string;
}

// dostęp do protected pól/metod komponentu w teście, bez `any`
interface TestAccess {
  model: WritableSignal<Model>;
  employees: WritableSignal<Employee[]>;
  openCreate(): void;
  openEdit(e: Employee): void;
  onDelete(e: Employee): Promise<void>;
  onReactivate(e: Employee): Promise<void>;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('BusinessEmployees', () => {
  beforeEach(async () => {
    localStorage.clear();
    // jsdom nie ma window.confirm — usuwanie potwierdzamy domyślnie na true
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await TestBed.configureTestingModule({
      imports: [BusinessEmployees],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  function setup(employees: Employee[] = [ACTIVE, INACTIVE]) {
    const fixture = TestBed.createComponent(BusinessEmployees);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges(); // konstruktor odpala GET
    http.expectOne('/api/businesses/mine/employees').flush(employees);
    const comp = fixture.componentInstance as unknown as TestAccess;
    return { fixture, http, comp };
  }

  function submitForm(fixture: { nativeElement: unknown }) {
    (fixture.nativeElement as HTMLElement)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  it('renderuje pracowników aktywnych i nieaktywnych, nieaktywnego oznacza „Nieaktywny”', async () => {
    const { fixture } = setup();
    await tick();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ala Kowalska');
    expect(text).toContain('Były Pracownik');
    expect(text).toContain('Nieaktywny');
  });

  it('create: POST z nazwą, e-mail pominięty gdy pusty', async () => {
    const { fixture, http, comp } = setup([]);
    await fixture.whenStable();

    comp.openCreate();
    comp.model.set({ name: 'Nowy Pracownik', email: '' });
    fixture.detectChanges();
    submitForm(fixture);
    await tick();

    const req = http.expectOne('/api/businesses/mine/employees');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Nowy Pracownik' });
    req.flush({ id: 'e9', name: 'Nowy Pracownik', isActive: true, user: null });
    await fixture.whenStable();
  });

  it('create: POST z e-mailem, gdy podany', async () => {
    const { fixture, http, comp } = setup([]);
    await fixture.whenStable();

    comp.openCreate();
    comp.model.set({ name: 'Z Kontem', email: 'user@example.com' });
    fixture.detectChanges();
    submitForm(fixture);
    await tick();

    const req = http.expectOne('/api/businesses/mine/employees');
    expect(req.request.body).toEqual({
      name: 'Z Kontem',
      email: 'user@example.com',
    });
    req.flush({ id: 'e9', name: 'Z Kontem', isActive: true, user: null });
    await fixture.whenStable();
  });

  it('edycja: PATCH aktualizuje pracownika i podmienia wiersz na liście', async () => {
    const { fixture, http, comp } = setup([ACTIVE]);
    await fixture.whenStable();

    comp.openEdit(ACTIVE);
    comp.model.set({ name: 'Ala Nowak', email: '' });
    fixture.detectChanges();
    submitForm(fixture);
    await tick();

    const req = http.expectOne('/api/businesses/mine/employees/e1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'Ala Nowak' });
    req.flush({ ...ACTIVE, name: 'Ala Nowak' });
    await tick();

    expect(comp.employees()[0].name).toBe('Ala Nowak');
  });

  it('błąd ładowania: baner błędu zamiast komunikatu pustego stanu', async () => {
    const fixture = TestBed.createComponent(BusinessEmployees);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http
      .expectOne('/api/businesses/mine/employees')
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await tick();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Nie udało się wczytać pracowników.');
    expect(text).not.toContain('Nie masz jeszcze żadnych pracowników');
  });

  it('usuwanie z rezerwacjami (deactivated:true): wiersz zostaje jako nieaktywny', async () => {
    const { fixture, http, comp } = setup([ACTIVE]);
    await fixture.whenStable();

    void comp.onDelete(ACTIVE);
    http
      .expectOne('/api/businesses/mine/employees/e1')
      .flush({ ...ACTIVE, isActive: false, deactivated: true });
    await tick();

    expect(comp.employees()[0].isActive).toBe(false);
  });

  it('usuwanie bez rezerwacji (deactivated:false): wiersz znika z listy', async () => {
    const { fixture, http, comp } = setup([ACTIVE]);
    await fixture.whenStable();

    void comp.onDelete(ACTIVE);
    http
      .expectOne('/api/businesses/mine/employees/e1')
      .flush({ id: 'e1', deactivated: false });
    await tick();

    expect(comp.employees().length).toBe(0);
  });

  it('anulowanie potwierdzenia: DELETE nie jest wysyłany', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    const { fixture, http, comp } = setup([ACTIVE]);
    await fixture.whenStable();

    void comp.onDelete(ACTIVE);
    await tick();

    http.expectNone('/api/businesses/mine/employees/e1');
    expect(comp.employees().length).toBe(1);
  });

  it('błąd pobrania listy: komunikat po polsku z retry zamiast „nie masz pracowników"', async () => {
    const fixture = TestBed.createComponent(BusinessEmployees);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http
      .expectOne('/api/businesses/mine/employees')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await tick();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Brak połączenia z serwerem',
    );
    // pusta lista i nieudane pobranie to dwa różne stany
    expect(el.textContent).not.toContain('Nie masz jeszcze żadnych pracowników');

    const retry = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Spróbuj ponownie'),
    );
    retry?.click();
    await tick();

    http.expectOne('/api/businesses/mine/employees').flush([]);
    await tick();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Nie masz jeszcze żadnych pracowników',
    );
  });

  it('reaktywacja: PATCH isActive:true przełącza pracownika na aktywnego', async () => {
    const { fixture, http, comp } = setup([INACTIVE]);
    await fixture.whenStable();

    void comp.onReactivate(INACTIVE);
    const req = http.expectOne('/api/businesses/mine/employees/e2');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ isActive: true });
    req.flush({ ...INACTIVE, isActive: true });
    await tick();

    expect(comp.employees()[0].isActive).toBe(true);
  });
});
