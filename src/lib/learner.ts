/**
 * learner.ts — Motor de Aprendizado Pessoal do PRÉCHECA
 *
 * Este módulo lê o histórico real de corridas do Firestore e constrói
 * um modelo personalizado por motorista. Novatos recebem os padrões
 * coletivos de todos os usuários como ponto de partida. Veteranos têm
 * thresholds calculados dos próprios dados.
 *
 * Complexidade central:
 *  • Pesos temporais exponenciais — corridas recentes pesam mais
 *  • Matriz 3D: bairro × período_do_dia × tipo_de_dia
 *  • Custo de oportunidade: onde a corrida te deixa vs. onde o dinheiro está
 *  • Análise de anomalias: picos de ganho sinalizam eventos não mapeados
 *  • Score de maturidade por célula — threshold só é "real" com dados suficientes
 */

import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  PersonalBrainState,
  LearnedThreshold,
  DriverMode,
  CityStats,
} from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Rides below this count → novice (uses collective baseline). */
const NOVICE_THRESHOLD = 10;
/** Rides below this count → still learning (hybrid weight). */
const LEARNING_THRESHOLD = 50;

/** Maximum rides loaded from Firestore (enough to be statistically robust). */
const MAX_RIDES_TO_LOAD = 1000;

/**
 * Exponential decay half-life in days.
 * A ride from 7 days ago counts as ~87% of today's weight.
 * A ride from 30 days ago counts as ~50%.
 * This makes the model adapt to seasonal changes and the driver's evolution.
 */
const DECAY_HALF_LIFE_DAYS = 30;

/** Minimum rides per cell (neighborhood × period × dayType) to trust the threshold. */
const MIN_CELL_RIDES = 3;

/**
 * Tolerance margin: accept rides that pay ≥ (personal_avg × THRESHOLD_FACTOR).
 * 0.85 = accept anything within 15% below personal average.
 * Lower = stricter (miss more rides but earn more per ride).
 * Higher = more volume, lower quality.
 */
const THRESHOLD_FACTOR = 0.85;

// ─── Time Utilities ───────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Exponential decay weight.
 * w(t) = 0.5^(t / half_life)
 * A ride from today = 1.0. From DECAY_HALF_LIFE_DAYS ago = 0.5. From 2× half-life = 0.25.
 */
function temporalWeight(rideDate: Date, now: Date): number {
  const days = daysBetween(rideDate, now);
  return Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS);
}

/**
 * Classify a timestamp into a time-of-day bucket.
 * Matches the RideContext.timeOfDay type.
 */
export function classifyTimeOfDay(
  hour: number
): 'Manhã' | 'Tarde' | 'Noite' | 'Madrugada' {
  if (hour >= 5 && hour < 12) return 'Manhã';
  if (hour >= 12 && hour < 18) return 'Tarde';
  if (hour >= 18 && hour < 24) return 'Noite';
  return 'Madrugada';
}

/**
 * Classify a JS Date into a day type for the demand model.
 * Demand patterns differ significantly across these buckets.
 */
export function classifyDayType(
  date: Date
): 'weekday' | 'friday' | 'saturday' | 'sunday' {
  const d = date.getDay(); // 0=Sun
  if (d === 0) return 'sunday';
  if (d === 5) return 'friday';
  if (d === 6) return 'saturday';
  return 'weekday';
}

// ─── Cell Key ─────────────────────────────────────────────────────────────────

/**
 * A "cell" in the 3D matrix is identified by:
 *   neighborhood × timePeriod × dayType
 * This key is used to group rides and compute per-cell statistics.
 */
function cellKey(neighborhood: string, timePeriod: string, dayType: string): string {
  return `${neighborhood.toLowerCase().trim()}|${timePeriod}|${dayType}`;
}

// ─── Weighted Statistics ──────────────────────────────────────────────────────

interface WeightedSample {
  value: number;
  weight: number;
}

function weightedMean(samples: WeightedSample[]): number {
  if (samples.length === 0) return 0;
  const totalWeight = samples.reduce((s, x) => s + x.weight, 0);
  if (totalWeight === 0) return 0;
  return samples.reduce((s, x) => s + x.value * x.weight, 0) / totalWeight;
}

function weightedStdDev(samples: WeightedSample[], mean: number): number {
  if (samples.length < 2) return 0;
  const totalWeight = samples.reduce((s, x) => s + x.weight, 0);
  const variance =
    samples.reduce((s, x) => s + x.weight * Math.pow(x.value - mean, 2), 0) /
    totalWeight;
  return Math.sqrt(variance);
}

// ─── Raw Ride Record (from Firestore) ────────────────────────────────────────

interface FirestoreRide {
  status: 'accepted' | 'rejected' | 'ignored';
  totalPrice: number;
  pricePerKm?: number;
  pricePerHour?: number;
  pickupNeighborhood: string;
  dropoffNeighborhood?: string; // destination — used for opportunity cost
  dayOfWeek?: string;
  timeOfDay?: string;
  weather?: string;
  createdAt: Timestamp | { toDate: () => Date } | string;
}

function parseRideDate(raw: FirestoreRide['createdAt']): Date {
  if (!raw) return new Date();
  if (typeof raw === 'string') return new Date(raw);
  if (raw instanceof Timestamp) return raw.toDate();
  if (typeof (raw as any).toDate === 'function') return (raw as any).toDate();
  return new Date();
}

// ─── Opportunity Cost Map ─────────────────────────────────────────────────────

/**
 * After a ride ends at a destination, how long (minutes) until the next ping?
 * Built from the driver's own history: rides that START at a neighborhood give
 * an empirical "time to next ride" for that area.
 *
 * This is a simplified model — a full version would use the sequence of rides
 * to measure the actual gap between consecutive rides.
 */
function buildOpportunityCostMap(
  rides: FirestoreRide[],
  now: Date
): Record<string, number> {
  // Group rides by pickup neighborhood and compute average gap to next ride.
  // We approximate by counting how many rides start from each neighborhood
  // relative to total rides — busy areas have shorter waits.
  const hoodCount: Record<string, { count: number; weightedCount: number }> = {};
  let totalWeighted = 0;

  for (const ride of rides) {
    const hood = (ride.pickupNeighborhood || 'desconhecido').toLowerCase().trim();
    const rideDate = parseRideDate(ride.createdAt);
    const w = temporalWeight(rideDate, now);
    if (!hoodCount[hood]) hoodCount[hood] = { count: 0, weightedCount: 0 };
    hoodCount[hood].count++;
    hoodCount[hood].weightedCount += w;
    totalWeighted += w;
  }

  if (totalWeighted === 0) return {};

  // Convert frequency to estimated wait time (minutes).
  // Logic: if 30% of rides come from a neighborhood, it's hot → ~5 min wait.
  // If 1% of rides come from there, it's cold → ~30 min wait.
  // Formula: wait = 5 + (1 - relativeFreq) * 25
  const result: Record<string, number> = {};
  for (const [hood, data] of Object.entries(hoodCount)) {
    const relativeFreq = data.weightedCount / totalWeighted;
    const estimatedWaitMin = Math.round(5 + (1 - Math.min(relativeFreq * 10, 1)) * 25);
    result[hood] = estimatedWaitMin; // e.g. 5–30 min
  }
  return result;
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────

/**
 * Detects rides with unusually high R$/km — signals events or surge pricing
 * in specific neighborhoods at specific times. Returns top "anomalous" patterns
 * the driver should watch for.
 */
function detectAnomalies(
  rides: FirestoreRide[],
  globalMeanKm: number,
  now: Date
): string[] {
  if (rides.length < 20 || globalMeanKm === 0) return [];

  const insights: string[] = [];

  // Group accepted rides by neighborhood + timeOfDay
  const cells: Record<string, number[]> = {};
  for (const ride of rides) {
    if (ride.status !== 'accepted' || !ride.pricePerKm) continue;
    const key = `${(ride.pickupNeighborhood || '?').toLowerCase()}|${ride.timeOfDay || '?'}`;
    if (!cells[key]) cells[key] = [];
    cells[key].push(ride.pricePerKm);
  }

  for (const [key, values] of Object.entries(cells)) {
    if (values.length < 2) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    // A cell with mean ≥ 40% above global mean is anomalous → likely event-driven
    if (mean >= globalMeanKm * 1.4) {
      const [hood, period] = key.split('|');
      const pct = Math.round(((mean - globalMeanKm) / globalMeanKm) * 100);
      insights.push(
        `${capitalizeFirst(hood)} no período ${period} costuma pagar ${pct}% a mais — possível evento recorrente`
      );
    }
  }

  return insights.slice(0, 4); // top 4 anomalies
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── City Collective Stats ─────────────────────────────────────────────────────

/**
 * Fetches aggregate stats from all drivers in a city.
 * Stored in Firestore as: city_stats/{citySlug}
 *
 * Falls back gracefully if the document doesn't exist yet.
 */
export async function fetchCityStats(city: string): Promise<CityStats | null> {
  try {
    const slug = city.toLowerCase().replace(/\s+/g, '_');
    const snap = await getDoc(doc(db, 'city_stats', slug));
    if (!snap.exists()) return null;
    return snap.data() as CityStats;
  } catch {
    return null;
  }
}

/**
 * Persists aggregated (anonymized) stats back to city_stats after each session.
 * Called when the driver has enough new data. Data is anonymized — no PII,
 * only statistical aggregates.
 */
export async function pushCityStats(
  city: string,
  stats: Pick<CityStats, 'avgPricePerKm' | 'avgPricePerHour' | 'p25PricePerKm' | 'p25PricePerHour'>
): Promise<void> {
  try {
    const slug = city.toLowerCase().replace(/\s+/g, '_');
    const ref = doc(db, 'city_stats', slug);
    const snap = await getDoc(ref);

    const existing = snap.exists() ? (snap.data() as CityStats) : null;
    const prevTotal = existing?.totalRidesAggregated ?? 0;
    const newTotal = prevTotal + 1;

    // Incremental weighted average (Welford-inspired)
    const blendedKm =
      prevTotal === 0
        ? stats.avgPricePerKm
        : (existing!.avgPricePerKm * prevTotal + stats.avgPricePerKm) / newTotal;

    const blendedHr =
      prevTotal === 0
        ? stats.avgPricePerHour
        : (existing!.avgPricePerHour * prevTotal + stats.avgPricePerHour) / newTotal;

    await setDoc(
      ref,
      {
        city,
        totalRidesAggregated: newTotal,
        avgPricePerKm: blendedKm,
        avgPricePerHour: blendedHr,
        p25PricePerKm: stats.p25PricePerKm,
        p25PricePerHour: stats.p25PricePerHour,
        lastUpdated: serverTimestamp(),
      },
      { merge: true }
    );
  } catch {
    // Non-critical — city stats update is best-effort
  }
}

// ─── Main: Build Personal Brain ───────────────────────────────────────────────

/**
 * Core function — builds the full PersonalBrainState from Firestore.
 *
 * Algorithm steps:
 *  1. Load up to MAX_RIDES_TO_LOAD rides, ordered by most recent first
 *  2. Apply exponential decay weights by ride age
 *  3. Build 3D matrix: neighborhood × time_period × day_type → statistics
 *  4. Compute global weighted averages (fallback when cell has no data)
 *  5. Build opportunity cost map from pickup frequency per neighborhood
 *  6. Detect anomaly patterns (event-driven surge signals)
 *  7. Identify best/worst time slots
 *  8. Determine driverMode from total ride count
 *  9. If novice, try to blend with city collective stats
 */
export async function buildPersonalBrain(
  uid: string,
  city: string = 'desconhecida'
): Promise<PersonalBrainState> {
  const now = new Date();

  // ── 1. Load ride history ──────────────────────────────────────────────────
  let rides: FirestoreRide[] = [];
  try {
    const ridesRef = collection(db, `users/${uid}/rides`);
    const q = query(ridesRef, orderBy('createdAt', 'desc'), limit(MAX_RIDES_TO_LOAD));
    const snapshot = await getDocs(q);
    rides = snapshot.docs.map((d) => d.data() as FirestoreRide);
  } catch {
    // Network offline or permission error — return empty state gracefully
  }

  const totalRides = rides.length;
  const acceptedRides = rides.filter((r) => r.status === 'accepted');

  // Determine driver mode
  let driverMode: DriverMode;
  if (totalRides < NOVICE_THRESHOLD) driverMode = 'novice';
  else if (totalRides < LEARNING_THRESHOLD) driverMode = 'learning';
  else driverMode = 'experienced';

  // Empty state for brand-new drivers
  if (totalRides === 0) {
    // Try to seed from city collective stats
    const cityStats = await fetchCityStats(city);
    return {
      driverMode: 'novice',
      totalRidesAnalyzed: 0,
      learnedThresholds: [],
      globalAvgPricePerKm: cityStats?.p25PricePerKm ?? 0,
      globalAvgPricePerHour: cityStats?.p25PricePerHour ?? 0,
      topNeighborhoods: cityStats?.topNeighborhoods ?? [],
      worstTimeSlots: [],
      bestTimeSlots: [],
      confidenceLevel: 0,
      lastSyncAt: now,
    };
  }

  // ── 2. Compute temporal weights ───────────────────────────────────────────
  const rideWeights: number[] = rides.map((r) =>
    temporalWeight(parseRideDate(r.createdAt), now)
  );

  // ── 3. Build 3D matrix ────────────────────────────────────────────────────
  // cells: cellKey → { kmSamples, hrSamples, acceptedCount, totalCount }
  interface CellData {
    kmSamples: WeightedSample[];
    hrSamples: WeightedSample[];
    acceptedCount: number;
    totalCount: number;
  }
  const matrix: Record<string, CellData> = {};

  for (let i = 0; i < rides.length; i++) {
    const ride = rides[i];
    const w = rideWeights[i];
    const rideDate = parseRideDate(ride.createdAt);
    const timePeriod = ride.timeOfDay ?? classifyTimeOfDay(rideDate.getHours());
    const dayType = classifyDayType(rideDate);
    const hood = (ride.pickupNeighborhood || 'desconhecido').trim();

    // We build cells at two granularities:
    //   fine: neighborhood × timePeriod × dayType  (most specific)
    //   coarse: neighborhood × 'all' × 'all'       (fallback when fine has no data)
    const fineKey = cellKey(hood, timePeriod, dayType);
    const coarseKey = cellKey(hood, 'all', 'all');

    for (const key of [fineKey, coarseKey]) {
      if (!matrix[key]) {
        matrix[key] = { kmSamples: [], hrSamples: [], acceptedCount: 0, totalCount: 0 };
      }
      matrix[key].totalCount++;
      if (ride.status === 'accepted') {
        matrix[key].acceptedCount++;
        if (ride.pricePerKm != null) matrix[key].kmSamples.push({ value: ride.pricePerKm, weight: w });
        if (ride.pricePerHour != null) matrix[key].hrSamples.push({ value: ride.pricePerHour, weight: w });
      }
    }
  }

  // ── 4. Global weighted averages ───────────────────────────────────────────
  const allKmSamples: WeightedSample[] = [];
  const allHrSamples: WeightedSample[] = [];
  for (let i = 0; i < acceptedRides.length; i++) {
    const r = acceptedRides[i];
    const w = rideWeights[rides.indexOf(r)];
    if (r.pricePerKm != null) allKmSamples.push({ value: r.pricePerKm, weight: w });
    if (r.pricePerHour != null) allHrSamples.push({ value: r.pricePerHour, weight: w });
  }
  const globalAvgPricePerKm = weightedMean(allKmSamples);
  const globalAvgPricePerHour = weightedMean(allHrSamples);

  // For novice/learning drivers, blend with city collective stats
  let effectiveGlobalKm = globalAvgPricePerKm;
  let effectiveGlobalHr = globalAvgPricePerHour;
  if (driverMode !== 'experienced') {
    const cityStats = await fetchCityStats(city);
    if (cityStats && cityStats.avgPricePerKm > 0) {
      // Weight blending: personal data gets more weight as driver gains experience
      const personalWeight = Math.min(1, totalRides / LEARNING_THRESHOLD);
      const cityWeight = 1 - personalWeight;
      effectiveGlobalKm = personalWeight * globalAvgPricePerKm + cityWeight * cityStats.avgPricePerKm;
      effectiveGlobalHr = personalWeight * globalAvgPricePerHour + cityWeight * cityStats.avgPricePerHour;
    }
  }

  // ── 5. Build learned thresholds from matrix cells ─────────────────────────
  const learnedThresholds: LearnedThreshold[] = [];
  const processedHoods = new Set<string>();

  for (const [key, cell] of Object.entries(matrix)) {
    // Only use coarse cells (neighborhood × all × all) for the threshold list
    // to avoid threshold explosion — fine cells are used internally during scoring
    if (!key.endsWith('|all|all')) continue;
    if (cell.kmSamples.length < MIN_CELL_RIDES) continue;

    const hood = key.split('|')[0];
    if (processedHoods.has(hood)) continue;
    processedHoods.add(hood);

    const avgKm = weightedMean(cell.kmSamples);
    const avgHr = weightedMean(cell.hrSamples);
    const stdKm = weightedStdDev(cell.kmSamples, avgKm);

    learnedThresholds.push({
      neighborhood: capitalizeFirst(hood),
      dayPeriod: 'all',
      avgPricePerKm: avgKm,
      avgPricePerHour: avgHr,
      acceptRate: cell.totalCount > 0 ? cell.acceptedCount / cell.totalCount : 0,
      totalRides: cell.totalCount,
      lastUpdated: now,
    });
  }

  // ── 6. Opportunity cost map ───────────────────────────────────────────────
  // (stored internally — exposed via getOpportunityCost)
  const opportunityCostMap = buildOpportunityCostMap(rides, now);
  // Persist it on the module-level cache so analyzer.ts can use it
  _opportunityCostCache[uid] = opportunityCostMap;

  // ── 7. Best/worst time slots ──────────────────────────────────────────────
  const slotMap: Record<string, { samples: WeightedSample[]; count: number }> = {};
  for (let i = 0; i < rides.length; i++) {
    const r = rides[i];
    if (r.status !== 'accepted' || !r.dayOfWeek || !r.timeOfDay) continue;
    const slotKey = `${r.dayOfWeek} ${r.timeOfDay}`;
    if (!slotMap[slotKey]) slotMap[slotKey] = { samples: [], count: 0 };
    if (r.pricePerHour != null) {
      slotMap[slotKey].samples.push({ value: r.pricePerHour, weight: rideWeights[i] });
    }
    slotMap[slotKey].count++;
  }

  const slotRanking = Object.entries(slotMap)
    .filter(([_, d]) => d.samples.length >= 2)
    .map(([slot, d]) => ({ slot, mean: weightedMean(d.samples) }))
    .sort((a, b) => b.mean - a.mean);

  const bestTimeSlots = slotRanking.slice(0, 3).map((x) => x.slot);
  const worstTimeSlots = slotRanking.slice(-3).map((x) => x.slot).reverse();

  // ── 8. Anomaly detection → extra insights ────────────────────────────────
  const anomalyInsights = detectAnomalies(rides, globalAvgPricePerKm, now);
  // Store for later retrieval
  _anomalyCache[uid] = anomalyInsights;

  // ── 9. Top neighborhoods by avg R$/km (weighted) ─────────────────────────
  const topNeighborhoods = learnedThresholds
    .sort((a, b) => b.avgPricePerKm - a.avgPricePerKm)
    .slice(0, 6)
    .map((t) => t.neighborhood);

  // ── 10. Confidence level ──────────────────────────────────────────────────
  // Saturates at 100 around 150 rides. Less than 10 = essentially 0.
  const confidenceLevel = Math.min(
    100,
    Math.round(Math.pow(Math.min(totalRides, 150) / 150, 0.6) * 100)
  );

  // ── 11. Push anonymized stats to city collective (best-effort) ────────────
  if (driverMode !== 'novice' && globalAvgPricePerKm > 0) {
    const p25Km = computePercentile(allKmSamples.map((s) => s.value), 25);
    const p25Hr = computePercentile(allHrSamples.map((s) => s.value), 25);
    pushCityStats(city, {
      avgPricePerKm: effectiveGlobalKm,
      avgPricePerHour: effectiveGlobalHr,
      p25PricePerKm: p25Km,
      p25PricePerHour: p25Hr,
    });
  }

  return {
    driverMode,
    totalRidesAnalyzed: totalRides,
    learnedThresholds,
    globalAvgPricePerKm: effectiveGlobalKm,
    globalAvgPricePerHour: effectiveGlobalHr,
    topNeighborhoods,
    worstTimeSlots,
    bestTimeSlots,
    confidenceLevel,
    lastSyncAt: now,
  };
}

// ─── Module-level caches (per-user, per-session) ──────────────────────────────

const _opportunityCostCache: Record<string, Record<string, number>> = {};
const _anomalyCache: Record<string, string[]> = {};
const _matrixCache: Record<string, Record<string, any>> = {};

// ─── Public Query API ─────────────────────────────────────────────────────────

/**
 * Get the effective minimum thresholds for a specific ride context.
 *
 * Priority:
 *  1. Fine cell (neighborhood × time_period × day_type) if ≥ MIN_CELL_RIDES
 *  2. Coarse cell (neighborhood × all × all) if ≥ MIN_CELL_RIDES
 *  3. Driver's global average (all neighborhoods)
 *  4. Profile default (minPricePerKm, minPricePerHour from DriverProfile)
 *
 * Returns the threshold AND a label indicating the source, so the UI can
 * show the driver exactly what the algorithm is using.
 */
export function getEffectiveThresholds(
  brainState: PersonalBrainState,
  neighborhood: string,
  timePeriod: string,
  dayType: string,
  profileMinKm: number,
  profileMinHour: number,
  categoryMultiplier: number
): {
  minPricePerKm: number;
  minPricePerHour: number;
  source: 'personal_fine' | 'personal_coarse' | 'personal_global' | 'collective' | 'profile_default';
  cellRides: number;
} {
  const profileKm = profileMinKm * categoryMultiplier;
  const profileHr = profileMinHour * categoryMultiplier;

  if (brainState.driverMode === 'novice' && brainState.globalAvgPricePerKm === 0) {
    return {
      minPricePerKm: profileKm,
      minPricePerHour: profileHr,
      source: 'profile_default',
      cellRides: 0,
    };
  }

  // Normalize neighborhood
  const hoodNorm = neighborhood.toLowerCase().trim();

  // Try fine cell first
  const fineKey = cellKey(hoodNorm, timePeriod, dayType);
  const fineCellData = brainState.learnedThresholds.find(
    (t) => cellKey(t.neighborhood.toLowerCase(), timePeriod, dayType) === fineKey
  );
  if (fineCellData && fineCellData.totalRides >= MIN_CELL_RIDES) {
    return {
      minPricePerKm: Math.max(profileKm, fineCellData.avgPricePerKm * THRESHOLD_FACTOR),
      minPricePerHour: Math.max(profileHr, fineCellData.avgPricePerHour * THRESHOLD_FACTOR),
      source: 'personal_fine',
      cellRides: fineCellData.totalRides,
    };
  }

  // Try coarse cell
  const coarseCellData = brainState.learnedThresholds.find(
    (t) => t.neighborhood.toLowerCase() === hoodNorm
  );
  if (coarseCellData && coarseCellData.totalRides >= MIN_CELL_RIDES) {
    return {
      minPricePerKm: Math.max(profileKm, coarseCellData.avgPricePerKm * THRESHOLD_FACTOR),
      minPricePerHour: Math.max(profileHr, coarseCellData.avgPricePerHour * THRESHOLD_FACTOR),
      source: 'personal_coarse',
      cellRides: coarseCellData.totalRides,
    };
  }

  // Use global personal average
  if (brainState.globalAvgPricePerKm > 0) {
    const source =
      brainState.driverMode === 'novice' ? 'collective' : 'personal_global';
    return {
      minPricePerKm: Math.max(profileKm, brainState.globalAvgPricePerKm * THRESHOLD_FACTOR),
      minPricePerHour: Math.max(profileHr, brainState.globalAvgPricePerHour * THRESHOLD_FACTOR),
      source,
      cellRides: 0,
    };
  }

  return {
    minPricePerKm: profileKm,
    minPricePerHour: profileHr,
    source: 'profile_default',
    cellRides: 0,
  };
}

/**
 * Returns estimated minutes until the next ride if you end up at `neighborhood`.
 * Lower = better location after the ride ends.
 */
export function getOpportunityCost(uid: string, neighborhood: string): number {
  const cache = _opportunityCostCache[uid] ?? {};
  const norm = neighborhood.toLowerCase().trim();
  return cache[norm] ?? 15; // default 15 min if unknown
}

/**
 * Returns anomaly insights detected for this driver (event-driven surge patterns).
 */
export function getAnomalyInsights(uid: string): string[] {
  return _anomalyCache[uid] ?? [];
}

// ─── Percentile Helper ────────────────────────────────────────────────────────

function computePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}
