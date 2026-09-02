import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import CountPreview, { type PreviewItem } from './count-preview';

@Component({
  imports: [CountPreview],
  template: `
    <app-dashboard-count-preview
      [headline]="headline()"
      [note]="note()"
      [items]="items()"
    />
  `,
})
class PreviewHost {
  readonly headline = signal('2 aktywne usługi');
  readonly note = signal('');
  readonly items = signal<PreviewItem[]>([]);
}

/** Gospodarz trzyma wejścia w sygnałach — aplikacja jest zoneless, jak w dashboard-tile.spec.ts. */
async function render(arrange: (host: PreviewHost) => void = () => undefined) {
  await TestBed.configureTestingModule({
    imports: [PreviewHost],
  }).compileComponents();
  const fixture = TestBed.createComponent(PreviewHost);
  arrange(fixture.componentInstance);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const items = (el: HTMLElement) => [...el.querySelectorAll('li')];

describe('CountPreview', () => {
  it('nagłówkiem podglądu jest licznik podany przez kafelek', async () => {
    const { el } = await render();

    expect(el.textContent).toContain('2 aktywne usługi');
  });

  it('bez dopowiedzenia nie rysuje pustego wiersza pod licznikiem', async () => {
    const { el } = await render();

    expect(el.querySelectorAll('p')).toHaveLength(1);
  });

  it('dopowiedzenie stoi przy liczniku, a nie w próbce', async () => {
    const { el } = await render((host) => {
      host.note.set('Nieaktywni: 2');
      host.items.set([{ id: 'a', primary: 'Ola' }]);
    });

    expect(el.textContent).toContain('Nieaktywni: 2');
    expect(items(el).map((li) => li.textContent?.trim())).toEqual(['Ola']);
  });

  it('pozycja bez drugiej linii zostaje samym imieniem', async () => {
    const { el } = await render((host) =>
      host.items.set([{ id: 'a', primary: 'Ola' }]),
    );

    expect(items(el)[0].querySelectorAll('span')).toHaveLength(1);
  });

  it('pozycja z drugą linią pokazuje obie, każdą w swoim wierszu', async () => {
    const { el } = await render((host) =>
      host.items.set([
        { id: 's1', primary: 'Strzyżenie', secondary: '30 min · 80 zł' },
      ]),
    );
    const lines = [...items(el)[0].querySelectorAll('span')];

    expect(lines.map((span) => span.textContent?.trim())).toEqual([
      'Strzyżenie',
      '30 min · 80 zł',
    ]);
  });

  it('pusta próbka zostawia sam licznik — o tym, czy zero ma sens, decyduje kafelek', async () => {
    const { el } = await render();

    expect(items(el)).toHaveLength(0);
  });

  // kafelki stoją w siatce o wspólnej wysokości wiersza — długa nazwa musi się uciąć,
  // a nie rozepchać karty
  it('obie linie pozycji są ucinane, nie zawijane', async () => {
    const { el } = await render((host) =>
      host.items.set([
        { id: 's1', primary: 'Bardzo długa nazwa usługi', secondary: '30 min' },
      ]),
    );

    for (const span of items(el)[0].querySelectorAll('span')) {
      expect(span.className).toContain('truncate');
    }
  });
});
