const EARTH_RADIUS_KM = 6371;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Czysta funkcja odległości Haversine — bez PrismaService, tak jak cancellation-policy.ts
 * obok bookings. SDD §4: "zwykłe kolumny lat/lng + Haversine w SQL" — realne wyszukiwanie
 * (#34) liczy dystans natywnie w Postgresie (businesses.service.ts#searchByDistance) tym
 * samym wzorem; ta wersja istnieje wyłącznie po to, żeby dało się przetestować formułę bez
 * bazy danych (AC #34: "Haversine liczy poprawnie znany dystans").
 */
export const haversineDistanceKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const cosAngle =
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(toRadians(lng2) - toRadians(lng1)) +
    Math.sin(toRadians(lat1)) * Math.sin(toRadians(lat2));
  // clamp — błąd zaokrągleń zmiennoprzecinkowych może dać |cosAngle| nieznacznie > 1,
  // a acos(>1) to NaN (np. dla dwóch identycznych punktów)
  const clamped = Math.min(1, Math.max(-1, cosAngle));
  return EARTH_RADIUS_KM * Math.acos(clamped);
};
