/**
 * weatherService.ts — Clima real via Open-Meteo API
 *
 * Open-Meteo é completamente GRATUITO e não requer chave de API.
 * Documentação: https://open-meteo.com/en/docs
 *
 * WMO Weather Codes:
 *   0        = Céu limpo
 *   1–3      = Parcialmente/totalmente nublado
 *   45, 48   = Nevoeiro
 *   51–67    = Garoa/chuva leve
 *   71–77    = Neve
 *   80–82    = Pancadas de chuva
 *   95–99    = Tempestade
 */

export type AppWeather = 'Limpo' | 'Chovendo' | 'Nublado';

export interface WeatherData {
  weather: AppWeather;
  tempC: number;
  feelsLikeC: number;
  description: string;
  precipitation: number;   // mm na última hora
  humidity: number;        // %
  windKmh: number;
  wmoCode: number;
  fetchedAt: number;       // timestamp ms
}

// ─── WMO Code Helpers ─────────────────────────────────────────────────────────

function wmoToAppWeather(code: number): AppWeather {
  if (code === 0) return 'Limpo';
  if (code <= 3)  return 'Nublado';
  if (code <= 12) return 'Nublado';    // névoa seca
  if (code <= 19) return 'Chovendo';   // precipitação leve
  if (code <= 29) return 'Nublado';    // fenômenos sem precipitação
  if (code <= 39) return 'Chovendo';   // tempestade de poeira / squall
  if (code <= 49) return 'Nublado';    // neblina / nevoeiro
  if (code <= 59) return 'Chovendo';   // garoa
  if (code <= 69) return 'Chovendo';   // chuva
  if (code <= 79) return 'Chovendo';   // neve / granizo
  if (code <= 82) return 'Chovendo';   // pancadas
  if (code <= 99) return 'Chovendo';   // trovoada
  return 'Nublado';
}

function wmoToDescription(code: number): string {
  if (code === 0)  return 'Céu limpo';
  if (code === 1)  return 'Predominantemente limpo';
  if (code === 2)  return 'Parcialmente nublado';
  if (code === 3)  return 'Nublado';
  if (code <= 9)   return 'Tempo variável';
  if (code <= 12)  return 'Névoa seca';
  if (code <= 19)  return 'Precipitação fraca';
  if (code <= 29)  return 'Fenômenos de tempestade';
  if (code <= 39)  return 'Vento forte';
  if (code <= 49)  return 'Nevoeiro';
  if (code <= 55)  return 'Garoa';
  if (code <= 59)  return 'Garoa forte';
  if (code <= 61)  return 'Chuva fraca';
  if (code <= 63)  return 'Chuva moderada';
  if (code <= 65)  return 'Chuva forte';
  if (code <= 67)  return 'Chuva com granizo';
  if (code <= 71)  return 'Neve fraca';
  if (code <= 77)  return 'Neve/granizo';
  if (code <= 82)  return 'Pancadas de chuva';
  if (code <= 84)  return 'Pancadas com granizo';
  if (code <= 94)  return 'Neve com trovoada';
  if (code <= 99)  return 'Trovoada';
  return 'Tempo variável';
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
let _cache: WeatherData | null = null;
let _cachedLat = 0;
let _cachedLng = 0;

/** True if we have a valid cached result for approximately this location */
function isCacheValid(lat: number, lng: number): boolean {
  if (!_cache) return false;
  if (Date.now() - _cache.fetchedAt > CACHE_TTL_MS) return false;
  // Distância aprox em km (graus → km rough estimate)
  const distKm = Math.sqrt(
    Math.pow((lat - _cachedLat) * 111, 2) +
    Math.pow((lng - _cachedLng) * 85, 2)  // 85 ≈ km/° longitude na latitude média do Brasil
  );
  return distKm < 5;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetches real current weather for a GPS coordinate using the Open-Meteo API.
 * Caches results for 10 minutes per location (prevents unnecessary API calls).
 * Falls back gracefully if offline.
 */
export async function getRealWeather(lat: number, lng: number): Promise<WeatherData> {
  if (isCacheValid(lat, lng)) return _cache!;

  const fallback: WeatherData = {
    weather: 'Limpo',
    tempC: 25,
    feelsLikeC: 25,
    description: 'Sem dados de clima',
    precipitation: 0,
    humidity: 60,
    windKmh: 10,
    wmoCode: 0,
    fetchedAt: Date.now(),
  };

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=weathercode,temperature_2m,apparent_temperature,precipitation,` +
      `relative_humidity_2m,windspeed_10m` +
      `&timezone=auto`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const c = json.current ?? {};

    const wmoCode     = c.weathercode     ?? 0;
    const tempC       = c.temperature_2m  ?? 25;
    const feelsLikeC  = c.apparent_temperature ?? tempC;
    const precipitation = c.precipitation ?? 0;
    const humidity    = c.relative_humidity_2m ?? 60;
    const windKmh     = c.windspeed_10m   ?? 0;

    const result: WeatherData = {
      weather:     wmoToAppWeather(wmoCode),
      tempC:       Math.round(tempC * 10) / 10,
      feelsLikeC:  Math.round(feelsLikeC * 10) / 10,
      description: wmoToDescription(wmoCode),
      precipitation,
      humidity,
      windKmh:     Math.round(windKmh),
      wmoCode,
      fetchedAt:   Date.now(),
    };

    _cache = result;
    _cachedLat = lat;
    _cachedLng = lng;

    console.log(`[Weather] ${result.description} ${result.tempC}°C (WMO ${wmoCode})`);
    return result;

  } catch (err) {
    console.warn('[Weather] Failed to fetch real weather, using fallback:', err);
    return fallback;
  }
}

/** Emoji icon for weather state */
export function weatherIcon(weather: AppWeather, wmoCode = 0): string {
  if (weather === 'Chovendo') {
    if (wmoCode >= 95) return '⛈️';
    if (wmoCode >= 80) return '🌧️';
    return '🌦️';
  }
  if (weather === 'Nublado') return '☁️';
  return '☀️';
}
