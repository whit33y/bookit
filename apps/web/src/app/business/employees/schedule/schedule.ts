import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { dateTimeFormat } from '../../../core/i18n/intl';
import { I18nStore } from '../../../core/i18n/i18n-store';
import type { TranslationKey } from '../../../core/i18n/pl';
import { translate } from '../../../core/i18n/translate';
import { ApiClient, apiErrorMessage } from '../../../core/api-client';
import EmptyState from '../../../shared/ui/empty-state';
import ErrorState from '../../../shared/ui/error-state';
import LoadingState from '../../../shared/ui/loading-state';

// lustrzane do backendu: DaySchedule (working-hours.service) i timeOffSelect (time-offs.service)
interface Slot {
  startTime: string; // "HH:mm"
  endTime: string;
}
interface DaySchedule {
  weekday: number; // 0 = poniedziałek … 6 = niedziela
  slots: Slot[];
}
interface TimeOff {
  id: string;
  startsAt: string; // ISO
  endsAt: string;
  reason: string | null;
}

// indeks 0 = poniedziałek (jak `weekday` w backendowym DaySchedule) — kolejność musi zostać
const DAY_KEYS: TranslationKey[] = [
  'schedule.weekday.monday',
  'schedule.weekday.tuesday',
  'schedule.weekday.wednesday',
  'schedule.weekday.thursday',
  'schedule.weekday.friday',
  'schedule.weekday.saturday',
  'schedule.weekday.sunday',
];

@Component({
  selector: 'app-business-schedule',
  imports: [RouterLink, LoadingState, ErrorState, EmptyState],
  template: `
    <div class="flex flex-1 justify-center px-4 py-8">
      <section
        class="w-full max-w-3xl rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        <a
          routerLink="/business/employees"
          class="text-sm font-medium text-brand-600 hover:underline"
        >
          {{ i18n.t('schedule.back') }}
        </a>
        <h1 class="mt-3 text-2xl font-bold">{{ i18n.t('schedule.title') }}</h1>
        <p class="mt-1 text-sm text-stone-500">{{ i18n.t('schedule.subtitle') }}</p>

        @if (loading()) {
          <app-loading-state class="mt-6" [message]="i18n.t('schedule.loading')" />
        } @else if (loadError(); as msg) {
          <app-error-state
            class="mt-6"
            [message]="msg"
            [retryable]="true"
            (retry)="load()"
          />
        } @else {
          @if (serverError(); as msg) {
            <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
          }
          @if (saved()) {
            <p
              role="status"
              class="mt-4 rounded-lg bg-emerald-50 px-3.5 py-2 text-sm font-medium text-emerald-700"
            >
              {{ i18n.t('schedule.saved') }}
            </p>
          }

          <!-- Grafik tygodniowy -->
          <div class="mt-6 flex flex-col gap-4">
            @for (slots of days(); track $index; let weekday = $index) {
              <fieldset class="rounded-lg border border-stone-200 p-4">
                <legend class="px-1 text-sm font-semibold">
                  {{ dayName(weekday) }}
                </legend>

                @if (!slots.length) {
                  <p class="text-[13px] text-stone-400">
                    {{ i18n.t('schedule.dayOff') }}
                  </p>
                }

                @for (slot of slots; track $index; let i = $index) {
                  <div class="mt-2 flex items-center gap-2">
                    <label class="sr-only" [for]="'start-' + weekday + '-' + i"
                      >{{ i18n.t('schedule.slotStart') }}</label
                    >
                    <input
                      [id]="'start-' + weekday + '-' + i"
                      type="time"
                      [value]="slot.startTime"
                      (input)="setSlot(weekday, i, 'startTime', $event)"
                      class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
                    />
                    <span class="text-stone-400">–</span>
                    <label class="sr-only" [for]="'end-' + weekday + '-' + i"
                      >{{ i18n.t('schedule.slotEnd') }}</label
                    >
                    <input
                      [id]="'end-' + weekday + '-' + i"
                      type="time"
                      [value]="slot.endTime"
                      (input)="setSlot(weekday, i, 'endTime', $event)"
                      class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
                    />
                    <button
                      type="button"
                      class="text-sm font-medium text-rose-600 hover:underline"
                      (click)="removeSlot(weekday, i)"
                    >
                      {{ i18n.t('schedule.removeSlot') }}
                    </button>
                  </div>
                }

                @if (dayErrors()[weekday]; as err) {
                  <p role="alert" class="alert-danger mt-2">{{ err }}</p>
                }

                <button
                  type="button"
                  class="mt-3 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium shadow-card transition hover:bg-stone-50"
                  (click)="addSlot(weekday)"
                >
                  {{ i18n.t('schedule.addSlot') }}
                </button>
              </fieldset>
            }
          </div>

          <button
            type="button"
            class="btn-primary mt-6 w-auto"
            [disabled]="hasErrors() || saving()"
            (click)="onSave()"
          >
            {{ saving() ? i18n.t('schedule.saving') : i18n.t('schedule.save') }}
          </button>

          <!-- Urlopy -->
          <div class="mt-10 border-t border-stone-200 pt-8">
            <h2 class="text-lg font-semibold">
              {{ i18n.t('schedule.timeOff.title') }}
            </h2>
            <p class="mt-1 text-sm text-stone-500">
              {{ i18n.t('schedule.timeOff.subtitle') }}
            </p>

            @if (timeOffError(); as msg) {
              <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
            }

            <div class="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label for="to-start" class="mb-1.5 block text-sm font-medium"
                  >{{ i18n.t('schedule.timeOff.from') }}</label
                >
                <input
                  id="to-start"
                  type="datetime-local"
                  [value]="toModel().startsAt"
                  (input)="setTimeOff('startsAt', $event)"
                  class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
                />
              </div>
              <div>
                <label for="to-end" class="mb-1.5 block text-sm font-medium"
                  >{{ i18n.t('schedule.timeOff.to') }}</label
                >
                <input
                  id="to-end"
                  type="datetime-local"
                  [value]="toModel().endsAt"
                  (input)="setTimeOff('endsAt', $event)"
                  class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
                />
              </div>
              <div class="flex-1">
                <label for="to-reason" class="mb-1.5 block text-sm font-medium"
                  >{{ i18n.t('schedule.timeOff.reason') }}</label
                >
                <input
                  id="to-reason"
                  type="text"
                  maxlength="200"
                  [value]="toModel().reason"
                  (input)="setTimeOff('reason', $event)"
                  class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
                />
              </div>
              <button
                type="button"
                class="btn-primary w-auto"
                [disabled]="!timeOffValid() || timeOffAdding()"
                (click)="onAddTimeOff()"
              >
                {{
                  timeOffAdding()
                    ? i18n.t('schedule.timeOff.adding')
                    : i18n.t('schedule.timeOff.add')
                }}
              </button>
            </div>

            <ul class="mt-6 flex flex-col gap-3">
              @for (t of timeOffs(); track t.id) {
                <li
                  class="flex items-start justify-between gap-4 rounded-lg border border-stone-200 p-4"
                >
                  <div>
                    <span class="font-medium"
                      >{{
                        i18n.t('schedule.timeOff.range', {
                          from: fmt(t.startsAt),
                          to: fmt(t.endsAt),
                        })
                      }}</span
                    >
                    @if (t.reason) {
                      <p class="mt-0.5 text-[13px] text-stone-500">
                        {{ t.reason }}
                      </p>
                    }
                  </div>
                  <button
                    type="button"
                    class="text-sm font-medium text-rose-600 hover:underline disabled:text-stone-400"
                    [disabled]="timeOffBusy() === t.id"
                    (click)="onDeleteTimeOff(t)"
                  >
                    {{ i18n.t('schedule.timeOff.delete') }}
                  </button>
                </li>
              } @empty {
                <li>
                  <app-empty-state [title]="i18n.t('schedule.timeOff.empty')" />
                </li>
              }
            </ul>
          </div>
        }
      </section>
    </div>
  `,
})
export default class BusinessSchedule {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);
  private readonly route = inject(ActivatedRoute);
  private readonly employeeId = signal('');
  // getter, nie stała — komponent bywa reużywany przy zmianie tylko :id (patrz constructor)
  private get base(): string {
    return `/businesses/mine/employees/${this.employeeId()}`;
  }

  protected readonly loading = signal(true);
  /** Błąd pobrania grafiku (retry ma sens) — osobno od serverError zapisu. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly serverError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  // 7 pozycji (poniedziałek…niedziela), każda to lista przedziałów danego dnia
  protected readonly days = signal<Slot[][]>(Array.from({ length: 7 }, () => []));

  protected readonly timeOffs = signal<TimeOff[]>([]);
  protected readonly timeOffError = signal<string | null>(null);
  protected readonly timeOffAdding = signal(false);
  protected readonly timeOffBusy = signal<string | null>(null);
  protected readonly toModel = signal({ startsAt: '', endsAt: '', reason: '' });

  // walidacja per dzień przed zapisem: start<koniec i brak nachodzenia przedziałów
  protected readonly dayErrors = computed(() =>
    this.days().map((slots) => this.validateDay(slots)),
  );
  protected readonly hasErrors = computed(() =>
    this.dayErrors().some((e) => e !== null),
  );
  protected readonly timeOffValid = computed(() => {
    const m = this.toModel();
    // datetime-local ma stały format → porównanie stringów zachowuje kolejność
    return !!m.startsAt && !!m.endsAt && m.startsAt < m.endsAt;
  });

  constructor() {
    // paramMap (nie snapshot): Angular reużywa instancję gdy zmienia się tylko :id,
    // więc przeładuj grafik na każdą zmianę pracownika w URL
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.employeeId.set(params.get('id') ?? '');
      this.load();
    });
  }

  /** Wywoływane też z retry po nieudanym pobraniu — dlatego protected, nie private. */
  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.serverError.set(null);
    this.saved.set(false);
    this.days.set(Array.from({ length: 7 }, () => []));
    this.timeOffs.set([]);
    this.toModel.set({ startsAt: '', endsAt: '', reason: '' });
    Promise.all([
      firstValueFrom(
        this.api.get<DaySchedule[]>(`${this.base}/working-hours`),
      ).then((res) => this.setDays(res)),
      firstValueFrom(this.api.get<TimeOff[]>(`${this.base}/time-offs`)).then(
        (res) => this.timeOffs.set(res),
      ),
    ])
      .catch((err: unknown) =>
        this.loadError.set(
          translate('schedule.error.load', { detail: apiErrorMessage(err) }),
        ),
      )
      .finally(() => this.loading.set(false));
  }

  protected dayName(weekday: number): string {
    return this.i18n.t(DAY_KEYS[weekday]);
  }

  protected fmt(iso: string): string {
    return dateTimeFormat({ dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  }

  protected addSlot(weekday: number): void {
    this.saved.set(false);
    this.days.update((days) =>
      days.map((slots, w) =>
        w === weekday
          ? [...slots, { startTime: '09:00', endTime: '17:00' }]
          : slots,
      ),
    );
  }

  protected removeSlot(weekday: number, index: number): void {
    this.saved.set(false);
    this.days.update((days) =>
      days.map((slots, w) =>
        w === weekday ? slots.filter((_, i) => i !== index) : slots,
      ),
    );
  }

  protected setSlot(
    weekday: number,
    index: number,
    field: 'startTime' | 'endTime',
    event: Event,
  ): void {
    this.saved.set(false);
    const value = (event.target as HTMLInputElement).value;
    this.days.update((days) =>
      days.map((slots, w) =>
        w === weekday
          ? slots.map((s, i) => (i === index ? { ...s, [field]: value } : s))
          : slots,
      ),
    );
  }

  protected setTimeOff(
    field: 'startsAt' | 'endsAt' | 'reason',
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).value;
    this.toModel.update((m) => ({ ...m, [field]: value }));
  }

  protected async onSave(): Promise<void> {
    if (this.hasErrors()) return;
    this.serverError.set(null);
    this.saved.set(false);
    this.saving.set(true);
    try {
      // spłaszcz grafik do płaskiej listy slotów (PUT zastępuje całość)
      const slots = this.days().flatMap((daySlots, weekday) =>
        daySlots.map((s) => ({
          weekday,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      );
      const res = await firstValueFrom(
        this.api.put<DaySchedule[]>(`${this.base}/working-hours`, { slots }),
      );
      this.setDays(res);
      this.saved.set(true);
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected async onAddTimeOff(): Promise<void> {
    if (!this.timeOffValid()) return;
    this.timeOffError.set(null);
    this.timeOffAdding.set(true);
    try {
      const m = this.toModel();
      const payload = {
        startsAt: new Date(m.startsAt).toISOString(),
        endsAt: new Date(m.endsAt).toISOString(),
        ...(m.reason ? { reason: m.reason } : {}),
      };
      const created = await firstValueFrom(
        this.api.post<TimeOff>(`${this.base}/time-offs`, payload),
      );
      this.timeOffs.update((list) =>
        [...list, created].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
      this.toModel.set({ startsAt: '', endsAt: '', reason: '' });
    } catch (err) {
      this.timeOffError.set(apiErrorMessage(err));
    } finally {
      this.timeOffAdding.set(false);
    }
  }

  protected async onDeleteTimeOff(t: TimeOff): Promise<void> {
    const ok = globalThis.confirm(
      translate('schedule.timeOff.deleteConfirm', {
        from: this.fmt(t.startsAt),
        to: this.fmt(t.endsAt),
      }),
    );
    if (!ok) return;
    this.timeOffError.set(null);
    this.timeOffBusy.set(t.id);
    try {
      await firstValueFrom(
        this.api.delete(`${this.base}/time-offs/${t.id}`),
      );
      this.timeOffs.update((list) => list.filter((x) => x.id !== t.id));
    } catch (err) {
      this.timeOffError.set(apiErrorMessage(err));
    } finally {
      this.timeOffBusy.set(null);
    }
  }

  // GET/PUT zwracają zawsze 7 dni; mapujemy po weekday na tablicę indeksowaną 0..6
  private setDays(schedule: DaySchedule[]): void {
    const byDay: Slot[][] = Array.from({ length: 7 }, () => []);
    for (const d of schedule) {
      byDay[d.weekday] = d.slots.map((s) => ({ ...s }));
    }
    this.days.set(byDay);
  }

  private validateDay(slots: Slot[]): string | null {
    for (const s of slots) {
      if (!s.startTime || !s.endTime)
        return translate('schedule.error.timesRequired');
      if (s.startTime >= s.endTime)
        return translate('schedule.error.startAfterEnd');
    }
    const sorted = [...slots].sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    );
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startTime < sorted[i - 1].endTime)
        return translate('schedule.error.overlap');
    }
    return null;
  }
}
