/**
 * contextService.ts — Contexto Inteligente em Tempo Real
 *
 * Agrega três fontes de dados reais para alimentar o algoritmo do PRÉCHECA:
 *
 *  1. Clima real (Open-Meteo API, grátis, sem chave)
 *  2. Feriados e eventos (getBrazilianHolidays — lógica interna)
 *  3. POIs próximos (Overpass/OpenStreetMap API, grátis, sem chave)
 *     → Bares, estádios, hospitais, universidades, aeroportos no raio de 800m–3km
 *
 * O resultado alimenta:
 *  • RideContext.weather — clima REAL passado ao algoritmo
 *  • getContextualDemandScore() — demanda real baseada em feriados + contexto
 *  • UI — card "Contexto Agora" no dashboard
 */

import { getRealWeather, WeatherData, weatherIcon } from './weatherService';
import {
  getHolidayContext,
  classifyDayCategory,
  getDemandSignal,
  classifyNeighborhoodType,
  getContextualDemandScore,
  HolidayEntry,
  NeighborhoodType,
} from './cityKnowledge';

// ─── POI Detection via Overpass API ──────────────────────────────────────────

export interface NearbyPOIs {
  bars: number;
  hospitals: number;
  universities: number;
  stadiums: number;
  airports: number;
  shoppings: number;
  /** Best NeighborhoodType based on nearby POIs */
  inferredType: NeighborhoodType | null;
  fetchedAt: number;
}

let _poiCache: NearbyPOIs | null = null;
let _poiLat = 0;
let _poiLng = 0;
const POI_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutos (POIs mudam devagar)

/**
 * Queries OpenStreetMap Overpass API for real nearby points of interest.
 * Helps the algorithm understand the actual environment around the driver.
 */
async function getNearbyPOIs(lat: number, lng: number): Promise<NearbyPOIs> {
  // Check cache (POIs don't change often — 20min TTL)
  const distKm = Math.sqrt(
    Math.pow((lat - _poiLat) * 111, 2) +
    Math.pow((lng - _poiLng) * 85, 2)
  );
  if (_poiCache && distKm < 1 && Date.now() - _poiCache.fetchedAt < POI_CACHE_TTL_MS) {
    return _poiCache;
  }

  const empty: NearbyPOIs = {
    bars: 0, hospitals: 0, universities: 0,
    stadiums: 0, airports: 0, shoppings: 0,
    inferredType: null,
    fetchedAt: Date.now(),
  };

  try {
    // Overpass QL query — counts amenities within different radii
    const query = `
[out:json][timeout:8];
(
  node["amenity"~"^(bar|pub|nightclub|casino|biergarten)$"](around:600,${lat.toFixed(4)},${lng.toFixed(4)});
  way["amenity"~"^(bar|pub|nightclub)$"](around:600,${lat.toFixed(4)},${lng.toFixed(4)});
  node["amenity"~"^(hospital|clinic|doctors|pharmacy)$"](around:800,${lat.toFixed(4)},${lng.toFixed(4)});
  node["amenity"~"^(university|college|school)$"](around:1200,${lat.toFixed(4)},${lng.toFixed(4)});
  way["amenity"~"^(university|college)$"](around:1200,${lat.toFixed(4)},${lng.toFixed(4)});
  node["leisure"~"^(stadium|sports_centre)$"](around:2500,${lat.toFixed(4)},${lng.toFixed(4)});
  way["leisure"~"^(stadium|sports_centre)$"](around:2500,${lat.toFixed(4)},${lng.toFixed(4)});
  node["aeroway"="aerodrome"](around:4000,${lat.toFixed(4)},${lng.toFixed(4)});
  way["aeroway"="aerodrome"](around:4000,${lat.toFixed(4)},${lng.toFixed(4)});
  node["shop"="mall"](around:800,${lat.toFixed(4)},${lng.toFixed(4)});
  way["shop"="mall"](around:800,${lat.toFixed(4)},${lng.toFixed(4)});
  way["building"="retail"](around:800,${lat.toFixed(4)},${lng.toFixed(4)});
);
out tags;
    `.trim();

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      signal: AbortSignal.timeout(9000),
    });

    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);

    const json = await res.json();
    const elements: Array<{ type: string; tags: Record<string, string> }> = json.elements ?? [];

    let bars = 0, hospitals = 0, universities = 0, stadiums = 0, airports = 0, shoppings = 0;

    for (const el of elements) {
      const amenity = el.tags?.amenity ?? '';
      const leisure = el.tags?.leisure ?? '';
      const aeroway = el.tags?.aeroway ?? '';
      const shop    = el.tags?.shop    ?? '';
      const building= el.tags?.building ?? '';

      if (/^(bar|pub|nightclub|casino|biergarten)$/.test(amenity)) bars++;
      else if (/^(hospital|clinic|doctors)$/.test(amenity)) hospitals++;
      else if (/^(university|college)$/.test(amenity)) universities++;
      else if (/^(stadium|sports_centre)$/.test(leisure)) stadiums++;
      else if (aeroway === 'aerodrome') airports++;
      else if (shop === 'mall' || building === 'retail') shoppings++;
    }

    // Infer neighborhood type from dominant POI
    let inferredType: NeighborhoodType | null = null;
    if (airports > 0) inferredType = 'aeroporto_rodoviaria';
    else if (stadiums > 0) inferredType = 'lazer_noturno';       // stadia → noturno/events
    else if (universities >= 2) inferredType = 'universitario';
    else if (hospitals >= 2) inferredType = 'hospitalar';
    else if (shoppings >= 1) inferredType = 'shopping';
    else if (bars >= 5) inferredType = 'lazer_noturno';
    else if (bars >= 2) inferredType = 'comercial_secundario';

    const result: NearbyPOIs = {
      bars, hospitals, universities, stadiums, airports, shoppings,
      inferredType,
      fetchedAt: Date.now(),
    };

    _poiCache = result;
    _poiLat = lat;
    _poiLng = lng;

    console.log(`[POIs] bars:${bars} hospitals:${hospitals} unis:${universities} stadiums:${stadiums} airports:${airports} → ${inferredType ?? 'mixed'}`);
    return result;

  } catch (err) {
    console.warn('[POIs] Overpass query failed, no POI data:', err);
    return empty;
  }
}

// ─── Live Context ─────────────────────────────────────────────────────────────

export interface LiveContext {
  // Weather
  weatherData: WeatherData;
  weatherEmoji: string;

  // Calendar
  holidayName: string | null;
  isHoliday: boolean;
  isEve: boolean;
  dayCategory: string;

  // Demand
  demandMultiplier: number;
  demandLevel: 'muito_alta' | 'alta' | 'normal' | 'baixa';
  demandLabel: string;
  contextInsights: string[];

  // POIs
  pois: NearbyPOIs;
  inferredNeighborhoodType: NeighborhoodType | null;

  // Meta
  refreshedAt: Date;
}

/** Caches the last LiveContext so quick re-reads don't retrigger APIs */
let _liveContextCache: LiveContext | null = null;
let _liveContextLat = 0;
let _liveContextLng = 0;
const LIVE_CTX_TTL_MS = 8 * 60 * 1000; // 8 minutos

/**
 * Builds a complete real-time context for the driver's current location.
 * Aggregates weather, calendar, and nearby POIs into one object that feeds
 * both the algorithm and the UI.
 *
 * @param lat               Current GPS latitude
 * @param lng               Current GPS longitude
 * @param neighborhoodName  Name from reverse geocoding (for name-based classification)
 */
export async function buildLiveContext(
  lat: number,
  lng: number,
  neighborhoodName: string
): Promise<LiveContext> {
  const now = new Date();

  // Return cache if fresh and close
  const distKm = Math.sqrt(
    Math.pow((lat - _liveContextLat) * 111, 2) +
    Math.pow((lng - _liveContextLng) * 85, 2)
  );
  if (
    _liveContextCache &&
    distKm < 3 &&
    Date.now() - _liveContextCache.refreshedAt.getTime() < LIVE_CTX_TTL_MS
  ) {
    return _liveContextCache;
  }

  // Fetch all real data sources in parallel
  const [weatherData, pois] = await Promise.all([
    getRealWeather(lat, lng),
    getNearbyPOIs(lat, lng),
  ]);

  // Calendar context (pure computation, no API)
  const holidayCtx = getHolidayContext(now);
  const dayCategory = classifyDayCategory(now);

  // Neighborhood type: prefer POI inference, fall back to name-based
  const nameBasedType   = classifyNeighborhoodType(neighborhoodName);
  const effectiveNbType = pois.inferredType ?? nameBasedType;

  // Demand signal using real weather + real holiday context
  const demandSignal = getDemandSignal(
    effectiveNbType,
    now.getHours(),
    dayCategory,
    weatherData.weather
  );

  // Collect insights
  const contextInsights: string[] = [];

  // Weather insight
  if (weatherData.weather === 'Chovendo') {
    contextInsights.push(
      `🌧️ ${weatherData.description} — demanda sobe ~45%. Priorize corridas curtas e bem pagas.`
    );
  } else if (weatherData.weather === 'Nublado') {
    contextInsights.push(`☁️ ${weatherData.description} — leve aumento de demanda.`);
  } else {
    contextInsights.push(`☀️ ${weatherData.description} — ${weatherData.tempC}°C.`);
  }

  // Holiday insight
  if (holidayCtx) {
    const label = holidayCtx.isEve ? `Véspera de ${holidayCtx.name}` : holidayCtx.name;
    contextInsights.push(`📅 ${label}: ${holidayCtx.notes}`);
  }

  // POI insights
  if (pois.airports > 0) {
    contextInsights.push(`✈️ Aeroporto próximo — corridas de partida/chegada de alta valor.`);
  }
  if (pois.stadiums > 0) {
    const hour = now.getHours();
    if (hour >= 16 && hour <= 23) {
      contextInsights.push(`🏟️ Estádio/arena próximos — possível evento hoje à noite. Alta demanda pós-evento.`);
    } else {
      contextInsights.push(`🏟️ Estádio próximo — verifique agenda de eventos locais.`);
    }
  }
  if (pois.universities >= 2) {
    contextInsights.push(`🎓 ${pois.universities} faculdades próximas — bom fluxo nas aulas e baladas da área.`);
  }
  if (pois.hospitals >= 2) {
    contextInsights.push(`🏥 ${pois.hospitals} hospitais próximos — demanda estável 24h.`);
  }
  if (pois.bars >= 5) {
    const hour = now.getHours();
    if (hour >= 20 || hour <= 4) {
      contextInsights.push(`🍺 ${pois.bars} bares próximos — ótimo para corridas noturnas agora.`);
    } else {
      contextInsights.push(`🍺 ${pois.bars} bares na área — movimento noturno esperado.`);
    }
  }

  // Demand level classification
  const m = demandSignal.multiplier;
  const demandLevel: LiveContext['demandLevel'] =
    m >= 2.0 ? 'muito_alta' :
    m >= 1.3 ? 'alta' :
    m >= 0.85 ? 'normal' : 'baixa';

  const demandLabel =
    demandLevel === 'muito_alta' ? '🔥 Demanda muito alta' :
    demandLevel === 'alta'       ? '📈 Demanda acima do normal' :
    demandLevel === 'normal'     ? '📊 Demanda normal' :
                                   '📉 Demanda baixa';

  const ctx: LiveContext = {
    weatherData,
    weatherEmoji: weatherIcon(weatherData.weather, weatherData.wmoCode),
    holidayName:  holidayCtx?.name ?? null,
    isHoliday:    !!holidayCtx && !holidayCtx.isEve,
    isEve:        !!holidayCtx?.isEve,
    dayCategory:  dayCategory as string,
    demandMultiplier: demandSignal.multiplier,
    demandLevel,
    demandLabel,
    contextInsights,
    pois,
    inferredNeighborhoodType: effectiveNbType,
    refreshedAt: now,
  };

  _liveContextCache = ctx;
  _liveContextLat = lat;
  _liveContextLng = lng;

  return ctx;
}

/**
 * Clears the context cache — useful after GPS jumps significantly.
 */
export function invalidateContextCache() {
  _liveContextCache = null;
}
