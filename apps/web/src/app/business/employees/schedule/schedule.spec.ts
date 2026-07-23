import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import BusinessSchedule from './schedule';

interface Slot {
  startTime: string;
  endTime: string;
}
interface TimeOff {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

// dostęp do protected pól/metod bez `any`
interface TestAccess {
  days: WritableSignal<Slot[][]>;
  hasErrors: Signal<boolean>;
  dayErrors: Signal<(string | null)[]>;
  saved: Signal<boolean>;
  timeOffs: WritableSignal<TimeOff[]>;
  toModel: WritableSignal<{ startsAt: string; endsAt: string; reason: string }>;
  onSave(): Promise<void>;
  onAddTimeOff(): Promise<void>;
  onDeleteTimeOff(t: TimeOff): Promise<void>;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const BASE = '/api/businesses/mine/employees/e1';

describe('BusinessSchedule', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await TestBed.configureTestingModule({
      imports: [BusinessSchedule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'e1' })) },
        },
      ],
    }).compileComponents();
  });

  function setup() {
    const fixture = TestBed.createComponent(BusinessSchedule);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges(); // konstruktor odpala oba GET-y
    http.expectOne(`${BASE}/working-hours`).flush([]);
    http.expectOne(`${BASE}/time-offs`).flush([]);
    const comp = fixture.componentInstance as unknown as TestAccess;
    return { fixture, http, comp };
  }

  it('wykrywa nachodzące przedziały w dniu i blokuje zapis', async () => {
    const { fixture, comp } = setup();
    await tick();

    comp.days.update((days) =>
      days.map((slots, w) =>
        w === 0
          ? [
              { startTime: '09:00', endTime: '12:00' },
              { startTime: '11:00', endTime: '15:00' }, // nachodzi
            ]
          : slots,
      ),
    );

    expect(comp.dayErrors()[0]).toBe('Przedziały nachodzą na siebie');
    expect(comp.hasErrors()).toBe(true);
  });

  it('rozłączne przedziały przechodzą walidację', async () => {
    const { comp } = setup();
    await tick();

    comp.days.update((days) =>
      days.map((slots, w) =>
        w === 0
          ? [
              { startTime: '09:00', endTime: '12:00' },
              { startTime: '13:00', endTime: '17:00' },
            ]
          : slots,
      ),
    );

    expect(comp.dayErrors()[0]).toBeNull();
    expect(comp.hasErrors()).toBe(false);
  });

  it('start >= koniec zgłasza błąd', async () => {
    const { comp } = setup();
    await tick();

    comp.days.update((days) =>
      days.map((slots, w) =>
        w === 2 ? [{ startTime: '15:00', endTime: '09:00' }] : slots,
      ),
    );

    expect(comp.dayErrors()[2]).toBe('Początek musi być przed końcem');
    expect(comp.hasErrors()).toBe(true);
  });

  it('zapis: PUT spłaszcza dni do płaskiej listy slotów z weekday', async () => {
    const { http, comp } = setup();
    await tick();

    comp.days.update((days) =>
      days.map((slots, w) => {
        if (w === 0) return [{ startTime: '09:00', endTime: '12:00' }];
        if (w === 3) return [{ startTime: '08:00', endTime: '16:00' }];
        return slots;
      }),
    );

    void comp.onSave();
    const req = http.expectOne(`${BASE}/working-hours`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      slots: [
        { weekday: 0, startTime: '09:00', endTime: '12:00' },
        { weekday: 3, startTime: '08:00', endTime: '16:00' },
      ],
    });
    req.flush([
      { weekday: 0, slots: [{ startTime: '09:00', endTime: '12:00' }] },
      { weekday: 3, slots: [{ startTime: '08:00', endTime: '16:00' }] },
    ]);
    await tick();

    expect(comp.saved()).toBe(true);
  });

  it('dodanie urlopu: POST konwertuje datetime-local na ISO, powód pominięty gdy pusty', async () => {
    const { http, comp } = setup();
    await tick();

    comp.toModel.set({
      startsAt: '2026-08-01T10:00',
      endsAt: '2026-08-05T18:00',
      reason: '',
    });

    void comp.onAddTimeOff();
    const req = http.expectOne(`${BASE}/time-offs`);
    expect(req.request.method).toBe('POST');
    // ISO liczone przez to samo runtime co komponent → niezależne od strefy testu
    expect(req.request.body).toEqual({
      startsAt: new Date('2026-08-01T10:00').toISOString(),
      endsAt: new Date('2026-08-05T18:00').toISOString(),
    });
    req.flush({
      id: 't9',
      startsAt: new Date('2026-08-01T10:00').toISOString(),
      endsAt: new Date('2026-08-05T18:00').toISOString(),
      reason: null,
    });
    await tick();

    expect(comp.timeOffs().length).toBe(1);
  });

  it('usuwanie urlopu: DELETE i wiersz znika z listy', async () => {
    const { http, comp } = setup();
    await tick();

    const to: TimeOff = {
      id: 't1',
      startsAt: '2026-08-01T08:00:00.000Z',
      endsAt: '2026-08-05T16:00:00.000Z',
      reason: null,
    };
    comp.timeOffs.set([to]);

    void comp.onDeleteTimeOff(to);
    const req = http.expectOne(`${BASE}/time-offs/t1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ id: 't1' });
    await tick();

    expect(comp.timeOffs().length).toBe(0);
  });
});
