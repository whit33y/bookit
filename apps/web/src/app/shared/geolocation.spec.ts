import { GeolocationService } from './geolocation';

describe('GeolocationService', () => {
  const originalGeolocation = navigator.geolocation;

  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: originalGeolocation,
      configurable: true,
    });
  });

  function stubGeolocation(
    impl: (
      success: PositionCallback,
      error?: PositionErrorCallback,
    ) => void,
  ) {
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: impl },
      configurable: true,
    });
  }

  it('sukces → zwraca lat/lng', async () => {
    stubGeolocation((success) => {
      success({
        coords: { latitude: 52.23, longitude: 21.01 },
      } as GeolocationPosition);
    });

    const result = await new GeolocationService().getCurrentPosition();

    expect(result).toEqual({ ok: true, lat: 52.23, lng: 21.01 });
  });

  it('odmowa dostępu → reason "denied"', async () => {
    stubGeolocation((_success, error) => {
      error?.({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 } as GeolocationPositionError);
    });

    const result = await new GeolocationService().getCurrentPosition();

    expect(result).toEqual({ ok: false, reason: 'denied' });
  });

  it('przekroczony czas → reason "timeout"', async () => {
    stubGeolocation((_success, error) => {
      error?.({ code: 3, PERMISSION_DENIED: 1, TIMEOUT: 3 } as GeolocationPositionError);
    });

    const result = await new GeolocationService().getCurrentPosition();

    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('inny błąd → reason "unavailable"', async () => {
    stubGeolocation((_success, error) => {
      error?.({ code: 2, PERMISSION_DENIED: 1, TIMEOUT: 3 } as GeolocationPositionError);
    });

    const result = await new GeolocationService().getCurrentPosition();

    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('brak API geolokalizacji w przeglądarce → reason "unavailable"', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      value: undefined,
      configurable: true,
    });

    const result = await new GeolocationService().getCurrentPosition();

    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });
});
