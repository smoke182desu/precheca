/**
 * cityKnowledge.ts — Inteligência de Cidade para o PRÉCHECA
 *
 * Este módulo provê o conhecimento institucional que o app carrega desde o dia 1,
 * ANTES de qualquer dado de usuário existir. É o "currículo base" do copiloto.
 *
 * Fontes de conhecimento codificadas:
 *  • Feriados nacionais e pontos facultativos brasileiros
 *  • Padrões de demanda por tipo de bairro (residencial, comercial, universitário, etc.)
 *  • Eventos recorrentes que impactam preço (shows, jogos, feiras, formaturas)
 *  • Multiplicadores de demanda por hora × tipo de dia × tipo de bairro
 *  • Custo operacional estimado por categoria de veículo
 *  • Insights de tempo de espera por contexto
 *
 * Tudo aqui é agnóstico de cidade — funciona em qualquer cidade brasileira.
 * Os dados coletivos de motoristas (city_stats) vão gradualmente sobrescrever
 * e refinar estes padrões com dados reais.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type NeighborhoodType =
  | 'comercial_central'   // CBD, centros financeiros
  | 'comercial_secundario'// bairros comerciais fora do centro
  | 'residencial_alto'    // alto padrão, casas/condomínios
  | 'residencial_medio'   // classe média, apartamentos
  | 'residencial_popular' // periferia, conjuntos
  | 'universitario'       // campus, repúblicas, bares estudantis
  | 'hospitalar'          // hospitais, clínicas
  | 'industrial'          // fábricas, galpões
  | 'lazer_noturno'       // bares, baladas, restaurantes
  | 'aeroporto_rodoviaria'// terminais de transporte
  | 'shopping'            // shoppings e entorno
  | 'desconhecido';

export type DayCategory =
  | 'dia_util'
  | 'vespera_feriado'
  | 'feriado'
  | 'pos_feriado'
  | 'sexta'
  | 'sabado'
  | 'domingo'
  | 'carnaval'
  | 'reveillon'
  | 'copa_jogo'; // dias de jogo da seleção

export type DemandSignal = {
  multiplier: number;     // 1.0 = normal. 1.5 = 50% mais demanda. 0.7 = 30% menos.
  waitTimeAdjustment: number; // minutos adicionados/subtraídos ao tempo de espera estimado
  insight: string;        // frase para mostrar ao motorista
};

// ─── Brazilian National Holidays ──────────────────────────────────────────────

export interface HolidayEntry {
  name: string;
  type: 'nacional' | 'estadual_sp' | 'estadual_rj' | 'municipal_sp' | 'municipal_rj' | 'ponto_facultativo';
  demandMultiplier: number;       // impacto na demanda de transporte
  advanceDemandMultiplier: number; // véspera do feriado (geralmente mais corridas)
  notes: string;
}

/** Returns holiday entries for the current year. */
export function getBrazilianHolidays(year: number): Array<HolidayEntry & { date: Date }> {
  // Easter-based holidays (móveis)
  const easter = computeEaster(year);
  const addDays = (d: Date, n: number) => {
    const r = new Date(d); r.setDate(r.getDate() + n); return r;
  };

  const fixed: Array<{ month: number; day: number } & HolidayEntry> = [
    { month: 1, day: 1,  name: 'Ano Novo',              type: 'nacional',          demandMultiplier: 0.4, advanceDemandMultiplier: 2.5, notes: 'Madrugada de 31/12 = pico máximo do ano. Dia 1 = morto.' },
    { month: 1, day: 20, name: 'São Sebastião (RJ)',     type: 'estadual_rj',       demandMultiplier: 1.3, advanceDemandMultiplier: 1.1, notes: 'Feriado municipal RJ' },
    { month: 2, day: 9,  name: 'Carnaval Domingo',       type: 'ponto_facultativo', demandMultiplier: 1.8, advanceDemandMultiplier: 1.5, notes: 'Pico noturno. Muita gente indo pra bloco.' },
    { month: 2, day: 10, name: 'Carnaval Segunda',       type: 'ponto_facultativo', demandMultiplier: 1.9, advanceDemandMultiplier: 1.8, notes: 'Maior pico de Carnaval — segunda-feira.' },
    { month: 2, day: 11, name: 'Carnaval Terça',         type: 'ponto_facultativo', demandMultiplier: 2.0, advanceDemandMultiplier: 1.9, notes: 'Último dia de Carnaval — demanda explosiva.' },
    { month: 4, day: 21, name: 'Tiradentes',             type: 'nacional',          demandMultiplier: 1.2, advanceDemandMultiplier: 1.4, notes: 'Feriado prolongado se cai perto do fim de semana.' },
    { month: 5, day: 1,  name: 'Dia do Trabalhador',     type: 'nacional',          demandMultiplier: 1.1, advanceDemandMultiplier: 1.3, notes: 'Eventos sindicais, passeatas, shows.' },
    { month: 6, day: 12, name: 'Dia dos Namorados',      type: 'ponto_facultativo', demandMultiplier: 1.6, advanceDemandMultiplier: 1.2, notes: 'Pico noturno — casais indo e voltando de restaurantes.' },
    { month: 7, day: 9,  name: 'Revolução Constitucionalista (SP)', type: 'estadual_sp', demandMultiplier: 1.1, advanceDemandMultiplier: 1.1, notes: 'SP only' },
    { month: 9, day: 7,  name: 'Independência do Brasil', type: 'nacional',         demandMultiplier: 1.1, advanceDemandMultiplier: 1.3, notes: 'Desfiles, eventos patrióticos.' },
    { month: 10, day: 12, name: 'Nossa Sra. Aparecida',  type: 'nacional',          demandMultiplier: 1.0, advanceDemandMultiplier: 1.2, notes: 'Normal. Véspera pode ter movimento religioso.' },
    { month: 10, day: 28, name: 'Dia do Servidor',       type: 'ponto_facultativo', demandMultiplier: 0.9, advanceDemandMultiplier: 1.0, notes: 'Setor público. Pouco impacto geral.' },
    { month: 11, day: 2,  name: 'Finados',               type: 'nacional',          demandMultiplier: 0.9, advanceDemandMultiplier: 1.1, notes: 'Visitas a cemitérios nas manhãs.' },
    { month: 11, day: 15, name: 'Proclamação da República', type: 'nacional',       demandMultiplier: 1.0, advanceDemandMultiplier: 1.1, notes: 'Neutro na maioria das cidades.' },
    { month: 11, day: 20, name: 'Consciência Negra',     type: 'nacional',          demandMultiplier: 1.1, advanceDemandMultiplier: 1.2, notes: 'Eventos culturais, shows. Noite movimentada.' },
    { month: 12, day: 24, name: 'Véspera de Natal',      type: 'ponto_facultativo', demandMultiplier: 1.8, advanceDemandMultiplier: 1.2, notes: 'Maior movimento do segundo semestre — compras + reuniões de família.' },
    { month: 12, day: 25, name: 'Natal',                 type: 'nacional',          demandMultiplier: 0.5, advanceDemandMultiplier: 1.8, notes: 'Dia 25: quase parado. Véspera é explosiva.' },
    { month: 12, day: 31, name: 'Véspera de Ano Novo',   type: 'ponto_facultativo', demandMultiplier: 2.8, advanceDemandMultiplier: 1.5, notes: 'Maior pico do ano na virada. Madrugada de 1/1 = colheita.' },
  ];

  // Mobile holidays (calculated from Easter)
  const mobile: Array<HolidayEntry & { date: Date }> = [
    { date: addDays(easter, -48), name: 'Segunda de Carnaval',  type: 'ponto_facultativo', demandMultiplier: 1.9, advanceDemandMultiplier: 1.8, notes: 'Alta demanda noturna' },
    { date: addDays(easter, -47), name: 'Terça de Carnaval',    type: 'ponto_facultativo', demandMultiplier: 2.0, advanceDemandMultiplier: 1.9, notes: 'Pico máximo de Carnaval' },
    { date: addDays(easter, -46), name: 'Quarta de Cinzas',     type: 'ponto_facultativo', demandMultiplier: 1.2, advanceDemandMultiplier: 2.0, notes: 'Noite de terça ainda movimentada' },
    { date: addDays(easter, -2),  name: 'Sexta-feira Santa',    type: 'nacional',          demandMultiplier: 0.7, advanceDemandMultiplier: 1.3, notes: 'Muita gente viaja quinta à noite' },
    { date: easter,               name: 'Páscoa',               type: 'nacional',          demandMultiplier: 0.6, advanceDemandMultiplier: 0.7, notes: 'Cidade esvaziada. Véspera de sábado tem movimento.' },
    { date: addDays(easter, 1),   name: 'Segunda de Páscoa',    type: 'ponto_facultativo', demandMultiplier: 0.7, advanceDemandMultiplier: 0.8, notes: 'Retorno de viagens — pode ter movimento no fim do dia' },
    { date: addDays(easter, 60),  name: 'Corpus Christi',       type: 'nacional',          demandMultiplier: 1.1, advanceDemandMultiplier: 1.3, notes: 'Geralmente cria feriado prolongado (quinta→domingo)' },
  ];

  const result: Array<HolidayEntry & { date: Date }> = [...mobile];
  for (const h of fixed) {
    result.push({ ...h, date: new Date(year, h.month - 1, h.day) });
  }
  return result.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Gauss / Anonymous Gregorian Easter algorithm. */
function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// ─── Holiday Lookup ───────────────────────────────────────────────────────────

const _holidayCache: Record<number, Array<HolidayEntry & { date: Date }>> = {};

function getHolidaysForYear(year: number) {
  if (!_holidayCache[year]) _holidayCache[year] = getBrazilianHolidays(year);
  return _holidayCache[year];
}

/**
 * Check if a date is a holiday or special day.
 * Returns null if it's a normal day.
 */
export function getHolidayContext(date: Date): (HolidayEntry & { isEve: boolean }) | null {
  const year = date.getFullYear();
  const holidays = getHolidaysForYear(year);

  // Exact match
  for (const h of holidays) {
    if (
      h.date.getDate() === date.getDate() &&
      h.date.getMonth() === date.getMonth()
    ) {
      return { ...h, isEve: false };
    }
  }

  // Check if tomorrow is a holiday (véspera = high advance demand)
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  for (const h of holidays) {
    if (
      h.date.getDate() === tomorrow.getDate() &&
      h.date.getMonth() === tomorrow.getMonth()
    ) {
      // Return the holiday info but mark as eve
      return { ...h, isEve: true };
    }
  }

  return null;
}

// ─── Neighborhood Type Classification ────────────────────────────────────────

/**
 * Very rough classification from a neighborhood/area name.
 * In production this would be backed by a DB of city areas.
 * Here we use keyword matching as a best-effort approximation.
 */
export function classifyNeighborhoodType(neighborhood: string): NeighborhoodType {
  const n = neighborhood.toLowerCase();

  if (/aeroporto|rodoviária|terminal|estação central/.test(n)) return 'aeroporto_rodoviaria';
  if (/shopping|mall|center|plaza|parque d/.test(n)) return 'shopping';
  if (/hospital|clínica|upa|pronto.socorro|unimed|einstein|sírio|hcor/.test(n)) return 'hospitalar';
  if (/universidade|usp|unicamp|unesp|puc|mackenzie|fgv|insper|republica|campus/.test(n)) return 'universitario';
  if (/industrial|distrito|galpão|fábrica|pólo/.test(n)) return 'industrial';
  if (/bela vista|consolação|paulista|faria lima|itaim|berrini|pinheiros|centro|brooklin|vila olímpia|leblon|ipanema|botafogo|flamengo|lapa|barra funda/.test(n)) return 'comercial_central';
  if (/vila|jardim|lapa|santana|tatuapé|mooca|perdizes|campo belo|moema|higienópolis/.test(n)) return 'comercial_secundario';
  if (/morumbi|alphaville|granja|condomínio|alto|chácara/.test(n)) return 'residencial_alto';
  if (/vila\s+\w+|jardim\s+\w+|bairro\s+\w+/.test(n)) return 'residencial_medio';
  if (/favela|comunidade|morro|conjunto|cohab|periferia|extremo/.test(n)) return 'residencial_popular';
  if (/bar|balaio|boteco|pub|balada|clube|noturno/.test(n)) return 'lazer_noturno';

  return 'desconhecido';
}

// ─── Demand Multiplier by Neighborhood Type × Hour × Day ──────────────────────

/**
 * Returns a demand multiplier and insight for a given context.
 * This is the core "market intelligence" layer — tells the driver
 * how strong demand is expected to be right now in this type of area.
 *
 * Multiplier > 1 = more rides available, possibly higher prices
 * Multiplier < 1 = low demand — consider repositioning
 */
export function getDemandSignal(
  neighborhoodType: NeighborhoodType,
  hour: number,
  dayCategory: DayCategory,
  weather: 'Limpo' | 'Chovendo' | 'Nublado'
): DemandSignal {
  let multiplier = 1.0;
  let waitAdjustment = 0;
  const insights: string[] = [];

  // ── Base pattern by neighborhood type × hour ──────────────────────────────

  const patterns: Record<NeighborhoodType, (h: number, d: DayCategory) => number> = {
    comercial_central: (h, d) => {
      if (d === 'dia_util') {
        if (h >= 7 && h < 10) return 1.8;  // entrada do trabalho
        if (h >= 12 && h < 14) return 1.4; // almoço
        if (h >= 17 && h < 20) return 2.0; // saída — pico absoluto
        if (h >= 20 && h < 23) return 1.2;
        return 0.5;
      }
      if (d === 'sexta') {
        if (h >= 17 && h < 21) return 2.2; // saída de sexta = máximo do centro
        if (h >= 21 && h < 24) return 1.5;
        return 0.8;
      }
      if (d === 'sabado' || d === 'domingo') {
        if (h >= 10 && h < 18) return 0.8;
        return 0.3;
      }
      return 1.0;
    },

    comercial_secundario: (h, d) => {
      if (d === 'dia_util' || d === 'sexta') {
        if (h >= 8 && h < 10) return 1.5;
        if (h >= 17 && h < 20) return 1.7;
        if (h >= 12 && h < 14) return 1.3;
        return 0.8;
      }
      if (d === 'sabado') {
        if (h >= 10 && h < 19) return 1.4; // comércio aberto
        return 0.6;
      }
      return 0.5;
    },

    residencial_alto: (h, d) => {
      // Demanda existe mas é irregular — corridas longas e bem pagas
      if (h >= 7 && h < 9) return 1.3;
      if (h >= 18 && h < 21) return 1.4;
      if (d === 'sexta' || d === 'sabado') {
        if (h >= 20 && h < 24) return 1.6; // saindo para jantar/show
        if (h >= 0 && h < 3) return 1.8;   // voltando
      }
      return 0.7;
    },

    residencial_medio: (h, d) => {
      if (h >= 6 && h < 9) return 1.5;     // saída pro trabalho
      if (h >= 17 && h < 20) return 1.4;   // retorno
      if (d === 'sabado' && h >= 9 && h < 17) return 1.2;
      return 0.7;
    },

    residencial_popular: (h, d) => {
      if (h >= 5 && h < 8) return 1.6;     // operários/prestadores — cedo
      if (h >= 17 && h < 19) return 1.3;
      return 0.5;                           // demanda baixa o resto do tempo
    },

    universitario: (h, d) => {
      if (d === 'dia_util' || d === 'sexta') {
        if (h >= 7 && h < 9) return 1.5;
        if (h >= 12 && h < 14) return 1.3;
        if (h >= 17 && h < 19) return 1.5;
      }
      if (d === 'sexta' || d === 'sabado') {
        if (h >= 21 && h < 24) return 1.9; // baladas estudantis
        if (h >= 0 && h < 4) return 1.7;
      }
      return 0.8;
    },

    hospitalar: (h, _d) => {
      // Constante — emergências não têm horário
      if (h >= 6 && h < 10) return 1.4;    // consultas matutinas
      if (h >= 11 && h < 14) return 1.2;
      if (h >= 16 && h < 19) return 1.5;   // alta de internados
      return 1.0;
    },

    industrial: (h, d) => {
      if (d !== 'dia_util' && d !== 'sexta') return 0.3;
      if (h >= 5 && h < 7) return 1.8;     // turno da manhã
      if (h >= 13 && h < 15) return 1.4;   // troca de turno
      if (h >= 21 && h < 23) return 1.6;   // turno da noite
      return 0.4;
    },

    lazer_noturno: (h, d) => {
      if (h >= 20 && h < 24) {
        if (d === 'sexta' || d === 'sabado') return 2.2;
        if (d === 'dia_util') return 1.3;
      }
      if (h >= 0 && h < 4) {
        if (d === 'sexta' || d === 'sabado' || d === 'domingo') return 2.4;
        return 1.1;
      }
      if (h >= 4 && h < 7) return 0.4; // entre madrugada e manhã
      return 0.3;
    },

    aeroporto_rodoviaria: (_h, d) => {
      // Relativamente constante mas com picos nas chegadas/partidas
      const base = 1.4;
      if (d === 'sexta') return base + 0.4; // viagens de fim de semana
      if (d === 'domingo') return base + 0.3; // retorno
      if (d === 'vespera_feriado' || d === 'feriado') return base + 0.6;
      return base;
    },

    shopping: (h, d) => {
      if (h >= 10 && h < 22) {
        if (d === 'sabado' || d === 'domingo') return 1.7;
        if (d === 'dia_util') return 1.2;
        if (d === 'sexta') return 1.5;
      }
      return 0.4;
    },

    desconhecido: (_h, _d) => 1.0,
  };

  multiplier = patterns[neighborhoodType](hour, dayCategory);

  // ── Day category adjustments ──────────────────────────────────────────────

  if (dayCategory === 'vespera_feriado') {
    multiplier *= 1.3;
    insights.push('Véspera de feriado: demanda alta para viagens e saídas noturnas');
  } else if (dayCategory === 'feriado') {
    multiplier *= 0.85;
    insights.push('Feriado: menos fluxo durante o dia, mas noite pode ser ativa');
  } else if (dayCategory === 'carnaval') {
    multiplier *= 2.1;
    insights.push('Carnaval: pico histórico de demanda. Evite áreas de bloco sem saída');
  } else if (dayCategory === 'reveillon') {
    multiplier *= 3.0;
    insights.push('Réveillon: maior pico do ano. Concentre na madrugada de 31/12→01/01');
  } else if (dayCategory === 'copa_jogo') {
    const isGameTime = hour >= 16 && hour < 23;
    if (isGameTime) {
      multiplier *= 0.3;
      insights.push('Jogo da Seleção: cidade para. Evite trabalhar durante o jogo. Depois do jogo = pico.');
    } else if (hour >= 22 && hour < 24) {
      multiplier *= 2.5;
      insights.push('Pós-jogo: toda a cidade se movendo ao mesmo tempo');
    }
  }

  // ── Weather adjustments ───────────────────────────────────────────────────

  if (weather === 'Chovendo') {
    multiplier *= 1.45;
    waitAdjustment -= 3; // pings chegam mais rápido
    insights.push('Chuva: demanda sobe ~45%. Aceite corridas mais curtas e bem pagas.');
  } else if (weather === 'Nublado') {
    multiplier *= 1.1;
    insights.push('Nublado: leve aumento de demanda — pessoas preferem não andar na rua');
  }

  // ── Build insight text ────────────────────────────────────────────────────

  let insight = '';
  if (multiplier >= 2.0) {
    insight = `🔥 Demanda muito alta agora (${Math.round(multiplier * 100)}% do normal). ${insights.join('. ')}`;
  } else if (multiplier >= 1.4) {
    insight = `📈 Demanda acima do normal (${Math.round(multiplier * 100)}%). ${insights.join('. ')}`;
  } else if (multiplier >= 0.9) {
    insight = insights.length > 0 ? insights.join('. ') : '';
  } else {
    insight = `📉 Demanda baixa (${Math.round(multiplier * 100)}%). Considere reposicionar. ${insights.join('. ')}`;
  }

  return {
    multiplier: Math.max(0.2, Math.min(3.5, multiplier)),
    waitTimeAdjustment: Math.max(-5, Math.min(15, waitAdjustment)),
    insight: insight.trim(),
  };
}

// ─── Vehicle Operating Cost ───────────────────────────────────────────────────

export interface VehicleCostProfile {
  costPerKm: number;     // R$ por km (combustível + desgaste)
  costPerHour: number;   // R$ por hora (custo de oportunidade do tempo)
  breakEvenKm: number;   // R$/km mínimo para não ter prejuízo
  breakEvenHour: number; // R$/h mínimo para não ter prejuízo
}

/**
 * Returns estimated operating costs by vehicle size and fuel type.
 * These are conservative estimates based on Brazilian DENATRAN/FIPE averages.
 * The driver should calibrate these in settings when possible.
 */
export function getVehicleCostProfile(
  vehicleSize: 'small' | 'medium' | 'large' | 'suv',
  fuelType: 'flex' | 'gasolina' | 'etanol' | 'eletrico' | 'hibrido' = 'flex'
): VehicleCostProfile {
  // Base costs per km (R$) at ~2025 prices
  const fuelCostPerKm: Record<typeof vehicleSize, Record<typeof fuelType, number>> = {
    small:  { flex: 0.52, gasolina: 0.65, etanol: 0.42, eletrico: 0.12, hibrido: 0.38 },
    medium: { flex: 0.62, gasolina: 0.78, etanol: 0.50, eletrico: 0.15, hibrido: 0.45 },
    large:  { flex: 0.75, gasolina: 0.95, etanol: 0.60, eletrico: 0.18, hibrido: 0.55 },
    suv:    { flex: 0.85, gasolina: 1.10, etanol: 0.68, eletrico: 0.20, hibrido: 0.62 },
  };

  // Wear & depreciation per km (tires, oil, maintenance, depreciation)
  const wearPerKm: Record<typeof vehicleSize, number> = {
    small: 0.25, medium: 0.30, large: 0.38, suv: 0.45,
  };

  const fuel = fuelCostPerKm[vehicleSize][fuelType];
  const wear = wearPerKm[vehicleSize];
  const costPerKm = fuel + wear;

  // Time cost: assuming driver targets ~R$50/h net, overhead per hour
  const costPerHour = 8.0; // fixed overhead per working hour (app subscription, phone plan share, etc.)

  return {
    costPerKm,
    costPerHour,
    breakEvenKm: costPerKm * 1.05,      // 5% above cost = break-even
    breakEvenHour: costPerHour + 30.0,  // minimum R$38/h to cover fixed + variable
  };
}

// ─── Contextual Opportunity Cost ─────────────────────────────────────────────

/**
 * Given where the ride ends (dropoff neighborhood type), how good is that
 * location for the next ride? Returns a score 0–1 (1 = great next location).
 * Used to factor in the "value of where the ride leaves you."
 */
export function getDropoffLocationValue(
  dropoffType: NeighborhoodType,
  currentHour: number,
  dayCategory: DayCategory
): number {
  const signal = getDemandSignal(dropoffType, currentHour, dayCategory, 'Limpo');
  // Normalize multiplier to 0–1 range (0 at 0.2, 1 at 2.5+)
  return Math.min(1, Math.max(0, (signal.multiplier - 0.2) / 2.3));
}

// ─── Day Category Classifier ──────────────────────────────────────────────────

/**
 * Classify a date as a DayCategory, factoring in Brazilian holidays.
 */
export function classifyDayCategory(date: Date): DayCategory {
  const dow = date.getDay(); // 0=Sun
  const holidayCtx = getHolidayContext(date);

  if (holidayCtx && !holidayCtx.isEve) {
    // Check for special categories
    const name = holidayCtx.name.toLowerCase();
    if (name.includes('carnaval') || name.includes('terça') || name.includes('segunda de')) return 'carnaval';
    if (name.includes('ano novo') || name.includes('réveillon') || name.includes('véspera de ano')) return 'reveillon';
    return 'feriado';
  }

  if (holidayCtx?.isEve) return 'vespera_feriado';

  if (dow === 0) return 'domingo';
  if (dow === 6) return 'sabado';
  if (dow === 5) return 'sexta';
  return 'dia_util';
}

// ─── Complete Context Demand Score ───────────────────────────────────────────

export interface ContextualDemandScore {
  demandMultiplier: number;
  dropoffValue: number;       // 0–1: how good is where the ride drops you
  contextInsights: string[];  // list of insights to show the driver
  holidayName?: string;       // name of the holiday if today is one
  isHoliday: boolean;
  isEve: boolean;
}

/**
 * Master function: returns all contextual demand intelligence for a ride.
 */
export function getContextualDemandScore(
  pickupNeighborhood: string,
  dropoffNeighborhood: string,
  date: Date,
  weather: 'Limpo' | 'Chovendo' | 'Nublado'
): ContextualDemandScore {
  const hour = date.getHours();
  const pickupType = classifyNeighborhoodType(pickupNeighborhood);
  const dropoffType = classifyNeighborhoodType(dropoffNeighborhood);
  const dayCategory = classifyDayCategory(date);
  const holidayCtx = getHolidayContext(date);

  const demandSignal = getDemandSignal(pickupType, hour, dayCategory, weather);
  const dropoffVal = getDropoffLocationValue(dropoffType, hour + 1, dayCategory); // +1h for ride duration

  const contextInsights: string[] = [];
  if (demandSignal.insight) contextInsights.push(demandSignal.insight);
  if (holidayCtx) {
    const label = holidayCtx.isEve ? `Véspera de ${holidayCtx.name}` : holidayCtx.name;
    contextInsights.push(`📅 ${label}: ${holidayCtx.notes}`);
  }
  if (dropoffVal < 0.3) {
    contextInsights.push(`⚠️ Destino em área de baixa demanda — espere mais tempo pelo próximo ping`);
  } else if (dropoffVal > 0.75) {
    contextInsights.push(`✅ Destino em área de alta demanda — boa probabilidade de ping rápido`);
  }

  return {
    demandMultiplier: demandSignal.multiplier,
    dropoffValue: dropoffVal,
    contextInsights,
    holidayName: holidayCtx?.name,
    isHoliday: !!holidayCtx && !holidayCtx.isEve,
    isEve: !!holidayCtx?.isEve,
  };
}
