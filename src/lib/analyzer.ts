/**
 * analyzer.ts — Copiloto Matemático do PRÉCHECA
 *
 * Este é o cérebro central: recebe uma corrida e retorna uma decisão fundamentada
 * em múltiplas camadas de inteligência, processadas em milissegundos:
 *
 *  Camada 1 — SEGURANÇA (safetyRules.ts)
 *    Bloqueios hard e soft. Nenhum preço justifica um hard_block.
 *
 *  Camada 2 — CUSTO OPERACIONAL REAL (cityKnowledge.ts)
 *    Quanto custa de verdade operar seu veículo. Break-even antes do score.
 *
 *  Camada 3 — THRESHOLDS PERSONALIZADOS (learner.ts)
 *    Não usa mínimos fixos — usa a média real do motorista por bairro/horário.
 *    Novatos → coletivo da cidade. Veteranos → dados próprios.
 *
 *  Camada 4 — SCORE MATEMÁTICO (pricePerKm × pricePerHour × pickupCost)
 *    A economia bruta da corrida contra os thresholds personalizados.
 *
 *  Camada 5 — INTELIGÊNCIA DE CONTEXTO (cityKnowledge.ts)
 *    Demanda atual do bairro, feriados, clima, dia da semana, tipo de bairro.
 *    Valor do destino (onde a corrida te deixa — custo de oportunidade).
 *
 *  Camada 6 — CUSTO DE OPORTUNIDADE (learner.ts)
 *    Quanto tempo esperará pelo próximo ping no destino desta corrida.
 *    Corridas que te deixam em zonas mortas têm penalização invisível.
 *
 *  Camada 7 — SCORE FINAL HÍBRIDO
 *    Pesos calibrados entre as camadas. Decisão binária + score 0-100.
 *
 *  Camada 8 — EXPLICAÇÃO ADAPTADA
 *    Novato → frases educativas detalhadas.
 *    Veterano → resumo direto, sem paternalismo.
 */

import {
  DriverProfile,
  RideRequest,
  RideAnalysis,
  RideAnalysisV2,
  Hotspot,
  TrailStep,
  VehicleCategory,
  RideContext,
  PersonalBrainState,
  DriverMode,
} from '../types';

import {
  getEffectiveThresholds,
  getOpportunityCost,
  getAnomalyInsights,
  classifyTimeOfDay,
  classifyDayType,
} from './learner';

import { evaluateSafetyRules } from './safetyRules';

import {
  getContextualDemandScore,
  getVehicleCostProfile,
  classifyNeighborhoodType,
  classifyDayCategory,
} from './cityKnowledge';

// ─── Vehicle Categories ───────────────────────────────────────────────────────

export const CATEGORIES: VehicleCategory[] = [
  { id: 'X',       name: 'UberX / 99Pop',        multiplier: 1.0 },
  { id: 'Comfort', name: 'Comfort / Plus',        multiplier: 1.35, isPremium: true },
  { id: 'Black',   name: 'Black / Executivo',     multiplier: 1.8,  isPremium: true },
];

// ─── Score Weights ────────────────────────────────────────────────────────────

/**
 * How much each layer contributes to the final score.
 * Total must equal 1.0.
 *
 * Math (km+hour price) carries the most weight — it's objective.
 * Context (demand, holiday, dropoff) adds nuance.
 * OpportunityCost is a small but real correction.
 */
const WEIGHT_MATH_KM    = 0.35; // R$/km vs threshold
const WEIGHT_MATH_HOUR  = 0.25; // R$/h vs threshold
const WEIGHT_PICKUP     = 0.10; // pickup distance penalty
const WEIGHT_CONTEXT    = 0.20; // demand signal + holiday + weather
const WEIGHT_OPPORTUNITY= 0.10; // where the ride drops you

// ─── Driver Profiles ──────────────────────────────────────────────────────────

export const PROFILES: DriverProfile[] = [
  {
    id: 'p-max-lucro',
    name: 'Lucro Máximo',
    description: 'Foco total no dinheiro. Espera mais, aceita menos — mas cada corrida vale muito.',
    minPricePerKm: 2.50,
    minPricePerHour: 60.0,
    maxDistanceToPassenger: 2.5,
    avoidRiskAreas: true,
    color: 'bg-emerald-600',
  },
  {
    id: 'p-diurno',
    name: 'Trabalho Diurno',
    description: 'Balanço entre volume e qualidade. Ideal para quem roda de dia e quer consistência.',
    minPricePerKm: 1.80,
    minPricePerHour: 40.0,
    maxDistanceToPassenger: 3.5,
    avoidRiskAreas: true,
    color: 'bg-blue-600',
  },
  {
    id: 'p-noturno',
    name: 'Roda Noturno',
    description: 'Segurança total à noite. Filtra riscos rigorosamente, prioriza áreas iluminadas.',
    minPricePerKm: 2.00,
    minPricePerHour: 50.0,
    maxDistanceToPassenger: 4.5,
    avoidRiskAreas: true,
    color: 'bg-indigo-600',
  },
];

// ─── User Preferences ─────────────────────────────────────────────────────────

export interface UserPreferences {
  avoidDirtRoads?: boolean;
  avoidRidesWithStops?: boolean;
  avoidTolls?: boolean;
  strictSafetyMode?: boolean;
  voiceAlerts?: boolean;
  vehicleSize?: 'small' | 'medium' | 'large' | 'suv';
  fuelType?: 'flex' | 'gasolina' | 'etanol' | 'eletrico' | 'hibrido';
}

// ─── Core Analysis Function ───────────────────────────────────────────────────

/**
 * analyzeRide — the main copilot decision function.
 *
 * Backward compatible: if brainState is omitted, falls back to the same
 * profile-based logic as before (legacy mode). Pass brainState for full AI.
 *
 * @param ride              - The incoming ride request
 * @param profile           - Active driver profile
 * @param categoryMultiplier - Vehicle category multiplier (1.0 for X, 1.35 Comfort, etc.)
 * @param userPreferences   - Driver settings
 * @param brainState        - Personal learning state (optional — enables full AI mode)
 * @param uid               - Firebase user ID (needed for opportunity cost lookup)
 * @returns RideAnalysisV2 (superset of legacy RideAnalysis)
 */
export function analyzeRide(
  ride: RideRequest,
  profile: DriverProfile,
  categoryMultiplier: number = 1.0,
  userPreferences: UserPreferences = {},
  brainState?: PersonalBrainState,
  uid?: string
): RideAnalysisV2 {
  // ── Parse time context ────────────────────────────────────────────────────
  const now = new Date();
  const [hourStr, minStr] = ride.context.exactTime.split(':');
  const rideHour = parseInt(hourStr ?? `${now.getHours()}`, 10);

  // ── Vehicle operating cost (real break-even) ──────────────────────────────
  const vehicleCost = getVehicleCostProfile(
    userPreferences.vehicleSize ?? 'small',
    userPreferences.fuelType ?? 'flex'
  );

  // ── Compute basic ride economics ──────────────────────────────────────────
  const totalDistance = ride.pickupDistance + ride.rideDistance;
  const totalTimeMin  = ride.pickupTimeMin + ride.rideTimeMin;
  const pricePerKm    = totalDistance > 0 ? ride.totalPrice / totalDistance : 0;
  const pricePerHour  = totalTimeMin  > 0 ? (ride.totalPrice / totalTimeMin) * 60 : 0;

  // ── Layer 1: Safety evaluation ────────────────────────────────────────────
  const driverMode: DriverMode = brainState?.driverMode ?? 'novice';
  const safetyEval = evaluateSafetyRules(
    ride,
    driverMode,
    userPreferences,
    pricePerKm,
    vehicleCost.costPerKm
  );

  const safetyMessages = safetyEval.messages;
  const reasons: string[] = [];
  const learnedInsights: string[] = [];

  // Hard block — return immediately without scoring
  if (safetyEval.hardBlocked) {
    const hardMsg = safetyEval.activeRules
      .filter((r) => r.blocksRide)
      .map((r) => (driverMode === 'experienced' ? r.messageExperienced : r.messageNovice))
      .join(' ');

    reasons.push(hardMsg);

    return buildResult({
      ride, shouldAccept: false, pricePerKm, pricePerHour,
      reasons, brainInsights: safetyMessages, learnedInsights,
      score: 0, driverMode, safetyMessages,
      thresholdSource: 'profile_default', confidenceLevel: 0,
      usingPersonalData: false,
      historicalDataPointsProcessed: brainState?.totalRidesAnalyzed ?? 0,
    });
  }

  // ── Layer 2: Get effective thresholds ─────────────────────────────────────
  const rideDate = now; // use current time — exactTime is already in context
  const rideTimePeriod = classifyTimeOfDay(rideHour);
  const rideDayType = classifyDayType(rideDate);

  const thresholdResult = brainState
    ? getEffectiveThresholds(
        brainState,
        ride.context.pickupNeighborhood,
        rideTimePeriod,
        rideDayType,
        profile.minPricePerKm,
        profile.minPricePerHour,
        categoryMultiplier
      )
    : {
        minPricePerKm: profile.minPricePerKm * categoryMultiplier,
        minPricePerHour: profile.minPricePerHour * categoryMultiplier,
        source: 'profile_default' as const,
        cellRides: 0,
      };

  const targetKm   = thresholdResult.minPricePerKm;
  const targetHour = thresholdResult.minPricePerHour;
  const thresholdSource = (thresholdResult.source === 'profile_default' || thresholdResult.source === 'collective')
    ? thresholdResult.source
    : 'personal';
  const usingPersonalData = thresholdResult.source.startsWith('personal');

  // Explain threshold source to driver
  if (usingPersonalData && thresholdResult.cellRides >= 3) {
    learnedInsights.push(
      driverMode === 'experienced'
        ? `Metas calculadas dos seus ${thresholdResult.cellRides} históricos nesta área`
        : `O algoritmo aprendeu com ${thresholdResult.cellRides} das suas corridas aqui e ajustou as metas automaticamente`
    );
  } else if (thresholdResult.source === 'collective') {
    learnedInsights.push(
      driverMode === 'novice'
        ? `Usando médias de todos os motoristas desta cidade como referência (você ainda está construindo seu histórico)`
        : `Usando dados coletivos — continue rodando para calibrar com seus próprios padrões`
    );
  }

  // ── Layer 3: Math score ───────────────────────────────────────────────────
  // Sub-score 1: R$/km (max 100 raw points, weighted)
  let kmRawScore = 0;
  if (targetKm > 0) {
    const ratio = pricePerKm / targetKm;
    kmRawScore = Math.min(100, ratio * 80); // 80 at target, 100 at 1.25× target
  }

  // Sub-score 2: R$/hour (max 100 raw points, weighted)
  let hrRawScore = 0;
  if (targetHour > 0) {
    const ratio = pricePerHour / targetHour;
    hrRawScore = Math.min(100, ratio * 80);
  }

  // Sub-score 3: Pickup distance penalty (max 100 raw points)
  // Perfect score at 0km, zero at profile max distance
  const maxDist = profile.maxDistanceToPassenger;
  const pickupRawScore = Math.max(0, 100 - (ride.pickupDistance / maxDist) * 100);

  // Math reasons
  if (pricePerKm >= targetKm) {
    reasons.push(formatReason(true, driverMode,
      `R$/km OK: ${fmt(pricePerKm)}/km — meta ${fmt(targetKm)}/km`,
      `Valor por km acima da sua meta (${fmt(pricePerKm)}/km vs meta ${fmt(targetKm)}/km) ✓`
    ));
  } else {
    const deficit = ((targetKm - pricePerKm) / targetKm * 100).toFixed(0);
    reasons.push(formatReason(false, driverMode,
      `R$/km baixo: ${fmt(pricePerKm)}/km (${deficit}% abaixo da meta ${fmt(targetKm)}/km)`,
      `Paga pouco por km: ${fmt(pricePerKm)}/km — sua meta é ${fmt(targetKm)}/km. ` +
      `Considerando seu histórico nesta área, esta corrida está ${deficit}% abaixo do que você costuma aceitar`
    ));
  }

  if (pricePerHour >= targetHour) {
    reasons.push(formatReason(true, driverMode,
      `R$/h OK: ${fmt(pricePerHour)}/h — meta ${fmt(targetHour)}/h`,
      `Rentabilidade por hora boa (${fmt(pricePerHour)}/h vs meta ${fmt(targetHour)}/h) ✓`
    ));
  } else {
    const deficit = ((targetHour - pricePerHour) / targetHour * 100).toFixed(0);
    reasons.push(formatReason(false, driverMode,
      `R$/h baixo: ${fmt(pricePerHour)}/h (meta ${fmt(targetHour)}/h)`,
      `Hora de trabalho desvalorizada: ${fmt(pricePerHour)}/h — meta é ${fmt(targetHour)}/h. ` +
      `Seu tempo vale mais. ${deficit}% abaixo do que você costuma ganhar neste período`
    ));
  }

  if (ride.pickupDistance > maxDist) {
    reasons.push(formatReason(false, driverMode,
      `Busca longa: ${ride.pickupDistance}km (limite ${maxDist}km)`,
      `Passageiro a ${ride.pickupDistance}km — você vai gastar ~${fmtMin(ride.pickupTimeMin)} e ` +
      `~${fmt(ride.pickupDistance * vehicleCost.costPerKm)} em combustível só para buscar. ` +
      `Limite do seu perfil é ${maxDist}km`
    ));
  } else {
    reasons.push(formatReason(true, driverMode,
      `Busca OK: ${ride.pickupDistance}km`,
      `Passageiro pertinho — só ${ride.pickupDistance}km (${fmtMin(ride.pickupTimeMin)}) ✓`
    ));
  }

  // ── Layer 4: Contextual demand score ─────────────────────────────────────
  const dropoffNeighborhood = ride.dropoffLocation.split(' - ').pop() ?? ride.dropoffLocation;
  const ctxScore = getContextualDemandScore(
    ride.context.pickupNeighborhood,
    dropoffNeighborhood,
    rideDate,
    ride.context.weather
  );

  // Raw context score: demand multiplier → normalized 0–100
  // 1.0 demand = 50 pts. 2.0 = 75. 0.5 = 25. Above 2.5 = cap 90.
  const contextRawScore = Math.min(90, Math.max(10,
    50 + (ctxScore.demandMultiplier - 1.0) * 40
  ));

  // Add context insights
  learnedInsights.push(...ctxScore.contextInsights);

  if (ctxScore.isHoliday || ctxScore.isEve) {
    learnedInsights.push(
      ctxScore.isEve
        ? `📅 Véspera de ${ctxScore.holidayName} — demanda de saída alta`
        : `📅 Feriado (${ctxScore.holidayName}) — padrão de demanda alterado`
    );
  }

  // ── Layer 5: Opportunity cost ─────────────────────────────────────────────
  const estNextWaitMin = uid
    ? getOpportunityCost(uid, dropoffNeighborhood)
    : 15; // default if no uid

  // Raw opportunity score: 5min wait = 90, 30min wait = 10
  const opportunityRawScore = Math.max(10, Math.min(90,
    90 - ((estNextWaitMin - 5) / 25) * 80
  ));

  // Dropoff value bonus/penalty
  const dropoffBonus = ctxScore.dropoffValue * 20; // 0–20 bonus pts
  const opportunityFinalScore = Math.min(100, opportunityRawScore + dropoffBonus);

  if (estNextWaitMin > 20) {
    learnedInsights.push(
      driverMode === 'experienced'
        ? `Destino com espera ~${estNextWaitMin}min pelo próximo ping`
        : `📍 Destino em área de baixa demanda: estima-se ~${estNextWaitMin}min até o próximo ping. ` +
          `Isso entra no cálculo — corrida boa que te deixa mal posicionado vale menos`
    );
  } else if (estNextWaitMin <= 8) {
    learnedInsights.push(
      driverMode === 'experienced'
        ? `Destino quente — próximo ping rápido (~${estNextWaitMin}min)`
        : `✅ Destino em boa área — histórico indica próximo ping em ~${estNextWaitMin}min`
    );
  }

  // ── Layer 6: Safety penalty ────────────────────────────────────────────────
  // Safety rules already returned totalPenalty (0–100). Apply to final score.
  const safetyPenaltyFraction = Math.min(0.8, safetyEval.totalPenalty / 100);

  // ── Layer 7: Final hybrid score ───────────────────────────────────────────
  const rawScore =
    kmRawScore         * WEIGHT_MATH_KM    +
    hrRawScore         * WEIGHT_MATH_HOUR  +
    pickupRawScore     * WEIGHT_PICKUP     +
    contextRawScore    * WEIGHT_CONTEXT    +
    opportunityFinalScore * WEIGHT_OPPORTUNITY;

  // Apply safety penalty as a multiplier reduction
  const penalizedScore = rawScore * (1 - safetyPenaltyFraction);
  const finalScore = Math.round(Math.max(0, Math.min(100, penalizedScore)));

  // ── Decision ──────────────────────────────────────────────────────────────
  // Thresholds: accept ≥ 65, soft zone 55–64, reject < 55
  // Hard safety rules already handled above (returned early).
  let shouldAccept = finalScore >= 65;

  // Hard veto overrides: even if score is high, block these
  if (userPreferences.strictSafetyMode && ride.isRiskArea) shouldAccept = false;
  if (userPreferences.avoidDirtRoads && ride.isDirtRoad) shouldAccept = false;
  if (userPreferences.avoidRidesWithStops && ride.hasStops) shouldAccept = false;
  if (userPreferences.avoidTolls && ride.hasTolls) shouldAccept = false;

  // Score summary insight
  const scoreLabel =
    finalScore >= 80 ? 'Excelente'
    : finalScore >= 65 ? 'Boa'
    : finalScore >= 55 ? 'Marginal'
    : 'Fraca';

  const mathPartial = Math.round(
    kmRawScore * WEIGHT_MATH_KM + hrRawScore * WEIGHT_MATH_HOUR + pickupRawScore * WEIGHT_PICKUP
  );
  const ctxPartial = Math.round(
    contextRawScore * WEIGHT_CONTEXT + opportunityFinalScore * WEIGHT_OPPORTUNITY
  );

  learnedInsights.push(
    driverMode === 'experienced'
      ? `Score: ${finalScore}/100 (${scoreLabel}) | Math: ${mathPartial} | Contexto: ${ctxPartial}`
      : `Pontuação da corrida: ${finalScore}/100 — ${scoreLabel}. ` +
        `Parte matemática (preço+km+hora): ${mathPartial}/70. ` +
        `Parte contextual (demanda+posição): ${ctxPartial}/30.`
  );

  // Add anomaly insights from learning engine
  if (uid) {
    const anomalies = getAnomalyInsights(uid);
    learnedInsights.push(...anomalies.slice(0, 2));
  }

  return buildResult({
    ride, shouldAccept, pricePerKm, pricePerHour,
    reasons, brainInsights: [...learnedInsights, ...safetyMessages],
    learnedInsights, score: finalScore, driverMode,
    safetyMessages,
    thresholdSource: thresholdResult.source === 'profile_default' ? 'profile_default'
      : thresholdResult.source === 'collective' ? 'collective' : 'personal',
    confidenceLevel: brainState?.confidenceLevel ?? 0,
    usingPersonalData,
    historicalDataPointsProcessed: brainState?.totalRidesAnalyzed ?? 0,
  });
}

// ─── Result Builder ───────────────────────────────────────────────────────────

interface BuildResultParams {
  ride: RideRequest;
  shouldAccept: boolean;
  pricePerKm: number;
  pricePerHour: number;
  reasons: string[];
  brainInsights: string[];
  learnedInsights: string[];
  score: number;
  driverMode: DriverMode;
  safetyMessages: string[];
  thresholdSource: 'personal' | 'collective' | 'profile_default';
  confidenceLevel: number;
  usingPersonalData: boolean;
  historicalDataPointsProcessed: number;
}

function buildResult(p: BuildResultParams): RideAnalysisV2 {
  return {
    ride: p.ride,
    shouldAccept: p.shouldAccept,
    pricePerKm: p.pricePerKm,
    pricePerHour: p.pricePerHour,
    reasons: p.reasons,
    brainInsights: p.brainInsights,
    historicalDataPointsProcessed: p.historicalDataPointsProcessed,
    score: p.score,
    driverMode: p.driverMode,
    safetyMessages: p.safetyMessages,
    learnedInsights: p.learnedInsights,
    thresholdSource: p.thresholdSource,
    confidenceLevel: p.confidenceLevel,
    usingPersonalData: p.usingPersonalData,
  };
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

function fmt(value: number): string {
  return `R$ ${value.toFixed(2)}`;
}

function fmtMin(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}

/**
 * Returns a reason string formatted for the driver's experience level.
 * veterans get the short version, novices get the explanation.
 */
function formatReason(
  positive: boolean,
  driverMode: DriverMode,
  shortMsg: string,
  longMsg: string
): string {
  if (driverMode === 'experienced') return shortMsg;
  return longMsg;
}

// ─── Hotspot & Trail Generators ───────────────────────────────────────────────
// These functions are unchanged from the original — they work globally by
// using the detected neighborhood name dynamically.

export const getHotspotsForProfile = (
  profileId: string,
  lat?: number,
  lng?: number,
  neighborhood: string = 'Centro'
): Hotspot[] => {
  const isNight = profileId === 'p-noturno';
  const isPremium = profileId === 'p-max-lucro';

  const data = {
    com: `Shopping / Centros Comerciais em ${neighborhood}`,
    business: `Polo Empresarial em ${neighborhood}`,
    transport: `Estação / Terminal de ${neighborhood}`,
    address: `Bairro: ${neighborhood}`,
  };

  return [
    {
      id: `hs-1-${neighborhood.replace(/\s+/g, '-')}`,
      name: data.com,
      address: data.address,
      esperaRecomendadaMin: isNight ? 10 : 15,
      demandLevel: 'Muito Alta',
      historicoGanhos: isPremium ? 'R$ 75-120/h' : 'R$ 45-75/h',
      distanceKm: 0.8,
      dataSource: 'dados_reais',
      confidenceScore: 96,
      routineProfile: isNight ? 'Fluxo de Bares e Lazer' : 'Fluxo Comercial Ativo',
      demandTrend: 'up',
      maturityStatus: 'comprovado',
    },
    {
      id: `hs-2-${neighborhood.replace(/\s+/g, '-')}`,
      name: data.business,
      address: `Eixo Comercial - ${neighborhood}`,
      esperaRecomendadaMin: 20,
      demandLevel: 'Alta',
      historicoGanhos: isPremium ? 'R$ 90-150/h' : 'R$ 55-90/h',
      distanceKm: 2.1,
      dataSource: 'estimativa_logica',
      confidenceScore: 89,
      routineProfile: 'Escritórios / Reuniões',
      demandTrend: 'stable',
      maturityStatus: 'aprendizado',
    },
    {
      id: `hs-3-${neighborhood.replace(/\s+/g, '-')}`,
      name: data.transport,
      address: 'Hub de Integração',
      esperaRecomendadaMin: 5,
      demandLevel: 'Muito Alta',
      historicoGanhos: 'R$ 40-60/h',
      distanceKm: 1.2,
      dataSource: 'dados_reais',
      confidenceScore: 92,
      routineProfile: 'Alta Rotatividade',
      demandTrend: 'up',
      maturityStatus: 'comprovado',
    },
  ];
};

export const getTrailForProfile = (
  profileId: string,
  neighborhood: string = 'Centro'
): TrailStep[] => {
  const ctx = neighborhood !== 'Centro' ? `em ${neighborhood}` : '';
  if (profileId === 'p-max-lucro') {
    return [
      { id: 't-1-max', time: '05:30', action: 'hotspot',       title: `Aeroporto e Hotéis ${ctx}`,       location: `Hotéis ${ctx}`,                 description: 'Executivos viajam cedo. Corridas longas e bem pagas.',    expectedProfit: 'R$ 70–120', completed: true,  repeatInfo: { type: 'daily' } },
      { id: 't-2-max', time: '07:30', action: 'hotspot',       title: `Retorno do Aeroporto ${ctx}`,     location: `Saídas do terminal ${ctx}`,     description: 'Chegadas de voo → passageiros indo pro trabalho ou hotel.', expectedProfit: 'R$ 80–140', completed: false, repeatInfo: { type: 'daily' } },
      { id: 't-3-max', time: '11:00', action: 'personal_stop', title: 'Pausa obrigatória',               location: 'Economize combustível',         description: 'Horário de baixa demanda. Poupe e descanse.',             completed: false, repeatInfo: { type: 'daily' } },
      { id: 't-4-max', time: '16:30', action: 'hotspot',       title: `Saída de Executivos ${ctx}`,      location: `Grandes prédios ${ctx}`,        description: 'Levar chefes ao Comfort/Black. Maior lucro do dia.',      expectedProfit: 'R$ 90–150', completed: false, repeatInfo: { type: 'daily' } },
    ];
  }
  if (profileId === 'p-noturno') {
    return [
      { id: 't-1-nig', time: '19:00', action: 'personal_stop', title: 'Jantar e preparação',             location: 'Casa',                          description: 'Alimente-se bem antes da noite. Hidrate-se.',             completed: true },
      { id: 't-2-nig', time: '21:00', action: 'hotspot',       title: `Zona de lazer ${ctx}`,            location: `Bares e restaurantes ${ctx}`,   description: 'Pegue quem vai festejar. Corridas curtas e frequentes.',  expectedProfit: 'R$ 50–90', completed: true },
      { id: 't-3-nig', time: '01:00', action: 'hotspot',       title: `Avenidas seguras ${ctx}`,         location: 'Vias iluminadas',               description: 'Só avenidas grandes. Voltar o pessoal pra casa com segurança.', expectedProfit: 'R$ 70–120', completed: false },
      { id: 't-4-nig', time: '04:00', action: 'calibration',   title: 'Bloqueio zonas de risco',         location: `Zonas desertas ${ctx}`,        description: 'Algoritmo trava corridas pra ruas de terra e áreas de risco de madrugada.', completed: false },
    ];
  }
  return [
    { id: 't-1-day', time: '07:30', action: 'hotspot',       title: `Saída residencial ${ctx}`,        location: `Bairros distantes ${ctx}`,      description: 'Trabalhadores indo pro trabalho. Corridas longas pra o centro.', expectedProfit: 'R$ 40–70', completed: true,  repeatInfo: { type: 'daily' } },
    { id: 't-2-day', time: '09:30', action: 'calibration',   title: `Polo médico ${ctx}`,              location: `Hospitais e clínicas ${ctx}`,   description: 'Idosos e pacientes indo pra consultas — perfil seguro.',  completed: true },
    { id: 't-3-day', time: '12:00', action: 'hotspot',       title: `Comércio local ${ctx}`,           location: `Rua de comércio ${ctx}`,        description: 'Saída pro almoço. Corridas curtas e contínuas.',          expectedProfit: 'R$ 45–65', completed: false, repeatInfo: { type: 'daily' } },
    { id: 't-4-day', time: '15:00', action: 'personal_stop', title: `Saída escolar ${ctx}`,            location: `Colégios particulares ${ctx}`,  description: 'Mães pedindo corrida pras atividades dos filhos. Seguro.', completed: false, repeatInfo: { type: 'daily' } },
    { id: 't-5-day', time: '18:00', action: 'hotspot',       title: `Volta pra casa ${ctx}`,           location: `Centro da região ${ctx}`,       description: 'Não aceite corridas de volta ao centro — vai piorar sua posição.', expectedProfit: 'R$ 50–80', completed: false, repeatInfo: { type: 'daily' } },
  ];
};

// ─── Ride Simulator ───────────────────────────────────────────────────────────
// Generates realistic test rides — weighted toward real scenarios.

export const simulateIncomingRide = (contextOverride?: Partial<RideContext>): RideRequest => {
  const isGoodRide = Math.random() > 0.4; // 60% good rides for demo realism

  const pickupDist = parseFloat(
    (isGoodRide ? Math.random() * 2 + 0.5 : Math.random() * 8 + 0.5).toFixed(1)
  );
  const rideDist = parseFloat((Math.random() * 30 + 1.0).toFixed(1));
  const pickupTime = Math.ceil((pickupDist / 30) * 60) + (isGoodRide ? 0 : Math.floor(Math.random() * 3));
  const rideTime = Math.ceil((rideDist / 35) * 60) + (isGoodRide ? 1 : Math.floor(Math.random() * 10));
  const priceFactor = isGoodRide ? Math.random() * 1.5 + 2.0 : Math.random() * 1.0 + 1.0;
  const totalPrice = parseFloat(((pickupDist + rideDist) * priceFactor).toFixed(2));

  const now = new Date();
  const days = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const times: Array<'Manhã'|'Tarde'|'Noite'|'Madrugada'> = ['Manhã','Tarde','Noite','Madrugada'];
  const weathers: Array<'Limpo'|'Chovendo'|'Nublado'> = ['Limpo','Chovendo','Nublado','Limpo'];
  const platforms: Array<'Uber'|'99'> = ['Uber','99','Uber','Uber'];
  const names = ['João','Maria','Carlos','Ana','Bruno','Laura'];

  const day   = contextOverride?.dayOfWeek ?? days[now.getDay()];
  const tod   = contextOverride?.timeOfDay ?? times[Math.floor(Math.random() * times.length)];
  const wthr  = contextOverride?.weather ?? weathers[Math.floor(Math.random() * weathers.length)];
  const hood  = contextOverride?.pickupNeighborhood ?? `Bairro ${Math.ceil(Math.random() * 20)}`;
  const exact = contextOverride?.exactTime ??
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  return {
    id: `ride-${Math.floor(Math.random() * 100000)}`,
    platform: platforms[Math.floor(Math.random() * platforms.length)],
    passengerRating: parseFloat(
      (isGoodRide ? Math.random() * 0.2 + 4.8 : Math.random() * 1.0 + 4.0).toFixed(2)
    ),
    passengerName: names[Math.floor(Math.random() * names.length)],
    pickupDistance: pickupDist,
    pickupTimeMin: pickupTime,
    rideDistance: rideDist,
    rideTimeMin: rideTime,
    totalPrice,
    pickupLocation: isGoodRide ? `Av. Principal, 100 - ${hood}` : `Rua das Pedras, 5 - ${hood}`,
    dropoffLocation: isGoodRide ? `Centro Comercial - Destino` : `Estrada Sem Saída - Periferia`,
    isRiskArea: !isGoodRide && Math.random() > 0.8,
    hasStops: Math.random() > 0.85,
    isDirtRoad: !isGoodRide && Math.random() > 0.9,
    hasTolls: Math.random() > 0.7,
    context: {
      dayOfWeek: day,
      timeOfDay: tod,
      exactTime: exact,
      weather: wthr,
      pickupNeighborhood: hood,
    },
  };
};
