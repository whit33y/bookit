import { Service } from '@angular/core';

export type GeolocationResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; reason: 'denied' | 'timeout' | 'unavailable' };

const TIMEOUT_MS = 10_000;

/** Cienki wrapper na natywne navigator.geolocation — Promise zamiast callbacków,
 *  błędy zmapowane na kilka czytelnych przyczyn zamiast surowego GeolocationPositionError. */
@Service()
export class GeolocationService {
  getCurrentPosition(): Promise<GeolocationResult> {
    if (!navigator.geolocation) {
      return Promise.resolve({ ok: false, reason: 'unavailable' });
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            ok: true,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }),
        (err) => resolve({ ok: false, reason: mapErrorReason(err) }),
        { timeout: TIMEOUT_MS },
      );
    });
  }
}

function mapErrorReason(
  err: GeolocationPositionError,
): 'denied' | 'timeout' | 'unavailable' {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'denied';
    case err.TIMEOUT:
      return 'timeout';
    default:
      return 'unavailable';
  }
}
