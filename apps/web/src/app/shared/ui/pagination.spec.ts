import { ComponentFixture, TestBed } from '@angular/core/testing';
import Pagination from './pagination';

async function setup(inputs: { page: number; limit: number; total: number }) {
  await TestBed.configureTestingModule({ imports: [Pagination] }).compileComponents();
  const fixture = TestBed.createComponent(Pagination);
  fixture.componentRef.setInput('page', inputs.page);
  fixture.componentRef.setInput('limit', inputs.limit);
  fixture.componentRef.setInput('total', inputs.total);
  fixture.componentRef.setInput('itemsLabel', 'firm');
  fixture.detectChanges();
  return fixture;
}

const text = (fixture: ComponentFixture<Pagination>) =>
  ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim();

const buttonWith = (fixture: ComponentFixture<Pagination>, label: string) =>
  Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
  ).find((b) => (b.textContent ?? '').trim() === label);

describe('Pagination', () => {
  it('nie renderuje nawigacji, gdy wszystko mieści się na jednej stronie', async () => {
    const fixture = await setup({ page: 1, limit: 20, total: 20 });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('nav'),
    ).toBeNull();
  });

  it('pokazuje zakres pozycji i sumę', async () => {
    const fixture = await setup({ page: 2, limit: 20, total: 47 });
    expect(text(fixture)).toContain('21–40 z 47 firm');
  });

  it('na ostatniej, niepełnej stronie kończy zakres na liczbie wyników', async () => {
    const fixture = await setup({ page: 3, limit: 20, total: 47 });
    expect(text(fixture)).toContain('41–47 z 47 firm');
  });

  it('wyłącza „Poprzednia" na pierwszej stronie', async () => {
    const fixture = await setup({ page: 1, limit: 20, total: 47 });
    expect(buttonWith(fixture, '‹ Poprzednia')?.disabled).toBe(true);
    expect(buttonWith(fixture, 'Następna ›')?.disabled).toBe(false);
  });

  it('wyłącza „Następna" na ostatniej stronie', async () => {
    const fixture = await setup({ page: 3, limit: 20, total: 47 });
    expect(buttonWith(fixture, '‹ Poprzednia')?.disabled).toBe(false);
    expect(buttonWith(fixture, 'Następna ›')?.disabled).toBe(true);
  });

  it('oznacza bieżącą stronę przez aria-current', async () => {
    const fixture = await setup({ page: 2, limit: 20, total: 47 });
    const current = (fixture.nativeElement as HTMLElement).querySelector(
      '[aria-current="page"]',
    );
    expect(current?.textContent?.trim()).toBe('2');
  });

  it('przy wielu stronach pokazuje okno numerów wokół bieżącej', async () => {
    const fixture = await setup({ page: 10, limit: 20, total: 400 });
    const numbers = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        'button[aria-label^="Strona"]',
      ),
    ).map((b) => (b.textContent ?? '').trim());
    expect(numbers).toEqual(['8', '9', '10', '11', '12']);
  });

  it('domyślnie osadza się jak stopka tabeli, ale ramkę da się podmienić', async () => {
    const fixture = await setup({ page: 1, limit: 20, total: 47 });
    const nav = () => (fixture.nativeElement as HTMLElement).querySelector('nav');

    expect(nav()?.className).toContain('border-t');

    fixture.componentRef.setInput('frameClass', 'mt-6');
    fixture.detectChanges();

    expect(nav()?.className).not.toContain('border-t');
    expect(nav()?.className).toContain('mt-6');
    // klasy własne paska (układ, typografia) zostają niezależnie od ramki
    expect(nav()?.className).toContain('justify-between');
  });

  it('klik numeru zgłasza zmianę strony rodzicowi', async () => {
    const fixture = await setup({ page: 1, limit: 20, total: 47 });
    const emitted: number[] = [];
    fixture.componentInstance.pageChange.subscribe((p) => emitted.push(p));

    buttonWith(fixture, '3')?.click();
    buttonWith(fixture, 'Następna ›')?.click();

    expect(emitted).toEqual([3, 2]);
  });
});
