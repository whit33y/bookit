import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';

// Widok domyślny, dopóki nie ma współrzędnych — środek Polski.
const POLAND_CENTER: L.LatLngTuple = [52.0, 19.0];
const POLAND_ZOOM = 6;
const PIN_ZOOM = 15;

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

/** Mapa Leaflet ze wskazaniem jednego punktu. Reużywalny komponent (shared/) —
 *  #35/#37 rozszerzą o wiele pinów, gdy będzie potrzeba. */
@Component({
  selector: 'app-map',
  host: { class: 'block' },
  template: `<div
    #mapEl
    class="h-64 w-full rounded-lg"
    role="region"
    aria-label="Lokalizacja firmy na mapie"
  ></div>`,
})
export default class AppMap {
  readonly lat = input<number | null>(null);
  readonly lng = input<number | null>(null);

  private readonly mapEl =
    viewChild.required<ElementRef<HTMLElement>>('mapEl');
  private map?: L.Map;
  private marker?: L.Marker;

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
    // effect może odpalić przed pierwszym renderem — sync() sam pilnuje, że mapa istnieje
    effect(() => {
      this.lat();
      this.lng();
      this.sync();
    });
    // bez remove() instancja mapy, panele DOM i listenery zostają po zniszczeniu komponentu
    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  private sync(): void {
    if (!this.map) {
      return;
    }
    const lat = this.lat();
    const lng = this.lng();
    if (lat === null || lng === null) {
      return;
    }
    const point: L.LatLngTuple = [lat, lng];
    this.map.setView(point, PIN_ZOOM);
    if (this.marker) {
      this.marker.setLatLng(point);
    } else {
      this.marker = L.marker(point, { icon: PIN_ICON }).addTo(this.map);
    }
  }
}
