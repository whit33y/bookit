import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { settle } from '../public/testing-helpers';
import ReviewDialog, { ReviewSubmission } from './review-dialog';

// jsdom nie implementuje showModal()/close() — ten sam lokalny polyfill co w
// shared/confirm-dialog.spec.ts i business/calendar/booking-details-dialog.spec.ts
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

async function open(inputs: Record<string, unknown> = {}) {
  await TestBed.configureTestingModule({ imports: [ReviewDialog] }).compileComponents();
  const fixture = TestBed.createComponent(ReviewDialog);
  const submissions: ReviewSubmission[] = [];
  const cancels: number[] = [];
  fixture.componentInstance.submitted.subscribe((s) => submissions.push(s));
  fixture.componentInstance.cancelled.subscribe(() => cancels.push(1));

  fixture.componentRef.setInput('serviceName', 'Masaż relaksacyjny');
  fixture.componentRef.setInput('startsAt', '2026-08-03T07:00:00.000Z');
  fixture.componentRef.setInput('open', true);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges();

  const el = fixture.nativeElement as HTMLElement;
  const text = () => el.textContent ?? '';
  const stars = () => [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const comment = () => el.querySelector<HTMLTextAreaElement>('#review-comment')!;
  const button = (label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(label),
    )!;

  const pickStar = async (value: number) => {
    stars()[value - 1].click();
    await settle(fixture);
    fixture.detectChanges();
  };
  const type = async (value: string) => {
    comment().value = value;
    comment().dispatchEvent(new Event('input'));
    await settle(fixture);
    fixture.detectChanges();
  };
  const send = async () => {
    button('Wyślij ocenę').click();
    await settle(fixture);
    fixture.detectChanges();
  };

  return { fixture, el, text, stars, comment, button, pickStar, type, send, submissions, cancels };
}

describe('ReviewDialog', () => {
  it('pokazuje, której wizyty dotyczy ocena', async () => {
    const ctx = await open();

    expect(ctx.text()).toContain('Oceń wizytę');
    expect(ctx.text()).toContain('Masaż relaksacyjny');
  });

  it('gwiazdki to natywna grupa radio z opisem dla czytnika ekranu', async () => {
    const ctx = await open();

    expect(ctx.stars()).toHaveLength(5);
    expect(ctx.el.querySelector('legend')?.textContent?.trim()).toBe('Ocena');
    expect(ctx.el.querySelectorAll('label')[3].textContent).toContain('4 gwiazdki');
  });

  it('bez wybranej oceny nie wysyła i tłumaczy, czego brakuje', async () => {
    const ctx = await open();

    await ctx.send();

    expect(ctx.submissions).toHaveLength(0);
    expect(ctx.text()).toContain('Wybierz ocenę od 1 do 5');
  });

  it('wybór gwiazdki gasi błąd i wysyła ocenę bez komentarza jako null', async () => {
    const ctx = await open();

    await ctx.send();
    await ctx.pickStar(4);

    expect(ctx.text()).not.toContain('Wybierz ocenę od 1 do 5');

    await ctx.send();

    expect(ctx.submissions).toEqual([{ rating: 4, comment: null }]);
  });

  it('komentarz trafia do ładunku przycięty z białych znaków', async () => {
    const ctx = await open();

    await ctx.pickStar(5);
    await ctx.type('  bardzo miła obsługa  ');
    await ctx.send();

    expect(ctx.submissions).toEqual([
      { rating: 5, comment: 'bardzo miła obsługa' },
    ]);
  });

  it('sam biały znak w komentarzu to wciąż brak komentarza', async () => {
    const ctx = await open();

    await ctx.pickStar(3);
    await ctx.type('   ');
    await ctx.send();

    expect(ctx.submissions).toEqual([{ rating: 3, comment: null }]);
  });

  it('licznik znaków pokazuje limit z DTO backendu', async () => {
    const ctx = await open();

    expect(ctx.text()).toContain('0/500 znaków');

    await ctx.type('abc');

    expect(ctx.text()).toContain('3/500 znaków');
  });

  it('komentarz ponad limit blokuje wysyłkę zamiast czekać na 400 z serwera', async () => {
    const ctx = await open();

    await ctx.pickStar(5);
    await ctx.type('x'.repeat(501));
    await ctx.send();

    expect(ctx.submissions).toHaveLength(0);
    expect(ctx.text()).toContain('Komentarz może mieć maksymalnie 500 znaków');
    expect(ctx.comment().getAttribute('aria-invalid')).toBe('true');
  });

  it('w trakcie wysyłki przyciski są zablokowane', async () => {
    const ctx = await open({ busy: true });

    expect(ctx.button('Wysyłanie…').disabled).toBe(true);
    expect(ctx.button('Wróć').disabled).toBe(true);
  });

  it('pokazuje błąd serwera jako alert', async () => {
    const ctx = await open({ serverError: 'Ta wizyta ma już recenzję' });

    expect(ctx.el.querySelector('[role="alert"]')?.textContent).toContain(
      'Ta wizyta ma już recenzję',
    );
  });

  it('„Wróć" zamyka modal i melduje rodzicowi anulowanie', async () => {
    const ctx = await open();

    ctx.button('Wróć').click();
    await settle(ctx.fixture);

    expect(ctx.cancels).toHaveLength(1);
  });

  it('ponowne otwarcie czyści ocenę i błędy z poprzedniej wizyty', async () => {
    const ctx = await open();

    await ctx.send(); // zostawia błąd walidacji
    await ctx.pickStar(2);
    await ctx.type('coś tam');

    ctx.fixture.componentRef.setInput('open', false);
    ctx.fixture.detectChanges();
    ctx.fixture.componentRef.setInput('open', true);
    ctx.fixture.detectChanges();
    await settle(ctx.fixture);
    ctx.fixture.detectChanges();

    expect(ctx.stars().some((s) => s.checked)).toBe(false);
    expect(ctx.comment().value).toBe('');
    expect(ctx.text()).not.toContain('Wybierz ocenę od 1 do 5');
  });
});
