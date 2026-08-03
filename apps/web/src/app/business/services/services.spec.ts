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
  depositType: 'FIXED' | 'PERCENT' | null;
  depositValue: number | null;
  employees: ServiceEmployee[];
}

const ACTIVE: Service = {
  id: 's1',
  name: 'Strzyżenie',
  description: null,
  durationMin: 30,
  priceCents: 5000,
  isActive: true,
  depositType: null,
  depositValue: null,
  employees: [],
};
const INACTIVE: Service = {
  id: 's2',
  name: 'Zabieg archiwalny',
  description: null,
  durationMin: 60,
  priceCents: 12000,
  isActive: false,
  depositType: null,
  depositValue: null,
  employees: [],
};
const WITH_PERCENT: Service = {
  id: 's3',
  name: 'Masaż relaksacyjny',
  description: null,
  durationMin: 60,
  priceCents: 18000,
  isActive: true,
  depositType: 'PERCENT',
  depositValue: 20,
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
  depositEnabled: boolean;
  depositKind: 'FIXED' | 'PERCENT';
  depositAmountZl: number;
  depositPercent: number;
}

const NO_DEPOSIT = {
  depositEnabled: false,
  depositKind: 'FIXED',
  depositAmountZl: 0,
  depositPercent: 10,
} satisfies Pick<
  Model,
  'depositEnabled' | 'depositKind' | 'depositAmountZl' | 'depositPercent'
>;

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
      ...NO_DEPOSIT,
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

  describe('zaliczka (#114)', () => {
    it('create z zaliczką kwotową: POST wysyła FIXED i kwotę w groszach', async () => {
      const { fixture, http, comp } = setup([]);
      await fixture.whenStable();

      comp.openCreate();
      comp.model.set({
        name: 'Masaż',
        description: '',
        durationMin: 60,
        priceZl: 180,
        ...NO_DEPOSIT,
        depositEnabled: true,
        depositKind: 'FIXED',
        depositAmountZl: 50,
      });
      fixture.detectChanges();
      submitForm(fixture);
      await tick();

      const req = http.expectOne('/api/businesses/mine/services');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.depositType).toBe('FIXED');
      expect(req.request.body.depositValue).toBe(5000);
      req.flush({ ...WITH_PERCENT, depositType: 'FIXED', depositValue: 5000 });
      await fixture.whenStable();
    });

    it('create z zaliczką procentową: POST wysyła PERCENT i sam procent', async () => {
      const { fixture, http, comp } = setup([]);
      await fixture.whenStable();

      comp.openCreate();
      comp.model.set({
        name: 'Masaż',
        description: '',
        durationMin: 60,
        priceZl: 180,
        ...NO_DEPOSIT,
        depositEnabled: true,
        depositKind: 'PERCENT',
        depositPercent: 20,
      });
      fixture.detectChanges();
      submitForm(fixture);
      await tick();

      const req = http.expectOne('/api/businesses/mine/services');
      expect(req.request.body.depositType).toBe('PERCENT');
      expect(req.request.body.depositValue).toBe(20);
      req.flush(WITH_PERCENT);
      await fixture.whenStable();
    });

    it('wyłączenie zaliczki: PATCH czyści oba pola jawnym null', async () => {
      const { fixture, http, comp } = setup([WITH_PERCENT]);
      await fixture.whenStable();

      comp.openEdit(WITH_PERCENT);
      // prefill z usługi, wyłączamy sam toggle
      comp.model.update((m) => ({ ...m, depositEnabled: false }));
      fixture.detectChanges();
      submitForm(fixture);
      await tick();

      const req = http.expectOne('/api/businesses/mine/services/s3');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body.depositType).toBeNull();
      expect(req.request.body.depositValue).toBeNull();
      req.flush({ ...WITH_PERCENT, depositType: null, depositValue: null });
      await fixture.whenStable();
    });

    it('edycja prefilluje typ i wartość zaliczki z usługi', async () => {
      const { fixture, comp } = setup([WITH_PERCENT]);
      await fixture.whenStable();

      comp.openEdit(WITH_PERCENT);

      expect(comp.model().depositEnabled).toBe(true);
      expect(comp.model().depositKind).toBe('PERCENT');
      expect(comp.model().depositPercent).toBe(20);
    });

    it('procent poza zakresem 1–100 blokuje zapis — żądanie nie wychodzi', async () => {
      const { fixture, http, comp } = setup([]);
      await fixture.whenStable();

      comp.openCreate();
      comp.model.set({
        name: 'Masaż',
        description: '',
        durationMin: 60,
        priceZl: 180,
        ...NO_DEPOSIT,
        depositEnabled: true,
        depositKind: 'PERCENT',
        depositPercent: 150,
      });
      fixture.detectChanges();
      submitForm(fixture);
      await tick();

      http.expectNone('/api/businesses/mine/services');
    });

    it('kwota wyższa niż cena blokuje zapis — żądanie nie wychodzi', async () => {
      const { fixture, http, comp } = setup([]);
      await fixture.whenStable();

      comp.openCreate();
      comp.model.set({
        name: 'Masaż',
        description: '',
        durationMin: 60,
        priceZl: 180,
        ...NO_DEPOSIT,
        depositEnabled: true,
        depositKind: 'FIXED',
        depositAmountZl: 200,
      });
      fixture.detectChanges();
      submitForm(fixture);
      await tick();

      http.expectNone('/api/businesses/mine/services');
    });

    it('wyłączona zaliczka nie blokuje zapisu mimo zerowej kwoty w modelu', async () => {
      const { fixture, http, comp } = setup([]);
      await fixture.whenStable();

      comp.openCreate();
      comp.model.set({
        name: 'Masaż',
        description: '',
        durationMin: 60,
        priceZl: 180,
        ...NO_DEPOSIT,
      });
      fixture.detectChanges();
      submitForm(fixture);
      await tick();

      const req = http.expectOne('/api/businesses/mine/services');
      expect(req.request.body.depositType).toBeNull();
      req.flush({ ...ACTIVE, id: 's9' });
      await fixture.whenStable();
    });

    it('podgląd kwoty pokazuje się dla poprawnego procentu', async () => {
      const { fixture, comp } = setup([]);
      await fixture.whenStable();

      comp.openCreate();
      comp.model.update((m) => ({
        ...m,
        priceZl: 180,
        depositEnabled: true,
        depositKind: 'PERCENT',
        depositPercent: 20,
      }));
      fixture.detectChanges();
      await tick();
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Zaliczka wyniesie');
      expect(text).toContain('36');
    });

    it('podgląd nie liczy kwoty dla procentu spoza zakresu, nawet zanim pole zostanie dotknięte', async () => {
      const { fixture, comp } = setup([]);
      await fixture.whenStable();

      comp.openCreate();
      comp.model.update((m) => ({
        ...m,
        priceZl: 180,
        depositEnabled: true,
        depositKind: 'PERCENT',
        depositPercent: 150,
      }));
      fixture.detectChanges();
      await tick();
      fixture.detectChanges();

      // 150% ze 180 zł = 270 zł — kwota wyższa niż cena, której zapis i tak nie przyjmie
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('Zaliczka wyniesie');
      expect(text).not.toContain('270');
    });

    it('aria-describedby pola procentu zawsze wskazuje na istniejący element', async () => {
      const { fixture, comp } = setup([]);
      await fixture.whenStable();

      comp.openCreate();
      // cena 0 zł: podgląd nie ma czego pokazać (10% z 0 = 0 gr), więc hint nie istnieje
      comp.model.update((m) => ({
        ...m,
        priceZl: 0,
        depositEnabled: true,
        depositKind: 'PERCENT',
        depositPercent: 10,
      }));
      fixture.detectChanges();
      await tick();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const describedBy = el
        .querySelector('#depositPercent')
        ?.getAttribute('aria-describedby');
      // wiszący IDREF to błąd AXE — atrybut albo nie istnieje, albo wskazuje na realny element
      expect(describedBy).toBeNull();
    });

    it('lista pokazuje kwotę zaliczki procentowej wyliczoną z ceny', async () => {
      const { fixture } = setup([WITH_PERCENT]);
      await tick();
      fixture.detectChanges();

      // 20% ze 180 zł = 36 zł
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Zaliczka:');
      expect(text).toContain('36');
      expect(text).toContain('20% ceny');
    });

    it('usługa bez zaliczki nie renderuje wiersza z zaliczką', async () => {
      const { fixture } = setup([ACTIVE]);
      await tick();
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('Zaliczka:');
    });
  });
});
