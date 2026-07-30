import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { AuthStore } from '../../core/auth/auth-store';
import { formatTime, todayInBusinessTz } from '../../shared/business-time';
import BookingDetailsDialog, {
  BookingChangedEvent,
  CalendarBooking,
  STATUS_CLASSES,
} from './booking-details-dialog';
import {
  CALENDAR_HOUR_MARKS,
  CALENDAR_SLOT_MIN,
  CALENDAR_TOTAL_SLOTS,
  CALENDAR_WINDOW_START_MIN,
  CalendarViewMode,
  addDays,
  bookingGridRow,
  formatDayLabel,
  rangeForView,
  weekDays,
} from './calendar-date';

// lustrzane typy backendu (employeeSelect w findAll, #17)
interface CalendarEmployee {
  id: string;
  name: string;
  isActive: boolean;
}

interface CalendarColumn {
  key: string;
  title: string;
  bookings: CalendarBooking[];
}

const SLOTS_PER_HOUR = 60 / CALENDAR_SLOT_MIN;

/** Kalendarz firmy — widok dzień/tydzień (#32). Kto widzi kolumny per pracownik / wybór
 *  pracownika, rozstrzyga rola z AuthStore; serwer i tak wymusza własny employeeId dla
 *  EMPLOYEE, więc front tylko dostosowuje UI, nie duplikuje reguły bezpieczeństwa. */
@Component({
  selector: 'app-business-calendar',
  imports: [RouterLink, BookingDetailsDialog],
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 class="text-xl font-bold tracking-tight sm:text-2xl">Kalendarz</h1>

      <div class="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div
          role="group"
          aria-label="Widok kalendarza"
          class="flex gap-1 rounded-lg border border-stone-200 p-1"
        >
          <button
            type="button"
            [attr.aria-pressed]="viewMode() === 'day'"
            class="rounded-md px-3 py-1.5 text-sm font-semibold transition"
            [class]="
              viewMode() === 'day'
                ? 'bg-brand-700 text-white'
                : 'text-stone-600 hover:bg-stone-100'
            "
            (click)="setViewMode('day')"
          >
            Dzień
          </button>
          <button
            type="button"
            [attr.aria-pressed]="viewMode() === 'week'"
            class="rounded-md px-3 py-1.5 text-sm font-semibold transition"
            [class]="
              viewMode() === 'week'
                ? 'bg-brand-700 text-white'
                : 'text-stone-600 hover:bg-stone-100'
            "
            (click)="setViewMode('week')"
          >
            Tydzień
          </button>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            aria-label="Poprzedni okres"
            class="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium shadow-card transition hover:bg-stone-50"
            (click)="navigate(-1)"
          >
            ‹
          </button>
          <span class="min-w-[11rem] text-center text-sm font-semibold">{{
            rangeLabel()
          }}</span>
          <button
            type="button"
            aria-label="Następny okres"
            class="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium shadow-card transition hover:bg-stone-50"
            (click)="navigate(1)"
          >
            ›
          </button>
          <button
            type="button"
            class="ml-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium shadow-card transition hover:bg-stone-50"
            (click)="navigate('today')"
          >
            Dziś
          </button>
        </div>

        @if (viewMode() === 'week' && isOwner() && activeEmployees().length) {
          <div>
            <label for="employee-picker" class="sr-only">Pracownik</label>
            <select
              id="employee-picker"
              [value]="selectedEmployeeId()"
              (change)="onEmployeeChange($event)"
              class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
            >
              @for (e of activeEmployees(); track e.id) {
                <option [value]="e.id">{{ e.name }}</option>
              }
            </select>
          </div>
        }
      </div>

      @if (initialLoading()) {
        <p class="mt-6 text-sm text-stone-500" role="status">Ładowanie kalendarza…</p>
      } @else if (employeesError(); as msg) {
        <p role="alert" class="alert-danger mt-6">{{ msg }}</p>
      } @else if (serverError(); as msg) {
        <p role="alert" class="alert-danger mt-6">{{ msg }}</p>
      } @else if (showEmptyEmployeesState()) {
        <p class="mt-6 text-sm text-stone-500">
          Nie masz aktywnych pracowników.
          <a routerLink="/business/employees" class="text-brand-600 underline"
            >Dodaj pracownika</a
          >, żeby zobaczyć kalendarz.
        </p>
      } @else {
        <div class="mt-6 overflow-x-auto">
          <div
            class="grid"
            [style.grid-template-columns]="gridTemplateColumns()"
            [style.grid-template-rows]="gridTemplateRows"
          >
            @for (col of columns(); track col.key; let i = $index) {
              <div
                class="border-b border-stone-200 bg-white py-2 text-sm font-semibold"
                [style.grid-column]="i + 2"
                [style.grid-row]="1"
              >
                {{ col.title }}
              </div>
            }

            @for (hour of hourMarks; track hour) {
              <div
                class="pr-2 text-right text-xs text-stone-400"
                [style.grid-column]="1"
                [style.grid-row]="hourRowStart(hour) + ' / span ' + slotsPerHour"
              >
                {{ hourLabel(hour) }}
              </div>
              <div
                class="pointer-events-none border-t border-stone-100"
                [style.grid-column]="'1 / -1'"
                [style.grid-row]="hourRowStart(hour)"
              ></div>
            }

            @for (col of columns(); track col.key; let i = $index) {
              @for (b of col.bookings; track b.id) {
                <button
                  type="button"
                  class="m-px overflow-hidden rounded-md px-2 py-1 text-left text-xs shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                  [class]="statusClass(b.status)"
                  [style.grid-column]="i + 2"
                  [style.grid-row]="tileGridRow(b)"
                  (click)="openDetails(b)"
                >
                  <p class="font-semibold">
                    {{ formatTime(b.startsAt) }}–{{ formatTime(b.endsAt) }}
                  </p>
                  <p class="truncate">{{ b.service.name }}</p>
                  <p class="truncate">{{ b.client.firstName }} {{ b.client.lastName }}</p>
                </button>
              }
            }
          </div>
        </div>
      }
    </div>

    <app-booking-details-dialog
      [booking]="selectedBooking()"
      (closed)="closeDetails()"
      (changed)="onBookingChanged($event)"
      (conflict)="onBookingConflict($event)"
    />
  `,
})
export default class BusinessCalendar {
  private readonly api = inject(ApiClient);
  private readonly authStore = inject(AuthStore);

  protected readonly viewMode = signal<CalendarViewMode>('day');
  protected readonly anchorDate = signal(todayInBusinessTz());
  protected readonly selectedEmployeeId = signal<string | null>(null);
  protected readonly employees = signal<CalendarEmployee[]>([]);
  protected readonly employeesLoading = signal(true);
  protected readonly bookings = signal<CalendarBooking[]>([]);
  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);
  // osobno od serverError (dotyczy tylko bookings) — inaczej udany refetch rezerwacji czyścił
  // komunikat o nieudanym pobraniu pracowników (oba dzieliły jeden sygnał)
  protected readonly employeesError = signal<string | null>(null);
  protected readonly selectedBooking = signal<CalendarBooking | null>(null);

  protected readonly isOwner = computed(
    () => this.authStore.user()?.role === 'OWNER',
  );
  protected readonly activeEmployees = computed(() =>
    this.employees().filter((e) => e.isActive),
  );
  // dopóki trwa którykolwiek z dwóch niezależnych fetchy (pracownicy + rezerwacje), stan
  // pusty/błędu nie ma jeszcze podstaw, żeby się pokazać — bez tego krótki flash "brak
  // pracowników" zdarzał się, zanim lista w ogóle wróciła z API
  protected readonly initialLoading = computed(
    () => this.loading() || (this.isOwner() && this.employeesLoading()),
  );
  // rezerwacja pracownika zdezaktywowanego po jej utworzeniu wciąż się liczy jako "coś do
  // pokazania" (patrz columns() niżej) — inaczej ten stan pokrywałby się z prawdziwym pustym
  // kalendarzem i chowałby rezerwację, którą da się kliknąć
  protected readonly showEmptyEmployeesState = computed(
    () => this.isOwner() && !this.activeEmployees().length && !this.bookings().length,
  );

  protected readonly rangeLabel = computed(() => {
    if (this.viewMode() === 'day') {
      return formatDayLabel(this.anchorDate());
    }
    const days = weekDays(this.anchorDate());
    return `${formatDayLabel(days[0])} – ${formatDayLabel(days[6])}`;
  });

  protected readonly columns = computed<CalendarColumn[]>(() => {
    if (this.viewMode() === 'day') {
      if (this.isOwner()) {
        const activeIds = new Set(this.activeEmployees().map((e) => e.id));
        const activeColumns = this.activeEmployees().map((e) => ({
          key: e.id,
          title: e.name,
          bookings: this.bookings().filter((b) => b.employee.id === e.id),
        }));
        // dzień pobiera rezerwacje wszystkich pracowników (bez filtra employeeId) — jeśli
        // któraś należy do kogoś spoza aktywnych (zdezaktywowany po utworzeniu rezerwacji,
        // employees.ts: "jeśli ma rezerwacje, zostanie dezaktywowany" właśnie po to, by
        // przetrwały), dostaje własną kolumnę zamiast zniknąć bez śladu; nazwa pracownika
        // jest już w odpowiedzi API, bez dodatkowego zapytania
        const extraNames = new Map<string, string>();
        for (const b of this.bookings()) {
          if (!activeIds.has(b.employee.id) && !extraNames.has(b.employee.id)) {
            extraNames.set(b.employee.id, b.employee.name);
          }
        }
        const extraColumns = Array.from(extraNames, ([id, name]) => ({
          key: id,
          title: name,
          bookings: this.bookings().filter((b) => b.employee.id === id),
        }));
        return [...activeColumns, ...extraColumns];
      }
      return [{ key: 'me', title: 'Twoje wizyty', bookings: this.bookings() }];
    }
    return weekDays(this.anchorDate()).map((dateIso) => ({
      key: dateIso,
      title: formatDayLabel(dateIso),
      bookings: this.bookings().filter(
        (b) => todayInBusinessTz(new Date(b.startsAt)) === dateIso,
      ),
    }));
  });

  protected readonly hourMarks = CALENDAR_HOUR_MARKS;
  protected readonly slotsPerHour = SLOTS_PER_HOUR;
  protected readonly gridTemplateColumns = computed(
    () => `5rem repeat(${Math.max(this.columns().length, 1)}, minmax(9rem, 1fr))`,
  );
  protected readonly gridTemplateRows = `3rem repeat(${CALENDAR_TOTAL_SLOTS}, 1.5rem)`;
  protected readonly formatTime = formatTime;

  // race-guard jak w booking-wizard.ts — nawigacja może wystrzelić kolejny fetch, zanim
  // poprzedni wróci; bez tego wolniejsza odpowiedź nadpisałaby świeższe dane
  private requestId = 0;

  constructor() {
    if (this.isOwner()) {
      void this.loadEmployees();
    } else {
      this.employeesLoading.set(false);
    }
    void this.loadBookings();
  }

  protected statusClass(status: CalendarBooking['status']): string {
    return STATUS_CLASSES[status];
  }

  protected setViewMode(mode: CalendarViewMode): void {
    if (this.viewMode() === mode) return;
    this.viewMode.set(mode);
    if (mode === 'week' && this.isOwner() && !this.selectedEmployeeId()) {
      const first = this.activeEmployees()[0];
      if (first) {
        this.selectedEmployeeId.set(first.id);
      }
    }
    void this.loadBookings();
  }

  protected navigate(delta: 1 | -1 | 'today'): void {
    if (delta === 'today') {
      this.anchorDate.set(todayInBusinessTz());
    } else {
      const step = this.viewMode() === 'week' ? delta * 7 : delta;
      this.anchorDate.update((d) => addDays(d, step));
    }
    void this.loadBookings();
  }

  protected onEmployeeChange(event: Event): void {
    this.selectedEmployeeId.set((event.target as HTMLSelectElement).value);
    void this.loadBookings();
  }

  protected openDetails(booking: CalendarBooking): void {
    this.selectedBooking.set(booking);
  }

  protected closeDetails(): void {
    this.selectedBooking.set(null);
  }

  // AC #33: akceptacja/odrzucenie/odwołanie aktualizuje kalendarz bez przeładowania — podmieniamy
  // status w sygnale zamiast refetchować całą siatkę. Dialog zamykamy tylko, gdy wciąż pokazuje
  // TĘ rezerwację — użytkownik mógł go w międzyczasie zamknąć i otworzyć inną, zanim spóźniona
  // odpowiedź na starą akcję wróciła (patrz code review #33)
  protected onBookingChanged({ id, status }: BookingChangedEvent): void {
    this.bookings.update((list) =>
      list.map((b) => (b.id === id ? { ...b, status } : b)),
    );
    if (this.selectedBooking()?.id === id) {
      this.closeDetails();
    }
  }

  // 409 — dane w dialogu były już nieaktualne (ktoś inny zdążył zdecydować), więc bierzemy
  // świeżą listę zamiast zgadywać nowy stan (wzorem my-bookings.ts)
  protected onBookingConflict({ id }: { id: string }): void {
    if (this.selectedBooking()?.id === id) {
      this.closeDetails();
    }
    void this.loadBookings();
  }

  protected hourRowStart(hour: number): number {
    return 2 + (hour * 60 - CALENDAR_WINDOW_START_MIN) / CALENDAR_SLOT_MIN;
  }

  protected hourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
  }

  protected tileGridRow(booking: CalendarBooking): string {
    const { rowStart, rowEnd } = bookingGridRow(booking.startsAt, booking.endsAt);
    return `${rowStart} / ${rowEnd}`;
  }

  private async loadEmployees(): Promise<void> {
    this.employeesError.set(null);
    try {
      const list = await firstValueFrom(
        this.api.get<CalendarEmployee[]>('/businesses/mine/employees'),
      );
      this.employees.set(list);
      const firstActive = list.find((e) => e.isActive);
      if (firstActive && !this.selectedEmployeeId()) {
        this.selectedEmployeeId.set(firstActive.id);
        // pracownicy mogli wrócić z API już PO przełączeniu na tydzień (setViewMode nie miał
        // wtedy kogo wybrać) — bez tego dogonienia widok tygodnia zostawałby z rezerwacjami
        // wszystkich pracowników aż do ręcznej nawigacji
        if (this.viewMode() === 'week') {
          void this.loadBookings();
        }
      }
    } catch {
      this.employeesError.set('Nie udało się wczytać pracowników.');
    } finally {
      this.employeesLoading.set(false);
    }
  }

  private async loadBookings(): Promise<void> {
    const { from, to } = rangeForView(this.viewMode(), this.anchorDate());
    const query = new URLSearchParams({ from, to });
    if (this.isOwner() && this.viewMode() === 'week') {
      const employeeId = this.selectedEmployeeId();
      if (employeeId) {
        query.set('employeeId', employeeId);
      }
    }

    const requestId = ++this.requestId;
    this.loading.set(true);
    this.serverError.set(null);
    try {
      const bookings = await firstValueFrom(
        this.api.get<CalendarBooking[]>(`/businesses/mine/bookings?${query}`),
      );
      if (requestId !== this.requestId) return;
      this.bookings.set(bookings);
    } catch (err) {
      if (requestId !== this.requestId) return;
      this.serverError.set(apiErrorMessage(err));
      this.bookings.set([]);
    } finally {
      if (requestId === this.requestId) {
        this.loading.set(false);
      }
    }
  }
}
