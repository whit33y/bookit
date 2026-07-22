import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import BusinessServices from './services';

interface ServiceEmployee {
  id: string;
  name: string;
}
interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  isActive: boolean;
  employees: ServiceEmployee[];
}

const ACTIVE: Service = {
  id: 's1',
  name: 'Strzyżenie',
  description: null,
  durationMin: 30,
  priceCents: 5000,
  isActive: true,
  employees: [],
};
const INACTIVE: Service = {
  id: 's2',
  name: 'Zabieg archiwalny',
  description: null,
  durationMin: 60,
  priceCents: 12000,
  isActive: false,
  employees: [],
};
const EMPLOYEES = [
  { id: 'e1', name: 'Ala', isActive: true, user: null },
  { id: 'e2', name: 'Bartek', isActive: true, user: null },
];

interface Model {
  name: string;
  description: string;
  durationMin: number;
  priceZl: number;
}

// dostęp do protected pól/metod komponentu w teście, bez `any`
interface TestAccess {
  model: WritableSignal<Model>;
  services: WritableSignal<Service[]>;
  selectedEmployeeIds: WritableSignal<string[]>;
  openCreate(): void;
  openEdit(s: Service): void;
  toggleEmployee(id: string): void;
  onDelete(s: Service): Promise<void>;
  onReactivate(s: Service): Promise<void>;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('BusinessServices', () => {
  beforeEach(async () => {
    localStorage.clear();
    // jsdom nie ma window.confirm — usuwanie potwierdzamy domyślnie na true
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await TestBed.configureTestingModule({
      imports: [BusinessServices],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  function setup(services: Service[] = [ACTIVE, INACTIVE]) {
    const fixture = TestBed.createComponent(BusinessServices);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges(); // konstruktor odpala oba GET-y
    http.expectOne('/api/businesses/mine/services').flush(services);
    http.expectOne('/api/businesses/mine/employees').flush(EMPLOYEES);
    const comp = fixture.componentInstance as unknown as TestAccess;
    return { fixture, http, comp };
  }

  function submitForm(fixture: { nativeElement: unknown }) {
    (fixture.nativeElement as HTMLElement)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  it('renderuje usługi aktywne i nieaktywne, nieaktywną oznacza „Nieaktywna”', async () => {
    const { fixture } = setup();
    await tick();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Strzyżenie');
    expect(text).toContain('Zabieg archiwalny');
    expect(text).toContain('Nieaktywna');
  });

  it('create: POST z ceną przeliczoną ze złotych na grosze', async () => {
    const { fixture, http, comp } = setup([]);
    await fixture.whenStable();

    comp.openCreate();
    comp.model.set({
      name: 'Masaż',
      description: '',
      durationMin: 45,
      priceZl: 45.5,
    });
    fixture.detectChanges();
    submitForm(fixture);
    await tick();

    const req = http.expectOne('/api/businesses/mine/services');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.priceCents).toBe(4550);
    expect(req.request.body.durationMin).toBe(45);
    req.flush({ ...ACTIVE, id: 's9', name: 'Masaż', priceCents: 4550 });
    await fixture.whenStable();
  });

  it('usuwanie z rezerwacjami (deactivated:true): wiersz zostaje jako nieaktywny', async () => {
    const { fixture, http, comp } = setup([ACTIVE]);
    await fixture.whenStable();

    void comp.onDelete(ACTIVE);
    http
      .expectOne('/api/businesses/mine/services/s1')
      .flush({ ...ACTIVE, isActive: false, deactivated: true });
    await tick();

    expect(comp.services()[0].isActive).toBe(false);
  });

  it('usuwanie bez rezerwacji (deactivated:false): wiersz znika z listy', async () => {
    const { fixture, http, comp } = setup([ACTIVE]);
    await fixture.whenStable();

    void comp.onDelete(ACTIVE);
    http
      .expectOne('/api/businesses/mine/services/s1')
      .flush({ id: 's1', deactivated: false });
    await tick();

    expect(comp.services().length).toBe(0);
  });

  it('anulowanie potwierdzenia: DELETE nie jest wysyłany', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    const { fixture, http, comp } = setup([ACTIVE]);
    await fixture.whenStable();

    void comp.onDelete(ACTIVE);
    await tick();

    http.expectNone('/api/businesses/mine/services/s1');
    expect(comp.services().length).toBe(1);
  });

  it('reaktywacja: PATCH isActive:true przełącza usługę na aktywną', async () => {
    const { fixture, http, comp } = setup([INACTIVE]);
    await fixture.whenStable();

    void comp.onReactivate(INACTIVE);
    const req = http.expectOne('/api/businesses/mine/services/s2');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ isActive: true });
    req.flush({ ...INACTIVE, isActive: true });
    await tick();

    expect(comp.services()[0].isActive).toBe(true);
  });

  it('edycja przypisań: zmiana pracowników wywołuje PUT :id/employees', async () => {
    const { fixture, http, comp } = setup([ACTIVE]);
    await fixture.whenStable();

    comp.openEdit(ACTIVE);
    comp.toggleEmployee('e1');
    fixture.detectChanges();
    submitForm(fixture);
    await tick();

    http
      .expectOne('/api/businesses/mine/services/s1')
      .flush({ ...ACTIVE }); // PATCH pól usługi
    await tick();

    const put = http.expectOne('/api/businesses/mine/services/s1/employees');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ employeeIds: ['e1'] });
    put.flush({ ...ACTIVE, employees: [{ id: 'e1', name: 'Ala' }] });
    await tick();

    expect(comp.services()[0].employees).toEqual([{ id: 'e1', name: 'Ala' }]);
  });
});
