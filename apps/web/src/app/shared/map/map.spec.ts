import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import AppMap, { MapPin } from './map';

@Component({
  selector: 'app-map-host',
  imports: [AppMap],
  template: `<app-map
    [pins]="pins()"
    [activeId]="activeId()"
    [userLocation]="userLocation()"
    (pinClick)="lastClicked = $event"
  />`,
})
class MapHost {
  readonly pins = signal<MapPin[]>([]);
  readonly activeId = signal<string | null>(null);
  readonly userLocation = signal<{ lat: number; lng: number } | null>(null);
  lastClicked: string | null = null;
}

describe('AppMap (tryb wielu pinów)', () => {
  async function setup() {
    await TestBed.configureTestingModule({ imports: [MapHost] }).compileComponents();
    const fixture = TestBed.createComponent(MapHost);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('renderuje marker na każdy pin i emituje pinClick po kliknięciu', async () => {
    const fixture = await setup();
    fixture.componentInstance.pins.set([
      { id: 'b1', lat: 52.23, lng: 21.01 },
      { id: 'b2', lat: 52.24, lng: 21.02 },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    const markers = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.leaflet-marker-icon',
    );
    expect(markers.length).toBe(2);

    (markers[0] as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(fixture.componentInstance.lastClicked).toBe('b1');
  });

  it('usuwa marker piny, których już nie ma na nowej liście', async () => {
    const fixture = await setup();
    fixture.componentInstance.pins.set([
      { id: 'b1', lat: 52.23, lng: 21.01 },
      { id: 'b2', lat: 52.24, lng: 21.02 },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.pins.set([{ id: 'b1', lat: 52.23, lng: 21.01 }]);
    fixture.detectChanges();
    await fixture.whenStable();

    const markers = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.leaflet-marker-icon',
    );
    expect(markers.length).toBe(1);
  });

  it('zmiana activeId nie usuwa ani nie dodaje markerów — tylko podświetla', async () => {
    const fixture = await setup();
    fixture.componentInstance.pins.set([
      { id: 'b1', lat: 52.23, lng: 21.01 },
      { id: 'b2', lat: 52.24, lng: 21.02 },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.activeId.set('b2');
    fixture.detectChanges();
    await fixture.whenStable();

    const markers = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.leaflet-marker-icon',
    );
    expect(markers.length).toBe(2);
  });

  it('pokazuje marker lokalizacji użytkownika obok pinów wyników', async () => {
    const fixture = await setup();
    fixture.componentInstance.pins.set([{ id: 'b1', lat: 52.23, lng: 21.01 }]);
    fixture.componentInstance.userLocation.set({ lat: 52.25, lng: 21.05 });
    fixture.detectChanges();
    await fixture.whenStable();

    const markers = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.leaflet-marker-icon',
    );
    expect(markers.length).toBe(2);
  });

  it('centruje mapę na userze, gdy lista wyników jest pusta', async () => {
    const fixture = await setup();
    fixture.componentInstance.userLocation.set({ lat: 52.25, lng: 21.05 });
    fixture.detectChanges();
    await fixture.whenStable();

    const markers = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.leaflet-marker-icon',
    );
    expect(markers.length).toBe(1);
  });
});
