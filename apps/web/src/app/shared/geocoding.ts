import { Service } from '@angular/core';

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
}

// Kształt odpowiedzi Nominatim (tylko potrzebne pola); lat/lon przychodzą jako stringi.
interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/** Geokodowanie adresu przez Nominatim (OpenStreetMap).
 *  Natywny fetch, a nie ApiClient/HttpClient — inaczej authInterceptor dokleiłby
 *  nasz JWT do żądania na obcy host. Brak wyniku/błąd sieci → null (obsługuje wołający. */
@Service()
export class GeocodingService {
  async geocode(query: string): Promise<GeocodeResult | null> {
    const url =
      `${NOMINATIM_URL}?format=json&limit=1&accept-language=pl&q=` +
      encodeURIComponent(query);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return null;
      }
      const hits = (await res.json()) as NominatimHit[];
      const hit = hits[0];
      if (!hit) {
        return null;
      }
      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return null;
      }
      return { lat, lng, label: hit.display_name };
    } catch {
      return null;
    }
  }
}
