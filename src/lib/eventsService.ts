/**
 * eventsService.ts — Eventos Culturais e Esportivos em Tempo Real
 *
 * Agrega três fontes para detectar eventos perto do motorista:
 *
 *  1. 🎵 Ticketmaster Discovery API (gratuita com chave)
 *     → Shows, festivais, teatro, esportes com venue + horário + capacidade
 *     → Chave: VITE_TICKETMASTER_KEY (developer.ticketmaster.com)
 *
 *  2. ⚽ football-data.org (gratuita com chave, 10 req/min)
 *     → Brasileirão Série A, Copa do Brasil, Libertadores
 *     → Chave: VITE_FOOTBALL_KEY (football-data.org/client)
 *
 *  3. 🔍 Inferência heurística (sem chave, sempre ativa)
 *     → Usa POIs do Overpass + dia/hora para inferir eventos prováveis
 *     → Ex: estádio próximo + sábado à tarde = "possível jogo"
 *
 * Cada fonte retorna EventSignal[], que são consolidados, deduplicados
 * e ranqueados por demandBoost antes de serem adicionados ao LiveContext.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventType =
  | 'concert'       // show / festival de música
  | 'sports'        // jogo, luta, corrida
  | 'theatre'       // teatro, circo, stand-up
  | 'festival'      // evento cultural multi-atração
  | 'inferred_game' // inferido: estádio + dia/hora típico
  | 'inferred_show' // inferido: venue + fim de semana noturno
  | 'other';

export type EventSource = 'ticketmaster' | 'football' | 'heuristic';

export interface EventSignal {
  id: string;
  name: string;
  type: EventType;
  venue: string;
  city: string;
  startsAt: Date;
  endsAt?: Date;
  estimatedAttendance: number;   // pessoas esperadas
  distanceKm: number;            // distância estimada do motorista
  demandBoost: number;           // fator extra de demanda (ex: 1.8 = 80% acima do normal)
  source: EventSource;
  confidencePercent: number;     // 0–100
  url?: string;                  // link para o evento (Ticketmaster)
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: EventSignal[];
  cachedAt: number;
}

const _eventsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos

function cacheKey(lat: number, lng: number): string {
  // Bucket por ~1km de célula
  return `${(lat * 100).toFixed(0)},${(lng * 100).toFixed(0)}`;
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calcula o boost de demanda com base no público esperado e na distância.
 * Pico: 50k pessoas a 1km → +2.4x. Cai linearmente até 15km → 0.
 */
function calcDemandBoost(attendance: number, distanceKm: number): number {
  if (distanceKm > 15) return 0;
  const attendanceFactor = Math.min(attendance / 12000, 2.5);  // 12k pessoas = fator 1.0
  const distanceFactor   = Math.max(0, 1 - distanceKm / 15);
  return parseFloat((attendanceFactor * distanceFactor * 1.2).toFixed(2));
}

function estimateAttendanceByVenue(venueName: string, type: EventType): number {
  const n = venueName.toLowerCase();
  if (n.includes('allianz') || n.includes('neo quimica') || n.includes('morumbi'))  return 48000;
  if (n.includes('arena')   || n.includes('estadio') || n.includes('estádio'))       return 30000;
  if (n.includes('jeunesse') || n.includes('hsbc') || n.includes('citibank'))        return 6000;
  if (n.includes('teatro')  || n.includes('theatro'))                                return 1500;
  if (n.includes('convention') || n.includes('pavilhao') || n.includes('pavilhão'))  return 8000;
  if (type === 'sports')  return 20000;
  if (type === 'concert') return 5000;
  return 1500;
}

// ─── 1. Ticketmaster Discovery API ───────────────────────────────────────────

async function fetchTicketmasterEvents(
  lat: number,
  lng: number,
  apiKey: string,
  radiusKm = 15
): Promise<EventSignal[]> {
  const now    = new Date();
  const end    = new Date(now.getTime() + 10 * 60 * 60 * 1000); // próximas 10 horas
  const toISO  = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const url =
    `https://app.ticketmaster.com/discovery/v2/events.json` +
    `?apikey=${apiKey}` +
    `&latlong=${lat.toFixed(4)},${lng.toFixed(4)}` +
    `&radius=${radiusKm}&unit=km` +
    `&startDateTime=${toISO(now)}` +
    `&endDateTime=${toISO(end)}` +
    `&countryCode=BR` +
    `&size=10&sort=date,asc`;

  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) {
    console.warn(`[Events/TM] HTTP ${res.status}`);
    return [];
  }

  const json = await res.json();
  const events: unknown[] = (json as any)._embedded?.events ?? [];

  return events.map((ev: any): EventSignal => {
    const venue     = ev._embedded?.venues?.[0];
    const venueName = venue?.name ?? 'Local não informado';
    const venueCity = venue?.city?.name ?? '';
    const venueCoords = venue?.location;

    const distanceKm = venueCoords
      ? haversineKm(lat, lng, parseFloat(venueCoords.latitude), parseFloat(venueCoords.longitude))
      : 5; // estimativa se não tiver coord

    const segment = ev.classifications?.[0]?.segment?.name ?? '';
    const type: EventType =
      segment === 'Sports'           ? 'sports'  :
      segment === 'Music'            ? 'concert' :
      segment === 'Arts & Theatre'   ? 'theatre' : 'festival';

    const attendance = estimateAttendanceByVenue(venueName, type);

    const startRaw = ev.dates?.start?.dateTime ?? ev.dates?.start?.localDate;

    return {
      id:                   `tm-${ev.id}`,
      name:                 ev.name,
      type,
      venue:                venueName,
      city:                 venueCity,
      startsAt:             new Date(startRaw),
      estimatedAttendance:  attendance,
      distanceKm,
      demandBoost:          calcDemandBoost(attendance, distanceKm),
      source:               'ticketmaster',
      confidencePercent:    88,
      url:                  ev.url,
    };
  });
}

// ─── 2. football-data.org ─────────────────────────────────────────────────────

// Mapa de cidades dos principais estádios brasileiros (para correlacionar jogo ↔ estádio)
const STADIUM_CITY_MAP: Record<string, string[]> = {
  'São Paulo':      ['palmeiras', 'corinthians', 'são paulo', 'santos', 'flamengo'],
  'Rio de Janeiro': ['flamengo', 'fluminense', 'vasco', 'botafogo'],
  'Belo Horizonte': ['atlético mineiro', 'cruzeiro', 'america mineiro'],
  'Porto Alegre':   ['grêmio', 'internacional'],
  'Curitiba':       ['athletico', 'coritiba'],
  'Fortaleza':      ['fortaleza', 'ceará'],
  'Salvador':       ['bahia', 'vitória'],
  'Recife':         ['sport', 'náutico', 'santa cruz'],
};

async function fetchFootballMatches(
  lat: number,
  lng: number,
  apiKey: string,
  driverCity: string
): Promise<EventSignal[]> {
  const today = new Date().toISOString().slice(0, 10);

  // Busca jogos do Brasileirão Série A e Copa do Brasil no dia de hoje
  const res = await fetch(
    `https://api.football-data.org/v4/matches?dateFrom=${today}&dateTo=${today}` +
    `&competitions=BSA,CBR`,
    {
      headers: { 'X-Auth-Token': apiKey },
      signal: AbortSignal.timeout(6000),
    }
  );

  if (!res.ok) {
    console.warn(`[Events/Football] HTTP ${res.status}`);
    return [];
  }

  const json = await res.json();
  const matches: unknown[] = (json as any).matches ?? [];

  const results: EventSignal[] = [];
  const now = new Date();

  for (const match of matches as any[]) {
    const matchDate = new Date(match.utcDate);
    const hoursUntil = (matchDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Só inclui jogos que ainda vão acontecer (até 8h no futuro) ou em andamento
    if (hoursUntil < -2 || hoursUntil > 8) continue;

    const homeTeam = (match.homeTeam?.shortName ?? match.homeTeam?.name ?? '').toLowerCase();
    const competition = match.competition?.name ?? 'Brasileirão';

    // Verifica se algum time da casa é da cidade do motorista
    const cityTeams = Object.entries(STADIUM_CITY_MAP).find(([city]) =>
      driverCity.toLowerCase().includes(city.toLowerCase()) ||
      city.toLowerCase().includes(driverCity.toLowerCase())
    );
    const isLocalGame = cityTeams
      ? cityTeams[1].some(t => homeTeam.includes(t))
      : false;

    // Inclui o jogo se for local (confiança alta) ou genérico (confiança média)
    const attendance = isLocalGame ? 28000 : 15000;
    const distanceKm = isLocalGame ? 3 : 10;
    const confidence = isLocalGame ? 82 : 55;

    results.push({
      id:                   `fb-${match.id}`,
      name:                 `${match.homeTeam?.shortName ?? '?'} × ${match.awayTeam?.shortName ?? '?'}`,
      type:                 'sports',
      venue:                match.venue ?? 'Estádio',
      city:                 driverCity,
      startsAt:             matchDate,
      estimatedAttendance:  attendance,
      distanceKm,
      demandBoost:          calcDemandBoost(attendance, distanceKm),
      source:               'football',
      confidencePercent:    confidence,
    });
  }

  return results;
}

// ─── 3. Heurística (sem chave) ────────────────────────────────────────────────

export interface HeuristicPOIs {
  stadiums: number;
  bars: number;
  airports: number;
}

function inferEventsFromPOIs(
  pois: HeuristicPOIs,
  now: Date
): EventSignal[] {
  const results: EventSignal[] = [];
  const hour = now.getHours();
  const dow  = now.getDay(); // 0=Dom, 3=Qua, 5=Sex, 6=Sáb

  // ── Inferência: jogo de futebol ──────────────────────────────────────────
  // Partidas típicas: Dom, Qua, Sáb — entre 15h e 22h
  if (pois.stadiums > 0) {
    const isGameDay  = dow === 0 || dow === 3 || dow === 6;
    const isGameTime = hour >= 15 && hour <= 22;

    if (isGameDay && isGameTime) {
      results.push({
        id:                   'heuristic-game',
        name:                 'Possível jogo de futebol',
        type:                 'inferred_game',
        venue:                'Estádio/arena próximos',
        city:                 '',
        startsAt:             now,
        estimatedAttendance:  18000,
        distanceKm:           2,
        demandBoost:          calcDemandBoost(18000, 2),
        source:               'heuristic',
        confidencePercent:    62,
      });
    }
  }

  // ── Inferência: show noturno ──────────────────────────────────────────────
  // Fim de semana (Sex, Sáb, Dom) após 20h com bares próximos
  if (pois.bars >= 4) {
    const isWeekend = dow === 5 || dow === 6 || dow === 0;
    const isNight   = hour >= 20 || hour <= 3;

    if (isWeekend && isNight) {
      results.push({
        id:                   'heuristic-show',
        name:                 'Balada/show noturno provável',
        type:                 'inferred_show',
        venue:                `${pois.bars} bares/venues na área`,
        city:                 '',
        startsAt:             now,
        estimatedAttendance:  2000,
        distanceKm:           1,
        demandBoost:          calcDemandBoost(2000, 1),
        source:               'heuristic',
        confidencePercent:    48,
      });
    }
  }

  return results;
}

// ─── Deduplicação ─────────────────────────────────────────────────────────────

function deduplicateEvents(events: EventSignal[]): EventSignal[] {
  // Remove heurísticas se temos dado real do mesmo tipo
  const hasRealGame  = events.some(e => e.source !== 'heuristic' && e.type === 'sports');
  const hasRealShow  = events.some(e => e.source !== 'heuristic' && (e.type === 'concert' || e.type === 'festival'));

  const seen = new Set<string>();
  return events.filter(ev => {
    if (ev.id === 'heuristic-game' && hasRealGame) return false;
    if (ev.id === 'heuristic-show' && hasRealShow) return false;
    if (seen.has(ev.id)) return false;
    seen.add(ev.id);
    return true;
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface EventsOptions {
  ticketmasterKey?: string;
  footballKey?: string;
  driverCity?: string;
  radiusKm?: number;
  pois?: HeuristicPOIs;
}

/**
 * Retorna todos os eventos relevantes perto do motorista,
 * combinando Ticketmaster, football-data.org e heurística.
 * Resultado cacheado por 15 minutos por célula de ~1km.
 */
export async function getNearbyEvents(
  lat: number,
  lng: number,
  options: EventsOptions = {}
): Promise<EventSignal[]> {
  const key    = cacheKey(lat, lng);
  const cached = _eventsCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const now    = new Date();
  const radius = options.radiusKm ?? 15;
  const city   = options.driverCity ?? '';
  const pois   = options.pois ?? { stadiums: 0, bars: 0, airports: 0 };

  const allResults: EventSignal[] = [];

  // Heurística: sempre roda (zero dependências externas)
  allResults.push(...inferEventsFromPOIs(pois, now));

  // APIs externas em paralelo — silenciosas se a chave não existir
  const apiCalls: Promise<EventSignal[]>[] = [];

  if (options.ticketmasterKey) {
    apiCalls.push(
      fetchTicketmasterEvents(lat, lng, options.ticketmasterKey, radius).catch(e => {
        console.warn('[Events/TM] Failed:', e);
        return [];
      })
    );
  }

  if (options.footballKey) {
    apiCalls.push(
      fetchFootballMatches(lat, lng, options.footballKey, city).catch(e => {
        console.warn('[Events/Football] Failed:', e);
        return [];
      })
    );
  }

  if (apiCalls.length > 0) {
    const apiResults = await Promise.all(apiCalls);
    allResults.push(...apiResults.flat());
  }

  // Consolida, deduplica e ordena por demanda
  const final = deduplicateEvents(allResults).sort(
    (a, b) => b.demandBoost - a.demandBoost
  );

  _eventsCache.set(key, { data: final, cachedAt: Date.now() });
  console.log(`[Events] ${final.length} eventos encontrados perto de (${lat.toFixed(3)},${lng.toFixed(3)})`);
  return final;
}

/**
 * Soma o boost do evento mais relevante (top-1) para alimentar o demandMultiplier.
 * Retorna 0 se não houver eventos.
 */
export function getTopEventBoost(events: EventSignal[]): number {
  if (!events.length) return 0;
  return Math.max(...events.map(e => e.demandBoost));
}

/**
 * Emoji representativo para o tipo de evento.
 */
export function eventEmoji(type: EventType): string {
  switch (type) {
    case 'concert':       return '🎵';
    case 'sports':        return '🏟️';
    case 'theatre':       return '🎭';
    case 'festival':      return '🎪';
    case 'inferred_game': return '⚽';
    case 'inferred_show': return '🎉';
    default:              return '📅';
  }
}

/**
 * Limpa o cache de eventos — útil após mudança grande de GPS.
 */
export function invalidateEventsCache(): void {
  _eventsCache.clear();
}
