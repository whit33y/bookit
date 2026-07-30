import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';

// Widok domyślny, dopóki nie ma współrzędnych — środek Polski.
const POLAND_CENTER: L.LatLngTuple = [52.0, 19.0];
const POLAND_ZOOM = 6;
const PIN_ZOOM = 15;

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
}

// Pinezka jako divIcon (SVG), a nie domyślny marker Leafletu — omija problem
// z pakowaniem obrazków marker-icon.png przez esbuild. Kolor z tokenu --brand-700
// przez currentColor, żeby pinezka podążała za design systemem.
const PIN_ICON = L.divIcon({
  className: '',
  html: `<span style="color: var(--brand-700)"><svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 2C7.6 2 4 5.6 4 10c0 5.4 7 11.5 7.3 11.7.4.4 1 .4 1.4 0C13 21.5 20 15.4 20 10c0-4.4-3.6-8-8-8Zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/>
  </svg></span>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

// Wersja podświetlona (pin aktywny w wynikach wyszukiwarki, #35) — większa i ciemniejsza,
// żeby było widać, który wynik z listy odpowiada zaznaczonej pinezce.
const ACTIVE_PIN_ICON = L.divIcon({
  className: '',
  html: `<span style="color: var(--brand-900, #4a2b12)"><svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 2C7.6 2 4 5.6 4 10c0 5.4 7 11.5 7.3 11.7.4.4 1 .4 1.4 0C13 21.5 20 15.4 20 10c0-4.4-3.6-8-8-8Zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/>
  </svg></span>`,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
});

// Pozycja użytkownika (geolokalizacja, #36) — niebieska kropka zamiast pinezki firmy,
// żeby wizualnie nie mylić jej z wynikami wyszukiwania.
const USER_LOCATION_ICON = L.divIcon({
  className: '',
  html: `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:#2563eb;border:3px solid white;box-shadow:0 0 0 1px #2563eb;" aria-hidden="true"></span>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/** Mapa Leaflet: albo jeden punkt (`lat`/`lng` — profil firmy, formularz założenia firmy),
 *  albo wiele pinów (`pins` — lista wyników wyszukiwarki, #35). Gdy `pins` jest niepuste,
 *  ma pierwszeństwo nad `lat`/`lng`. */
@Component({
  selector: 'app-map',
  host: { class: 'block' },
  template: `<div
    #mapEl
    [class]="'w-full rounded-lg ' + heightClass()"
    role="region"
    [attr.aria-label]="ariaLabel()"
  ></div>`,
})
export default class AppMap {
  readonly lat = input<number | null>(null);
  readonly lng = input<number | null>(null);
  readonly pins = input<MapPin[]>([]);
  readonly activeId = input<string | null>(null);
  // pozycja użytkownika (geolokalizacja, #36) — pokazana obok pinów, nie zastępuje ich
  readonly userLocation = input<{ lat: number; lng: number } | null>(null);
  readonly ariaLabel = input('Lokalizacja firmy na mapie');
  // strona wyników (#35) potrzebuje wyższej mapy niż domyślna h-64 z profilu firmy
  readonly heightClass = input('h-64');
  readonly pinClick = output<string>();

  private readonly mapEl =
    viewChild.required<ElementRef<HTMLElement>>('mapEl');
  private map?: L.Map;
  private marker?: L.Marker;
  private userMarker?: L.Marker;
  private readonly pinMarkers = new Map<string, L.Marker>();

  constructor() {
    afterNextRender(() => {
      this.map = L.map(this.mapEl().nativeElement).setView(
        POLAND_CENTER,
        POLAND_ZOOM,
      );
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(this.map);
      this.sync();
    });
    // effect może odpalić przed pierwszym renderem — sync() sam pilnuje, że mapa istnieje.
    // Celowo NIE zależy od activeId: pełny sync robi fitBounds, a hover karty na liście
    // (który tylko zmienia activeId) resetowałby wtedy ręczne przybliżenie mapy przez usera.
    effect(() => {
      this.lat();
      this.lng();
      this.pins();
      this.userLocation();
      untracked(() => this.sync());
    });
    // samo podświetlenie aktywnego pina — bez przeliczania bounds/widoku
    effect(() => {
      const activeId = this.activeId();
      untracked(() => this.updateActiveIcon(activeId));
    });
    // bez remove() instancja mapy, panele DOM i listenery zostają po zniszczeniu komponentu
    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  private sync(): void {
    const map = this.map;
    if (!map) {
      return;
    }
    const pins = this.pins();
    // pusta lista wyników + geolokalizacja usera (#36) też idzie trybem "pinów" —
    // inaczej mapa zostałaby wyśrodkowana na Polsce zamiast na userze
    if (pins.length || this.userLocation()) {
      this.syncPins(map, pins);
    } else {
      this.syncSinglePoint(map);
    }
  }

  private syncSinglePoint(map: L.Map): void {
    // tryb pinów i tryb pojedynczego punktu się wykluczają — gdyby ktoś przełączył
    // komponent między nimi w locie, sprzątamy markery drugiego trybu
    for (const marker of this.pinMarkers.values()) {
      marker.remove();
    }
    this.pinMarkers.clear();
    this.userMarker?.remove();
    this.userMarker = undefined;

    const lat = this.lat();
    const lng = this.lng();
    if (lat === null || lng === null) {
      return;
    }
    const point: L.LatLngTuple = [lat, lng];
    map.setView(point, PIN_ZOOM);
    if (this.marker) {
      this.marker.setLatLng(point);
    } else {
      this.marker = L.marker(point, { icon: PIN_ICON }).addTo(map);
    }
  }

  private syncPins(map: L.Map, pins: MapPin[]): void {
    if (this.marker) {
      this.marker.remove();
      this.marker = undefined;
    }

    const activeId = this.activeId();
    const seen = new Set<string>();

    for (const pin of pins) {
      seen.add(pin.id);
      const icon = pin.id === activeId ? ACTIVE_PIN_ICON : PIN_ICON;
      const existing = this.pinMarkers.get(pin.id);
      if (existing) {
        existing.setLatLng([pin.lat, pin.lng]);
        existing.setIcon(icon);
      } else {
        const marker = L.marker([pin.lat, pin.lng], { icon })
          .addTo(map)
          .on('click', () => this.pinClick.emit(pin.id));
        this.pinMarkers.set(pin.id, marker);
      }
    }

    // usuń markery pinów, których już nie ma na liście (np. po zmianie filtrów/strony)
    for (const [id, marker] of this.pinMarkers) {
      if (!seen.has(id)) {
        marker.remove();
        this.pinMarkers.delete(id);
      }
    }

    const userLocation = this.userLocation();
    if (userLocation) {
      const point: L.LatLngTuple = [userLocation.lat, userLocation.lng];
      if (this.userMarker) {
        this.userMarker.setLatLng(point);
      } else {
        this.userMarker = L.marker(point, { icon: USER_LOCATION_ICON }).addTo(map);
      }
    } else {
      this.userMarker?.remove();
      this.userMarker = undefined;
    }

    const points: L.LatLngTuple[] = pins.map((p): L.LatLngTuple => [p.lat, p.lng]);
    if (userLocation) {
      points.push([userLocation.lat, userLocation.lng]);
    }
    if (points.length) {
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: PIN_ZOOM });
    }
  }

  private updateActiveIcon(activeId: string | null): void {
    for (const [id, marker] of this.pinMarkers) {
      marker.setIcon(id === activeId ? ACTIVE_PIN_ICON : PIN_ICON);
    }
  }
}
