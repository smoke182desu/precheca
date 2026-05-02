// ─── Vehicle & Driver Profiles ────────────────────────────────────────────────

export type VehicleCategory = {
  id: 'X' | 'Comfort' | 'Black';
  name: string;
  multiplier: number;
  isPremium?: boolean;
};

export type DriverProfile = {
  id: string;
  name: string;
  description: string;
  minPricePerKm: number;
  minPricePerHour: number;
  maxDistanceToPassenger: number; // km
  avoidRiskAreas: boolean;
  color: string;
};

// ─── Ride Request & Context ───────────────────────────────────────────────────

export type RideContext = {
  dayOfWeek: string;
  timeOfDay: 'Manhã' | 'Tarde' | 'Noite' | 'Madrugada';
  exactTime: string;
  weather: 'Limpo' | 'Chovendo' | 'Nublado';
  pickupNeighborhood: string;
};

export type RideRequest = {
  id: string;
  platform: 'Uber' | '99';
  passengerRating: number;
  passengerName: string;
  pickupDistance: number;   // km
  pickupTimeMin: number;    // minutes
  rideDistance: number;     // km
  rideTimeMin: number;      // minutes
  totalPrice: number;       // R$
  pickupLocation: string;
  dropoffLocation: string;
  isRiskArea: boolean;
  hasStops: boolean;
  isDirtRoad: boolean;
  hasTolls: boolean;
  context: RideContext;
};

// ─── Learning System ──────────────────────────────────────────────────────────

/**
 * driverMode is determined by total rides analyzed:
 *   novice     → < 10 rides  (uses collective/profile defaults, gets educational messages)
 *   learning   → 10–49 rides (hybrid: personal data gaining weight)
 *   experienced → 50+ rides  (personal thresholds dominate, short messages)
 */
export type DriverMode = 'novice' | 'learning' | 'experienced';

/**
 * A learned threshold for a specific neighborhood (and optionally time period).
 * Built from the driver's own accepted-ride history in Firestore.
 */
export type LearnedThreshold = {
  neighborhood: string;
  dayPeriod: 'Manhã' | 'Tarde' | 'Noite' | 'Madrugada' | 'all';
  avgPricePerKm: number;
  avgPricePerHour: number;
  acceptRate: number;         // 0–1: fraction of rides accepted here
  totalRides: number;
  lastUpdated: Date;
};

/**
 * Full state of the personal learning engine.
 * Built by learner.ts from Firestore ride history, cached in memory during a session.
 */
export type PersonalBrainState = {
  driverMode: DriverMode;
  totalRidesAnalyzed: number;
  learnedThresholds: LearnedThreshold[];     // per-neighborhood patterns
  globalAvgPricePerKm: number;               // across all accepted rides
  globalAvgPricePerHour: number;
  topNeighborhoods: string[];                // best R$/km neighborhoods
  worstTimeSlots: string[];                  // e.g. "Segunda-feira Manhã"
  bestTimeSlots: string[];                   // e.g. "Sexta-feira Noite"
  confidenceLevel: number;                   // 0–100, rises with ride count
  lastSyncAt?: Date;
};

/**
 * Aggregate stats contributed by all drivers in a city.
 * Stored in Firestore as city_stats/{city}.
 * New drivers read this as their starting baseline.
 */
export type CityStats = {
  city: string;
  totalRidesAggregated: number;
  avgPricePerKm: number;
  avgPricePerHour: number;
  p25PricePerKm: number;     // 25th percentile — "floor" to use as minimum
  p25PricePerHour: number;
  topNeighborhoods: string[];
  lastUpdated: string;       // ISO string (Firestore serverTimestamp)
};

// ─── Safety Rules ─────────────────────────────────────────────────────────────

export type SafetyRuleLevel =
  | 'hard_block'    // blocks the ride unconditionally
  | 'soft_warn'     // reduces score, warns driver
  | 'educational';  // informational — shown only to novice/learning drivers

export type SafetyRule = {
  id: string;
  level: SafetyRuleLevel;
  condition: string;           // internal key used by evaluateSafetyRules()
  messageNovice: string;       // detailed explanation for new drivers
  messageExperienced: string;  // short message for veterans (empty = skip entirely)
  penaltyScore: number;        // how much to deduct from the final score
  blocksRide: boolean;         // if true, shouldAccept is forced to false
};

// ─── Ride Analysis ────────────────────────────────────────────────────────────

/** Legacy shape — kept for backward compatibility with existing components. */
export type RideAnalysis = {
  ride: RideRequest;
  shouldAccept: boolean;
  pricePerKm: number;
  pricePerHour: number;
  reasons: string[];
  brainInsights: string[];
  historicalDataPointsProcessed: number;
  score: number;               // 0–100 "Serasa score"
};

/**
 * Extended analysis — superset of RideAnalysis.
 * Returned by analyzeRide() when a PersonalBrainState is provided.
 */
export type RideAnalysisV2 = RideAnalysis & {
  driverMode: DriverMode;
  safetyMessages: string[];    // safety-rule messages for this ride
  learnedInsights: string[];   // insights derived from personal data
  thresholdSource: 'personal' | 'collective' | 'profile_default';
  confidenceLevel: number;     // from PersonalBrainState
  usingPersonalData: boolean;
};

// ─── Hotspots ─────────────────────────────────────────────────────────────────

export type Hotspot = {
  id: string;
  name: string;
  address: string;
  esperaRecomendadaMin: number;
  nextHotspotId?: string;
  demandLevel: 'Baixa' | 'Média' | 'Alta' | 'Muito Alta';
  historicoGanhos: string;
  distanceKm: number;
  colaboradoresAtivos?: number;
  demandTrend?: 'up' | 'down' | 'stable';
  dataSource: 'dados_reais' | 'estimativa_logica';
  confidenceScore: number;
  routineProfile?: string;
  historicalConfirmations?: number;
  maturityStatus?: 'suposicao' | 'aprendizado' | 'comprovado';
};

// ─── Trail (Meu Dia) ──────────────────────────────────────────────────────────

export type TrailActionType = 'hotspot' | 'personal_stop' | 'calibration';

export type TrailStep = {
  id: string;
  time: string;               // HH:mm
  action: TrailActionType;
  title: string;
  location: string;
  description: string;
  expectedProfit?: string;
  completed: boolean;
  repeatInfo?: {
    type: 'none' | 'daily' | 'custom';
    days?: number[];           // 0=Sun … 6=Sat
  };
};
