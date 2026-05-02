/**
 * missionPlanner.ts — Gerador de Missões Estratégicas
 *
 * Ao abrir o app, gera N missões (estratégias de posicionamento) pontuadas
 * pelo contexto real: clima, feriado, hora do dia, histórico pessoal.
 *
 * Cada missão inclui:
 *  • Área-alvo (tipo de bairro + exemplos)
 *  • R$ estimado para a janela de tempo
 *  • Km total estimado
 *  • Nº estimado de corridas
 *  • Confiança % (baseada em qualidade dos dados)
 *  • Motivo (por que essa missão agora)
 *  • Riscos
 *
 * O driver pode aceitar a missão #1 ou pedir alternativa (missões #2, #3...).
 * Missões aceitas são logadas no Firestore para construir histórico.
 */

import {
  getDemandSignal,
  classifyDayCategory,
  NeighborhoodType,
  DayCategory,
} from './cityKnowledge';
import { PersonalBrainState } from '../types';
import { LiveContext } from './contextService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Mission {
  id: string;
  rank: number;                    // 1, 2, 3… (sorted by expected earnings)
  strategy: string;                // "Centro Financeiro", "Zona Boêmia", etc.
  emoji: string;
  neighborhoodType: NeighborhoodType;
  targetDescription: string;       // Área sugerida (bairros específicos do histórico, ou tipo genérico)
  specificNeighborhoods: string[];  // Se houver dados históricos, bairros reais

  // Estimates
  estimatedEarningsR$: number;     // R$ na janela de tempo
  estimatedKm: number;             // km total estimados
  estimatedRides: number;          // nº de corridas estimadas
  estimatedWindowMin: number;      // janela de tempo em minutos
  avgPricePerRide: number;         // R$ médio por corrida

  // Quality signals
  confidencePercent: number;        // 0–100
  demandMultiplier: number;
  demandScore: number;              // raw score for sorting

  // Explanation
  reasonWhy: string;
  risks: string[];
  badge?: string;                   // "🔥 Pico agora", "⭐ Melhor R$/h", "🆕 Novo horário"

  // State
  accepted: boolean;
  dismissed: boolean;
  suggestedAt: Date;
}

// ─── Strategy Definitions ─────────────────────────────────────────────────────

interface StrategyDef {
  id: string;
  name: string;
  emoji: string;
  neighborhoodType: NeighborhoodType;
  /** Generic description shown when no personal history exists */
  genericTarget: string;
  /** Base rides per hour under normal demand */
  baseRidesPerHour: number;
  /** Base average price per ride in R$ (category X, no multiplier) */
  baseAvgPriceR$: number;
  /** Average ride distance in km */
  avgRideKm: number;
  /** Hours of day where this strategy works best (pairs of [start, end]) */
  peakHours: [number, number][];
  /** Day categories where this strategy is best */
  peakDays: DayCategory[];
  /** Why this works */
  baseReason: string;
  /** Risks */
  baseRisks: string[];
}

const STRATEGIES: StrategyDef[] = [
  {
    id: 'centro_financeiro',
    name: 'Centro Financeiro',
    emoji: '🏙️',
    neighborhoodType: 'comercial_central',
    genericTarget: 'Centro / Faria Lima / CBD da sua cidade',
    baseRidesPerHour: 2.8,
    baseAvgPriceR$: 22,
    avgRideKm: 9,
    peakHours: [[7, 10], [12, 14], [17, 21]],
    peakDays: ['dia_util', 'sexta', 'vespera_feriado'],
    baseReason: 'Alta concentração de executivos e empresas. Pico de entrada e saída do trabalho.',
    baseRisks: ['Trânsito pesado nos horários de pico', 'Corridas curtas durante o almoço'],
  },
  {
    id: 'zona_boemea',
    name: 'Zona Boêmia',
    emoji: '🍺',
    neighborhoodType: 'lazer_noturno',
    genericTarget: 'Área de bares e baladas da sua cidade',
    baseRidesPerHour: 3.8,
    baseAvgPriceR$: 19,
    avgRideKm: 7,
    peakHours: [[20, 24], [0, 4]],
    peakDays: ['sexta', 'sabado', 'feriado', 'carnaval', 'vespera_feriado'],
    baseReason: 'Alta rotatividade de passageiros saindo de bares e restaurantes.',
    baseRisks: ['Passageiros alcoolizados', 'Trânsito lento em ruas estreitas'],
  },
  {
    id: 'aeroporto',
    name: 'Aeroporto / Terminal',
    emoji: '✈️',
    neighborhoodType: 'aeroporto_rodoviaria',
    genericTarget: 'Aeroporto ou rodoviária principal da cidade',
    baseRidesPerHour: 1.6,
    baseAvgPriceR$: 48,
    avgRideKm: 22,
    peakHours: [[5, 9], [12, 14], [17, 20]],
    peakDays: ['dia_util', 'sexta', 'sabado', 'domingo', 'vespera_feriado', 'pos_feriado'],
    baseReason: 'Corridas longas e bem pagas. Passageiros com malas pagam mais.',
    baseRisks: ['Fila de espera no pátio', 'Tempo de ida até o aeroporto'],
  },
  {
    id: 'universitario',
    name: 'Área Universitária',
    emoji: '🎓',
    neighborhoodType: 'universitario',
    genericTarget: 'Campus universitários e repúblicas da região',
    baseRidesPerHour: 3.2,
    baseAvgPriceR$: 14,
    avgRideKm: 6,
    peakHours: [[7, 9], [12, 14], [17, 20], [22, 24]],
    peakDays: ['dia_util', 'sexta'],
    baseReason: 'Alta frequência de corridas curtas. Demanda constante de estudantes.',
    baseRisks: ['Preço médio baixo', 'Estacionamento difícil próximo ao campus'],
  },
  {
    id: 'shopping',
    name: 'Shopping / Retail',
    emoji: '🛍️',
    neighborhoodType: 'shopping',
    genericTarget: 'Shoppings e grandes centros comerciais',
    baseRidesPerHour: 2.5,
    baseAvgPriceR$: 16,
    avgRideKm: 7,
    peakHours: [[10, 22]],
    peakDays: ['sabado', 'domingo', 'feriado'],
    baseReason: 'Movimento constante nos fins de semana. Famílias e casais.',
    baseRisks: ['Trânsito lento nos acessos', 'Corridas curtas (dentro do bairro)'],
  },
  {
    id: 'hospitalar',
    name: 'Polo Hospitalar',
    emoji: '🏥',
    neighborhoodType: 'hospitalar',
    genericTarget: 'Hospitais e clínicas da cidade',
    baseRidesPerHour: 2.0,
    baseAvgPriceR$: 21,
    avgRideKm: 8,
    peakHours: [[6, 9], [16, 20]],
    peakDays: ['dia_util', 'sexta', 'sabado'],
    baseReason: 'Demanda estável 24h. Pacientes e visitantes chegando/saindo.',
    baseRisks: ['Demanda mais lenta em horário de almoço'],
  },
  {
    id: 'residencial_alto',
    name: 'Condomínios / Alto Padrão',
    emoji: '🏘️',
    neighborhoodType: 'residencial_alto',
    genericTarget: 'Bairros nobres e condomínios fechados',
    baseRidesPerHour: 1.8,
    baseAvgPriceR$: 30,
    avgRideKm: 13,
    peakHours: [[7, 9], [17, 21]],
    peakDays: ['dia_util', 'sexta', 'sabado'],
    baseReason: 'Corridas longas e bem pagas. Passageiros mais educados.',
    baseRisks: ['Frequência menor de pings', 'Pode demorar mais entre corridas'],
  },
  {
    id: 'residencial_medio',
    name: 'Bairros Residenciais',
    emoji: '🏠',
    neighborhoodType: 'residencial_medio',
    genericTarget: 'Bairros residenciais de classe média',
    baseRidesPerHour: 2.3,
    baseAvgPriceR$: 15,
    avgRideKm: 7,
    peakHours: [[6, 9], [17, 20]],
    peakDays: ['dia_util'],
    baseReason: 'Trabalhadores saindo de casa cedo. Corridas regulares para o trabalho.',
    baseRisks: ['Preço médio baixo', 'Demanda cai muito fora do horário de rush'],
  },
];

// ─── Scoring ──────────────────────────────────────────────────────────────────

function isInPeakHours(hour: number, peakHours: [number, number][]): boolean {
  return peakHours.some(([start, end]) =>
    end > start
      ? hour >= start && hour < end
      : hour >= start || hour < end  // overnight range (e.g., 22–4)
  );
}

function isPeakDay(day: DayCategory, peakDays: DayCategory[]): boolean {
  return peakDays.includes(day) || day === 'dia_util';
}

/**
 * Scores a strategy for current conditions.
 * Returns a 0–10 score (higher = better fit right now).
 */
function scoreStrategy(
  strategy: StrategyDef,
  hour: number,
  dayCategory: DayCategory,
  weather: 'Limpo' | 'Chovendo' | 'Nublado',
  demandMultiplier: number
): number {
  let score = demandMultiplier * 3; // base from real demand signal

  // Peak hours bonus
  if (isInPeakHours(hour, strategy.peakHours)) score += 2.5;
  else score -= 1.5;

  // Peak day bonus
  if (isPeakDay(dayCategory, strategy.peakDays)) score += 1.5;
  else score -= 0.5;

  // Weather adjustments
  if (weather === 'Chovendo') {
    // Rain boosts ALL strategies but especially zones with lots of stops (bars, shopping)
    if (['zona_boemea', 'shopping', 'universitario'].includes(strategy.id)) score += 1.0;
    else score += 0.5;
  }

  // Special event boosts
  if (dayCategory === 'carnaval' && strategy.id === 'zona_boemea') score += 3.0;
  if (dayCategory === 'reveillon' && strategy.id === 'zona_boemea') score += 4.0;
  if ((dayCategory === 'vespera_feriado' || dayCategory === 'feriado') && strategy.id === 'aeroporto') score += 1.5;

  return Math.max(0, score);
}

// ─── Estimate Calculations ────────────────────────────────────────────────────

function calculateEstimates(
  strategy: StrategyDef,
  demandMultiplier: number,
  windowMin: number,
  categoryMultiplier: number,   // 1.0 for X, 1.2 for Comfort, 1.5 for Black
  brainState: PersonalBrainState | null
): {
  estimatedRides: number;
  estimatedEarningsR$: number;
  estimatedKm: number;
  avgPricePerRide: number;
  confidencePercent: number;
} {
  const windowHours = windowMin / 60;

  // Rides per hour, adjusted by demand
  const effectiveRidesPerHour = strategy.baseRidesPerHour * Math.min(demandMultiplier, 2.0);
  const estimatedRides = Math.round(effectiveRidesPerHour * windowHours * 10) / 10;

  // Average price — use brain data if available for this neighborhood type
  let avgPrice = strategy.baseAvgPriceR$ * categoryMultiplier;

  if (brainState && brainState.globalAvgPricePerKm > 0) {
    // Adjust using personal avg — more accurate than static baseline
    const personalAdjustment = brainState.globalAvgPricePerKm / 1.8; // 1.8 = our baseline R$/km
    avgPrice = strategy.baseAvgPriceR$ * categoryMultiplier * Math.min(personalAdjustment, 1.8);
  }

  const estimatedEarningsR$ = Math.round(estimatedRides * avgPrice);
  const estimatedKm = Math.round(estimatedRides * strategy.avgRideKm * 1.25); // +25% for pickups

  // Confidence: based on data quality
  let confidence = 50; // base
  if (brainState) {
    confidence += Math.min(25, brainState.confidenceLevel * 0.25);
    // Boost if we have history in this neighborhood type
    const hasHistory = brainState.learnedThresholds.length > 0;
    if (hasHistory) confidence += 10;
  }
  // Boost for peak hours/days alignment (more predictable)
  const now = new Date();
  const dayCategory = classifyDayCategory(now);
  if (isInPeakHours(now.getHours(), strategy.peakHours) && isPeakDay(dayCategory, strategy.peakDays)) {
    confidence += 15;
  }
  confidence = Math.min(94, Math.max(30, confidence));

  return {
    estimatedRides: Math.max(0.5, estimatedRides),
    estimatedEarningsR$: Math.max(10, estimatedEarningsR$),
    estimatedKm: Math.max(5, estimatedKm),
    avgPricePerRide: Math.round(avgPrice),
    confidencePercent: Math.round(confidence),
  };
}

// ─── Specific Neighborhoods from Brain ───────────────────────────────────────

/**
 * If the driver has personal history, pull real neighborhood names
 * that match the strategy's neighborhood type.
 */
function getSpecificNeighborhoods(
  strategy: StrategyDef,
  brainState: PersonalBrainState | null
): string[] {
  if (!brainState || brainState.learnedThresholds.length === 0) return [];

  // Sort by avgPricePerKm descending, take top 3
  return brainState.learnedThresholds
    .filter(t => t.totalRides >= 2)
    .sort((a, b) => b.avgPricePerKm - a.avgPricePerKm)
    .slice(0, 3)
    .map(t => t.neighborhood);
}

// ─── Badge assignment ─────────────────────────────────────────────────────────

function assignBadge(
  rank: number,
  score: number,
  demandMultiplier: number,
  strategy: StrategyDef
): string | undefined {
  if (rank === 1 && demandMultiplier >= 1.5) return '🔥 Pico agora';
  if (rank === 1) return '⭐ Melhor opção';
  if (strategy.id === 'aeroporto') return '✈️ Alto valor por corrida';
  if (strategy.id === 'zona_boemea') return '🍺 Alta rotatividade';
  if (score > 7) return '📈 Demanda acima do normal';
  return undefined;
}

// ─── Risk enrichment ──────────────────────────────────────────────────────────

function enrichRisks(
  strategy: StrategyDef,
  weather: 'Limpo' | 'Chovendo' | 'Nublado',
  dayCategory: DayCategory,
  hour: number
): string[] {
  const risks = [...strategy.baseRisks];

  if (weather === 'Chovendo') {
    if (['zona_boemea', 'universitario'].includes(strategy.id)) {
      risks.push('Chuva pode atrasar embarque — leve protetor para o celular');
    } else {
      risks.push('Trânsito 20–30% mais lento com chuva');
    }
  }

  if ((dayCategory === 'feriado' || dayCategory === 'domingo') && strategy.id === 'comercial_central') {
    risks.push('Centro esvaziado em feriado — demanda muito baixa');
  }

  if (hour >= 22 && strategy.id === 'residencial_medio') {
    risks.push('Poucos pings residenciais após 22h');
  }

  return risks;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface MissionPlannerInput {
  windowMin?: number;            // Janela de trabalho em minutos (default: 120)
  categoryMultiplier?: number;   // Multiplicador da categoria (Comfort, Black, X)
  liveContext: LiveContext | null;
  brainState: PersonalBrainState | null;
}

/**
 * Generates a sorted list of mission alternatives for the driver.
 * Returns all strategies scored, so the UI can swap dismissed ones.
 *
 * @param count  How many to return (usually request all, show 3 at a time in UI)
 */
export function generateMissions(
  input: MissionPlannerInput,
  count: number = 8
): Mission[] {
  const now = new Date();
  const hour = now.getHours();
  const dayCategory = classifyDayCategory(now);
  const weather = input.liveContext?.weatherData.weather ?? 'Limpo';
  const windowMin = input.windowMin ?? 120;
  const categoryMultiplier = input.categoryMultiplier ?? 1.0;

  const scored = STRATEGIES.map(strategy => {
    // Get real demand signal for this strategy's neighborhood type
    const demandSignal = getDemandSignal(strategy.neighborhoodType, hour, dayCategory, weather);
    const score = scoreStrategy(strategy, hour, dayCategory, weather, demandSignal.multiplier);

    const estimates = calculateEstimates(
      strategy,
      demandSignal.multiplier,
      windowMin,
      categoryMultiplier,
      input.brainState
    );

    const specificNeighborhoods = getSpecificNeighborhoods(strategy, input.brainState);
    const risks = enrichRisks(strategy, weather, dayCategory, hour);

    return { strategy, score, demandSignal, estimates, specificNeighborhoods, risks };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, count).map((item, i) => {
    const rank = i + 1;
    const badge = assignBadge(rank, item.score, item.demandSignal.multiplier, item.strategy);

    return {
      id: `mission_${item.strategy.id}_${now.getTime()}`,
      rank,
      strategy: item.strategy.name,
      emoji: item.strategy.emoji,
      neighborhoodType: item.strategy.neighborhoodType,
      targetDescription: item.strategy.genericTarget,
      specificNeighborhoods: item.specificNeighborhoods,

      estimatedEarningsR$: item.estimates.estimatedEarningsR$,
      estimatedKm: item.estimates.estimatedKm,
      estimatedRides: item.estimates.estimatedRides,
      estimatedWindowMin: windowMin,
      avgPricePerRide: item.estimates.avgPricePerRide,

      confidencePercent: item.estimates.confidencePercent,
      demandMultiplier: item.demandSignal.multiplier,
      demandScore: item.score,

      reasonWhy: item.demandSignal.insight || item.strategy.baseReason,
      risks: item.risks,
      badge,

      accepted: false,
      dismissed: false,
      suggestedAt: now,
    } satisfies Mission;
  });
}
