/**
 * safetyRules.ts — Sistema de Segurança em Camadas
 *
 * Três níveis de regra:
 *   hard_block   → bloqueia a corrida independentemente do score
 *   soft_warn    → reduz o score e avisa o motorista
 *   educational  → só aparece para novatos/aprendendo — explica o "porquê"
 *
 * Cada regra tem duas mensagens: novato (explicação detalhada) e veterano
 * (curta — eles já sabem o contexto).
 *
 * Nenhuma regra hardcodeia nomes de bairros — tudo é dinâmico.
 */

import { RideRequest, SafetyRule, DriverMode } from '../types';

// ─── Rule Definitions ─────────────────────────────────────────────────────────

export const SAFETY_RULES: SafetyRule[] = [
  // ── HARD BLOCKS ────────────────────────────────────────────────────────────

  {
    id: 'hard-risk-area-strict',
    level: 'hard_block',
    condition: 'riskAreaStrict',
    messageNovice:
      '🚫 ÁREA DE RISCO — Bloqueado pelo modo Segurança Total. Esta região foi marcada como perigosa. ' +
      'Sua integridade física vale infinitamente mais que qualquer corrida. Ignore e aguarde o próximo ping.',
    messageExperienced: '🚫 Área de risco. Modo estrito ativo.',
    penaltyScore: 100,
    blocksRide: true,
  },
  {
    id: 'hard-dirt-road-night',
    level: 'hard_block',
    condition: 'dirtRoadAtNight',
    messageNovice:
      '🚫 ESTRADA DE TERRA + MADRUGADA = combinação proibida. Sem iluminação, sem sinal, sem socorro. ' +
      'Em caso de acidente ou pane, você estará sozinho. Não existe preço que justifique.',
    messageExperienced: '🚫 Terra + madrugada. Nunca.',
    penaltyScore: 100,
    blocksRide: true,
  },
  {
    id: 'hard-extreme-low-value',
    level: 'hard_block',
    condition: 'extremelyLowValue',
    messageNovice:
      '🚫 CORRIDA PREJUÍZO. O valor está tão baixo que você literalmente pagaria para trabalhar. ' +
      'Considerando combustível + desgaste do veículo, esta corrida dá prejuízo líquido. Rejeite.',
    messageExperienced: '🚫 Prejuízo líquido. Rejeitar.',
    penaltyScore: 100,
    blocksRide: true,
  },

  // ── SOFT WARNINGS ──────────────────────────────────────────────────────────

  {
    id: 'soft-risk-area',
    level: 'soft_warn',
    condition: 'riskAreaSoft',
    messageNovice:
      '⚠️ ÁREA DE RISCO (seu perfil não bloqueia automaticamente). Avalie com cuidado: ' +
      'hora, iluminação, comportamento do passageiro na plataforma. Se tiver dúvida, rejeite.',
    messageExperienced: '⚠️ Área de risco. Avalie.',
    penaltyScore: 35,
    blocksRide: false,
  },
  {
    id: 'soft-dirt-road-day',
    level: 'soft_warn',
    condition: 'dirtRoadDaytime',
    messageNovice:
      '⚠️ ESTRADA DE TERRA (de dia). Risco ao veículo: pedras no cárter, pneus, suspensão. ' +
      'As plataformas NÃO cobrem danos mecânicos. O preço precisa compensar o risco mecânico.',
    messageExperienced: '⚠️ Terra. Verifique se o preço cobre o risco mecânico.',
    penaltyScore: 18,
    blocksRide: false,
  },
  {
    id: 'soft-stops',
    level: 'soft_warn',
    condition: 'ridesWithStops',
    messageNovice:
      '⚠️ CORRIDA COM PARADAS. O passageiro vai parar no meio do caminho. O tempo de espera ' +
      'não é totalmente pago — o R$/hora cai. Só aceite se o R$/km for muito acima da sua meta.',
    messageExperienced: '⚠️ Paradas. R$/hora vai cair.',
    penaltyScore: 15,
    blocksRide: false,
  },
  {
    id: 'soft-tolls',
    level: 'soft_warn',
    condition: 'ridesWithTolls',
    messageNovice:
      '⚠️ PEDÁGIO NA ROTA. Confirme se a plataforma está reembolsando o pedágio nesta corrida. ' +
      'Uber geralmente inclui; 99 varia por cidade. Se não cobrir, deduz do seu lucro real.',
    messageExperienced: '⚠️ Pedágio. Confirme reembolso.',
    penaltyScore: 10,
    blocksRide: false,
  },
  {
    id: 'soft-low-rating',
    level: 'soft_warn',
    condition: 'lowPassengerRating',
    messageNovice:
      '⚠️ PASSAGEIRO COM AVALIAÇÃO BAIXA (< 4.5). Notas baixas sinalizam comportamento ' +
      'problemático confirmado por outros motoristas: grosseria, trajeto suspeito, ' +
      'reclamações injustas. Você tem o direito de cancelar após aceitar se se sentir inseguro.',
    messageExperienced: '⚠️ Passageiro < 4.5. Atenção.',
    penaltyScore: 12,
    blocksRide: false,
  },
  {
    id: 'soft-very-long-pickup',
    level: 'soft_warn',
    condition: 'veryLongPickup',
    messageNovice:
      '⚠️ BUSCA MUITO LONGA (>5km). Você vai gastar combustível e ~15min sem ganhar nada. ' +
      'Só aceite se a corrida for longa o suficiente para compensar — R$/km total precisa ser alto.',
    messageExperienced: '⚠️ Busca >5km. Corrida precisa compensar.',
    penaltyScore: 20,
    blocksRide: false,
  },

  // ── EDUCATIONAL (novato/aprendendo apenas) ─────────────────────────────────

  {
    id: 'edu-pickup-distance',
    level: 'educational',
    condition: 'educPickupDistance',
    messageNovice:
      '📚 DICA — Busca entre 3–5km: o custo real de buscar alguém longe não aparece no ' +
      'preço da corrida. Considere: 4km de busca = ~10min + ~R$1,50 de combustível sem retorno. ' +
      'Com experiência você vai calibrar seu limite de busca pela sua cidade.',
    messageExperienced: '',
    penaltyScore: 0,
    blocksRide: false,
  },
  {
    id: 'edu-min-km-price',
    level: 'educational',
    condition: 'educLowKmPrice',
    messageNovice:
      '📚 DICA — R$/km abaixo de R$2,00: a conta básica de um carro popular (combustível + ' +
      'desgaste + seguro proporcional) custa aproximadamente R$1,20–R$1,60/km. Abaixo de ' +
      'R$2,00/km, o lucro real pode ser zero ou negativo. Esse número vai variar com o seu carro.',
    messageExperienced: '',
    penaltyScore: 0,
    blocksRide: false,
  },
  {
    id: 'edu-rainy-day',
    level: 'educational',
    condition: 'educRainyDay',
    messageNovice:
      '📚 DICA — Dia de chuva: a demanda sobe mas o risco também. Acidentes aumentam, ' +
      'trânsito piora (R$/hora cai), e alguns passageiros ficam mais agressivos no trânsito. ' +
      'Na chuva, priorize corridas curtas e bem pagas — não aceite corrida longa por R$/hora baixo.',
    messageExperienced: '',
    penaltyScore: 0,
    blocksRide: false,
  },
  {
    id: 'edu-night-safety',
    level: 'educational',
    condition: 'educNightFirstTime',
    messageNovice:
      '📚 DICA — Período noturno: o risco aumenta mas o preço também. Regras para sobreviver ' +
      'de noite: (1) evite áreas desertas mesmo com boa corrida, (2) mantenha celular carregado, ' +
      '(3) avise alguém da sua rota, (4) confie no instinto — se algo parecer errado, cancele.',
    messageExperienced: '',
    penaltyScore: 0,
    blocksRide: false,
  },
];

// ─── Evaluation ───────────────────────────────────────────────────────────────

export interface SafetyEvaluation {
  activeRules: SafetyRule[];
  hardBlocked: boolean;
  messages: string[];
  totalPenalty: number;
}

/**
 * Evaluates all safety rules for a given ride and driver context.
 *
 * @param ride           - The incoming ride request
 * @param driverMode     - 'novice' | 'learning' | 'experienced'
 * @param userPreferences - Driver's saved preference flags
 * @param pricePerKm     - Pre-computed price per km for this ride
 * @param vehicleCostPerKm - Estimated vehicle cost (fuel + wear) per km
 */
export function evaluateSafetyRules(
  ride: RideRequest,
  driverMode: DriverMode,
  userPreferences: {
    strictSafetyMode?: boolean;
    avoidDirtRoads?: boolean;
    avoidTolls?: boolean;
    avoidRidesWithStops?: boolean;
  },
  pricePerKm: number,
  vehicleCostPerKm: number = 1.4
): SafetyEvaluation {
  const isNight =
    ride.context.timeOfDay === 'Madrugada' || ride.context.timeOfDay === 'Noite';

  const conditionMap: Record<string, boolean> = {
    riskAreaStrict: ride.isRiskArea && !!userPreferences.strictSafetyMode,
    dirtRoadAtNight: ride.isDirtRoad && isNight,
    extremelyLowValue: pricePerKm < vehicleCostPerKm * 1.1, // <10% above cost = literal loss
    riskAreaSoft: ride.isRiskArea && !userPreferences.strictSafetyMode,
    dirtRoadDaytime: ride.isDirtRoad && !isNight && !!userPreferences.avoidDirtRoads,
    ridesWithStops: ride.hasStops && !!userPreferences.avoidRidesWithStops,
    ridesWithTolls: ride.hasTolls && !!userPreferences.avoidTolls,
    lowPassengerRating: ride.passengerRating < 4.5,
    veryLongPickup: ride.pickupDistance > 5,
    // Educational conditions
    educPickupDistance:
      driverMode !== 'experienced' && ride.pickupDistance >= 3 && ride.pickupDistance <= 5,
    educLowKmPrice: driverMode !== 'experienced' && pricePerKm < 2.0,
    educRainyDay: driverMode !== 'experienced' && ride.context.weather === 'Chovendo',
    educNightFirstTime: driverMode === 'novice' && isNight,
  };

  const activeRules: SafetyRule[] = [];

  for (const rule of SAFETY_RULES) {
    // Skip educational rules for experienced drivers
    if (rule.level === 'educational' && driverMode === 'experienced') continue;

    const conditionMet = conditionMap[rule.condition] ?? false;
    if (!conditionMet) continue;

    activeRules.push(rule);
  }

  const hardBlocked = activeRules.some((r) => r.blocksRide);
  const totalPenalty = activeRules.reduce((sum, r) => sum + r.penaltyScore, 0);
  const messages = activeRules
    .map((r) =>
      driverMode === 'novice' || driverMode === 'learning'
        ? r.messageNovice
        : r.messageExperienced
    )
    .filter(Boolean);

  return { activeRules, hardBlocked, messages, totalPenalty };
}
