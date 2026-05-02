import { useState, useEffect } from 'react';
import {
  X, Car, Fuel, ChevronRight,
  MapPin, CheckCircle2, BrainCircuit, Info,
} from 'lucide-react';
import { useFirebase } from './FirebaseProvider';
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SettingsWizardProps {
  onClose: () => void;
  /** Called after saving — App.tsx uses this to rebuild the brain */
  onSave?: (city: string, driverMode: string) => void;
}

// ─── Static options ───────────────────────────────────────────────────────────

const VEHICLE_SIZES = [
  { id: 'moto',   label: '🏍️ Moto',           costPerKm: 0.35 },
  { id: 'small',  label: '🚗 Compacto/Hatch',  costPerKm: 0.77 },
  { id: 'medium', label: '🚙 Sedan/SUV Médio',  costPerKm: 0.95 },
  { id: 'large',  label: '🚐 SUV/Minivan',      costPerKm: 1.20 },
] as const;

const FUEL_TYPES = [
  { id: 'flex',     label: '⛽ Flex (Etanol/Gasolina)' },
  { id: 'gasoline', label: '🛢️ Gasolina' },
  { id: 'electric', label: '⚡ Elétrico' },
  { id: 'diesel',   label: '🔧 Diesel' },
] as const;

const DRIVER_MODES = [
  {
    id: 'novice',
    label: '🆕 Iniciante',
    sub: 'Menos de 6 meses rodando por app',
    desc: 'O algoritmo começa com dados coletivos da sua cidade e te ensina passo a passo.',
  },
  {
    id: 'learning',
    label: '📈 Intermediário',
    sub: '6 a 18 meses de experiência',
    desc: 'Mistura sua história pessoal com a base coletiva para calibrar melhor.',
  },
  {
    id: 'experienced',
    label: '🏆 Veterano',
    sub: 'Mais de 18 meses rodando',
    desc: 'Thresholds 100% personalizados. Mensagens diretas ao ponto.',
  },
] as const;

const CITY_SUGGESTIONS = [
  'São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Brasília', 'Salvador',
  'Fortaleza', 'Curitiba', 'Manaus', 'Recife', 'Porto Alegre',
  'Goiânia', 'Belém', 'Guarulhos', 'Campinas', 'São Luís',
  'Maceió', 'Natal', 'Campo Grande', 'Teresina', 'João Pessoa',
  'Florianópolis', 'Vitória', 'Ribeirão Preto', 'Uberlândia', 'Sorocaba',
];

// ─── Step 3: Schedule presets ─────────────────────────────────────────────────

const SCHEDULE_PRESETS = [
  {
    id: 'early',
    emoji: '🌅',
    label: 'Madrugador',
    desc: 'Começo cedo, aproveito o movimento matinal',
    hours: '05h – 14h',
    startTime: '05:00',
    endTime: '14:00',
    days: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
  },
  {
    id: 'commercial',
    emoji: '☀️',
    label: 'Horário Comercial',
    desc: 'Manhã e tarde, movimento estável',
    hours: '07h – 19h',
    startTime: '07:00',
    endTime: '19:00',
    days: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
  },
  {
    id: 'fullday',
    emoji: '🔁',
    label: 'Integral',
    desc: 'Dia inteiro, máximo de corridas',
    hours: '07h – 22h',
    startTime: '07:00',
    endTime: '22:00',
    days: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
  },
  {
    id: 'night',
    emoji: '🌙',
    label: 'Noturno',
    desc: 'Tarde e noite, surge price frequente',
    hours: '17h – 01h',
    startTime: '17:00',
    endTime: '01:00',
    days: ['Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
  },
  {
    id: 'latenight',
    emoji: '🌃',
    label: 'Madrugada',
    desc: 'Noite e madrugada, tarifa premium',
    hours: '22h – 06h',
    startTime: '22:00',
    endTime: '06:00',
    days: ['Sex', 'Sáb'],
  },
  {
    id: 'custom',
    emoji: '📅',
    label: 'Personalizado',
    desc: 'Definir meus próprios horários',
    hours: '',
    startTime: '',
    endTime: '',
    days: [] as string[],
  },
] as const;

const ALL_DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// ─── Step 4: Ride preference options ─────────────────────────────────────────

const DIRT_ROAD_OPTIONS = [
  {
    id: 'yes',
    emoji: '✅',
    label: 'Aceito tranquilo',
    sub: 'Estrada de terra faz parte da rotina',
    avoidDirtRoads: false,
  },
  {
    id: 'maybe',
    emoji: '💰',
    label: 'Só se pagar bem',
    sub: 'A IA vai exigir um bônus mínimo',
    avoidDirtRoads: false,
  },
  {
    id: 'never',
    emoji: '❌',
    label: 'Nunca aceito',
    sub: 'Preservo o veículo, zero terra',
    avoidDirtRoads: true,
  },
] as const;

const STOPS_OPTIONS = [
  {
    id: 'yes',
    emoji: '✅',
    label: 'Sem problema',
    sub: 'Aceito paradas no trajeto normalmente',
    avoidStops: false,
  },
  {
    id: 'maybe',
    emoji: '⚠️',
    label: 'Depende do preço',
    sub: 'A IA vai calcular se compensa',
    avoidStops: false,
  },
  {
    id: 'never',
    emoji: '❌',
    label: 'Prefiro sem paradas',
    sub: 'Corrida direta é mais lucrativa',
    avoidStops: true,
  },
] as const;

const TOLLS_OPTIONS = [
  {
    id: 'yes',
    emoji: '✅',
    label: 'Normal, tudo bem',
    sub: 'Pedágio é parte do custo',
    avoidTolls: false,
  },
  {
    id: 'maybe',
    emoji: '💸',
    label: 'Só se compensar',
    sub: 'A IA verifica margem antes de aceitar',
    avoidTolls: false,
  },
  {
    id: 'never',
    emoji: '❌',
    label: 'Evito sempre',
    sub: 'Prefiro rotas sem praça de pedágio',
    avoidTolls: true,
  },
] as const;

// ─── Step 5: Security profiles ────────────────────────────────────────────────

const SECURITY_PROFILES = [
  {
    id: 'max',
    emoji: '🛡️',
    label: 'Máxima Segurança',
    desc: 'Bloqueio automático de áreas de risco + alertas em voz alta. Ideal para quem está começando ou quer segurança total.',
    tags: ['Bloqueia áreas de risco', 'Alertas por voz ativados', 'Revisão manual desligada'],
    color: 'blue',
    strictSafetyMode: true,
    voiceAlerts: true,
    autoReject: false,
  },
  {
    id: 'balanced',
    emoji: '⚖️',
    label: 'Equilibrado',
    desc: 'Alerta sobre riscos mas deixa você decidir. Combina segurança com boas oportunidades de ganho.',
    tags: ['Alertas visuais', 'Você decide cada corrida', 'Análise de risco automática'],
    color: 'green',
    strictSafetyMode: false,
    voiceAlerts: true,
    autoReject: false,
  },
  {
    id: 'local',
    emoji: '🗺️',
    label: 'Conheço minha cidade',
    desc: 'Menos interrupções, máxima autonomia. Para motoristas experientes que conhecem bem onde operam.',
    tags: ['Sem alertas por voz', 'Só bloqueios duros', 'Interface enxuta'],
    color: 'slate',
    strictSafetyMode: false,
    voiceAlerts: false,
    autoReject: false,
  },
] as const;

const GOAL_PRESETS = [150, 200, 300, 400, 500];

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsWizard({ onClose, onSave }: SettingsWizardProps) {
  const { user } = useFirebase();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cityInput, setCityInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Step 1 — Experience + City
  const [driverMode, setDriverMode] = useState<'novice' | 'learning' | 'experienced'>('novice');
  const [city, setCity] = useState('');

  // Step 2 — Vehicle
  const [vehicleSize, setVehicleSize] = useState<string>('small');
  const [fuelType, setFuelType] = useState<string>('flex');

  // Step 3 — Schedule (conversational)
  const [schedulePreset, setSchedulePreset] = useState<string>('fullday');
  const [workDays, setWorkDays] = useState<string[]>(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);
  const [workStartTime, setWorkStartTime] = useState('07:00');
  const [workEndTime, setWorkEndTime] = useState('22:00');

  // Step 4 — Ride preferences (conversational)
  const [dirtRoadPref, setDirtRoadPref] = useState<string>('maybe');
  const [stopsPref, setStopsPref] = useState<string>('maybe');
  const [tollsPref, setTollsPref] = useState<string>('maybe');

  // Step 5 — Security profile (conversational)
  const [securityProfile, setSecurityProfile] = useState<string>('balanced');

  // Step 6 — Daily goal
  const [dailyGoal, setDailyGoal] = useState<number>(300);

  // Derived booleans saved to Firestore
  const avoidDirtRoads      = DIRT_ROAD_OPTIONS.find(o => o.id === dirtRoadPref)?.avoidDirtRoads ?? false;
  const avoidRidesWithStops = STOPS_OPTIONS.find(o => o.id === stopsPref)?.avoidStops ?? false;
  const avoidTolls          = TOLLS_OPTIONS.find(o => o.id === tollsPref)?.avoidTolls ?? false;
  const secProfile          = SECURITY_PROFILES.find(p => p.id === securityProfile) ?? SECURITY_PROFILES[1];
  const strictSafetyMode    = secProfile.strictSafetyMode;
  const voiceAlerts         = secProfile.voiceAlerts;
  const autoReject          = secProfile.autoReject;

  const TOTAL_STEPS = 7;

  // ── Load existing settings ─────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      if (!user) return;
      try {
        const snap = await getDoc(doc(db, `users/${user.uid}`));
        if (snap.exists()) {
          const d = snap.data();
          if (d.driverMode) setDriverMode(d.driverMode);
          if (d.city)       { setCity(d.city); setCityInput(d.city); }
          if (d.vehicleSize) setVehicleSize(d.vehicleSize);
          if (d.fuelType)    setFuelType(d.fuelType);
          if (d.workDays)    setWorkDays(d.workDays);
          if (d.workStartTime) setWorkStartTime(d.workStartTime);
          if (d.workEndTime)   setWorkEndTime(d.workEndTime);
          if (d.dailyGoal)     setDailyGoal(d.dailyGoal);

          // Reverse-map saved booleans → conversational selections
          if (d.avoidDirtRoads === true)      setDirtRoadPref('never');
          if (d.avoidRidesWithStops === true) setStopsPref('never');
          if (d.avoidTolls === true)          setTollsPref('never');

          if (d.strictSafetyMode === true)   setSecurityProfile('max');
          else if (d.voiceAlerts === false)   setSecurityProfile('local');
          else                               setSecurityProfile('balanced');

          // Try to match schedule preset
          setSchedulePreset('custom');
        }
      } catch (e) {
        console.error('Failed to load settings', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  const handleSchedulePreset = (presetId: string) => {
    setSchedulePreset(presetId);
    const preset = SCHEDULE_PRESETS.find(p => p.id === presetId);
    if (preset && presetId !== 'custom') {
      setWorkDays([...preset.days]);
      setWorkStartTime(preset.startTime);
      setWorkEndTime(preset.endTime);
    }
  };

  const toggleDay = (day: string) =>
    setWorkDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );

  const filteredCities = CITY_SUGGESTIONS.filter(c =>
    cityInput.length > 1 && c.toLowerCase().includes(cityInput.toLowerCase())
  );

  const handleCitySelect = (c: string) => {
    setCity(c);
    setCityInput(c);
    setShowSuggestions(false);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const finalCity = city || cityInput;
      await setDoc(doc(db, `users/${user.uid}`), {
        driverMode,
        city:                finalCity,
        vehicleSize,
        fuelType,
        workDays,
        workStartTime,
        workEndTime,
        dailyGoal,
        avoidDirtRoads,
        avoidRidesWithStops,
        avoidTolls,
        strictSafetyMode,
        voiceAlerts,
        autoReject,
        wizardCompleted:     true,
        updatedAt:           serverTimestamp(),
      }, { merge: true });

      onSave?.(finalCity, driverMode);
      onClose();
    } catch (e) {
      console.error('Failed to save settings', e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  // ── Shared helpers ─────────────────────────────────────────────────────────
  const NavBtn = ({
    label, onClick, color = 'blue', disabled = false,
  }: { label: string; onClick: () => void; color?: string; disabled?: boolean }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 py-4 rounded-xl font-black text-white shadow-lg flex justify-center items-center gap-2 transition-all active:scale-95 disabled:opacity-40
        ${color === 'blue'  ? 'bg-[#1a73e8] hover:bg-[#1557b0]' :
          color === 'green' ? 'bg-[#1e8e3e] hover:bg-[#166c30]' :
                              'bg-slate-700 hover:bg-slate-800'}`}
    >
      {label} <ChevronRight className="w-5 h-5" />
    </button>
  );

  const BackBtn = ({ onClick }: { onClick: () => void }) => (
    <button
      onClick={onClick}
      className="px-5 py-4 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
    >
      ← Voltar
    </button>
  );

  // Progress dots
  const ProgressDots = () => (
    <div className="flex gap-2 justify-center mb-8">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full transition-all duration-300
            ${step === i + 1 ? 'w-8 bg-[#1a73e8]'
            : step > i + 1  ? 'w-2 bg-[#1e8e3e]'
                             : 'w-2 bg-slate-200'}`}
        />
      ))}
    </div>
  );

  // Step title map
  const STEP_TITLES: Record<number, string> = {
    1: 'Seu Perfil',
    2: 'Seu Veículo',
    3: 'Quando você trabalha?',
    4: 'O que você aceita?',
    5: 'Sua abordagem de segurança?',
    6: 'Qual sua meta diária?',
    7: 'Tudo Certo! 🎉',
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-md max-h-[92vh] overflow-y-auto flex flex-col shadow-2xl relative">

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 bg-slate-100 rounded-full p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 pb-8">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <BrainCircuit className="w-5 h-5 text-[#1a73e8]" />
            <span className="text-xs font-black text-[#1a73e8] uppercase tracking-widest">PRÉCHECA</span>
          </div>
          <h2 className="text-2xl font-black text-slate-800 mb-6">
            {STEP_TITLES[step]}
          </h2>

          <ProgressDots />

          {/* ── STEP 1: Experience + City ─────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-5">
              <p className="text-sm text-slate-500">
                O algoritmo adapta os thresholds de aceitação ao seu nível de experiência.
              </p>

              <div className="space-y-3">
                {DRIVER_MODES.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setDriverMode(m.id as typeof driverMode)}
                    className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${driverMode === m.id ? 'border-[#1a73e8] bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}
                  >
                    <div className="font-bold text-slate-800">{m.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{m.sub}</div>
                    {driverMode === m.id && (
                      <div className="text-xs text-blue-700 mt-2 bg-blue-100/70 rounded-lg px-3 py-2">
                        {m.desc}
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* City */}
              <div className="relative mt-4">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Sua cidade principal
                </label>
                <input
                  type="text"
                  value={cityInput}
                  onChange={e => { setCityInput(e.target.value); setCity(e.target.value); setShowSuggestions(true); }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder="Ex: São Paulo, Curitiba..."
                  className="w-full bg-slate-100 rounded-xl p-4 font-medium text-slate-800 border-2 border-transparent focus:border-[#1a73e8] outline-none transition-colors"
                />
                {showSuggestions && filteredCities.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white rounded-xl shadow-xl border border-slate-200 z-50 max-h-48 overflow-y-auto mt-1">
                    {filteredCities.map(c => (
                      <button
                        key={c}
                        onMouseDown={() => handleCitySelect(c)}
                        className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-blue-50 hover:text-[#1a73e8] transition-colors font-medium"
                      >
                        <MapPin className="w-3 h-3 inline mr-2 text-slate-400" />{c}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  Usado para buscar estatísticas coletivas da sua cidade.
                </p>
              </div>

              <NavBtn
                label="Próximo"
                onClick={() => setStep(2)}
                disabled={!cityInput.trim()}
                color="blue"
              />
            </div>
          )}

          {/* ── STEP 2: Vehicle ───────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-5">
              <p className="text-sm text-slate-500">
                Usado para calcular o <strong>custo real por km</strong> e evitar corridas com prejuízo.
              </p>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1">
                  <Car className="w-3 h-3" /> Tipo de veículo
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {VEHICLE_SIZES.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setVehicleSize(v.id)}
                      className={`p-4 rounded-2xl border-2 text-left transition-all ${vehicleSize === v.id ? 'border-[#1a73e8] bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}
                    >
                      <div className="font-bold text-slate-800 text-sm">{v.label}</div>
                      <div className="text-xs text-slate-400 mt-1">~R${v.costPerKm.toFixed(2)}/km</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1">
                  <Fuel className="w-3 h-3" /> Combustível
                </label>
                <div className="space-y-2">
                  {FUEL_TYPES.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setFuelType(f.id)}
                      className={`w-full text-left p-3 rounded-xl border-2 font-medium text-sm transition-all ${fuelType === f.id ? 'border-[#1a73e8] bg-blue-50 text-[#1a73e8]' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cost preview */}
              <div className="bg-slate-800 text-white rounded-2xl p-4">
                <div className="text-xs text-slate-400 mb-1">Custo estimado do seu veículo</div>
                <div className="text-2xl font-black text-green-400">
                  R$ {(VEHICLE_SIZES.find(v => v.id === vehicleSize)?.costPerKm ?? 0.77).toFixed(2)}
                  <span className="text-sm font-normal text-slate-400 ml-1">/km</span>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  A IA vai bloquear corridas que pagam menos que isso × 1.1 (margem de segurança).
                </div>
              </div>

              <div className="flex gap-3">
                <BackBtn onClick={() => setStep(1)} />
                <NavBtn label="Próximo" onClick={() => setStep(3)} color="blue" />
              </div>
            </div>
          )}

          {/* ── STEP 3: Schedule (conversational) ────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                O algoritmo prioriza missões e corridas que se encaixam na sua janela de trabalho.
              </p>

              {/* Schedule preset cards */}
              <div className="grid grid-cols-2 gap-3">
                {SCHEDULE_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => handleSchedulePreset(preset.id)}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${
                      schedulePreset === preset.id
                        ? 'border-[#1a73e8] bg-blue-50'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-2xl mb-1">{preset.emoji}</div>
                    <div className="font-black text-slate-800 text-sm">{preset.label}</div>
                    {preset.hours && (
                      <div className="text-xs font-bold text-[#1a73e8] mt-0.5">{preset.hours}</div>
                    )}
                    <div className="text-xs text-slate-500 mt-1 leading-tight">{preset.desc}</div>
                  </button>
                ))}
              </div>

              {/* Show manual controls when 'custom' is selected */}
              {schedulePreset === 'custom' && (
                <div className="space-y-4 pt-2 border-t border-slate-200">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                      Dias de trabalho
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {ALL_DAYS.map(day => (
                        <button
                          key={day}
                          onClick={() => toggleDay(day)}
                          className={`px-3 py-2 rounded-xl text-sm font-bold transition-all ${
                            workDays.includes(day)
                              ? 'bg-[#1a73e8] text-white shadow'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Início</label>
                      <input
                        type="time"
                        value={workStartTime}
                        onChange={e => setWorkStartTime(e.target.value)}
                        className="w-full bg-slate-100 rounded-xl p-4 font-bold text-slate-800 border-2 border-transparent focus:border-[#1a73e8] outline-none"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Fim</label>
                      <input
                        type="time"
                        value={workEndTime}
                        onChange={e => setWorkEndTime(e.target.value)}
                        className="w-full bg-slate-100 rounded-xl p-4 font-bold text-slate-800 border-2 border-transparent focus:border-[#1a73e8] outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Selected summary pill */}
              {schedulePreset !== 'custom' && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 font-medium">
                  📌 {SCHEDULE_PRESETS.find(p => p.id === schedulePreset)?.days.join(', ')} · {workStartTime} até {workEndTime}
                </div>
              )}

              <div className="flex gap-3">
                <BackBtn onClick={() => setStep(2)} />
                <NavBtn label="Próximo" onClick={() => setStep(4)} color="blue" />
              </div>
            </div>
          )}

          {/* ── STEP 4: Ride Preferences (conversational) ────────────────── */}
          {step === 4 && (
            <div className="space-y-6">
              <p className="text-sm text-slate-500">
                Conte o que você aceita nas corridas. A IA vai ajustar seus filtros automaticamente.
              </p>

              {/* Q1: Dirt roads */}
              <div>
                <p className="text-sm font-black text-slate-700 mb-3">
                  🚧 Estradas de terra ou não pavimentadas?
                </p>
                <div className="space-y-2">
                  {DIRT_ROAD_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setDirtRoadPref(opt.id)}
                      className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                        dirtRoadPref === opt.id
                          ? 'border-[#1a73e8] bg-blue-50'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <span className="text-xl shrink-0">{opt.emoji}</span>
                      <div>
                        <div className="font-bold text-slate-800 text-sm">{opt.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{opt.sub}</div>
                      </div>
                      {dirtRoadPref === opt.id && (
                        <div className="ml-auto w-5 h-5 rounded-full bg-[#1a73e8] flex items-center justify-center shrink-0">
                          <div className="w-2 h-2 rounded-full bg-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Q2: Stops */}
              <div>
                <p className="text-sm font-black text-slate-700 mb-3">
                  🛑 Corridas com paradas no trajeto?
                </p>
                <div className="space-y-2">
                  {STOPS_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setStopsPref(opt.id)}
                      className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                        stopsPref === opt.id
                          ? 'border-[#1a73e8] bg-blue-50'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <span className="text-xl shrink-0">{opt.emoji}</span>
                      <div>
                        <div className="font-bold text-slate-800 text-sm">{opt.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{opt.sub}</div>
                      </div>
                      {stopsPref === opt.id && (
                        <div className="ml-auto w-5 h-5 rounded-full bg-[#1a73e8] flex items-center justify-center shrink-0">
                          <div className="w-2 h-2 rounded-full bg-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Q3: Tolls */}
              <div>
                <p className="text-sm font-black text-slate-700 mb-3">
                  🛣️ Corridas que passam por pedágio?
                </p>
                <div className="space-y-2">
                  {TOLLS_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setTollsPref(opt.id)}
                      className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                        tollsPref === opt.id
                          ? 'border-[#1a73e8] bg-blue-50'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <span className="text-xl shrink-0">{opt.emoji}</span>
                      <div>
                        <div className="font-bold text-slate-800 text-sm">{opt.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{opt.sub}</div>
                      </div>
                      {tollsPref === opt.id && (
                        <div className="ml-auto w-5 h-5 rounded-full bg-[#1a73e8] flex items-center justify-center shrink-0">
                          <div className="w-2 h-2 rounded-full bg-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <BackBtn onClick={() => setStep(3)} />
                <NavBtn label="Próximo" onClick={() => setStep(5)} color="blue" />
              </div>
            </div>
          )}

          {/* ── STEP 5: Security Profile (conversational) ────────────────── */}
          {step === 5 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Isso define como a IA te alerta sobre riscos e o quanto ela intervém nas suas decisões.
              </p>

              <div className="space-y-3">
                {SECURITY_PROFILES.map(profile => (
                  <button
                    key={profile.id}
                    onClick={() => setSecurityProfile(profile.id)}
                    className={`w-full text-left p-5 rounded-2xl border-2 transition-all ${
                      securityProfile === profile.id
                        ? profile.color === 'blue'  ? 'border-[#1a73e8] bg-blue-50'
                        : profile.color === 'green' ? 'border-[#1e8e3e] bg-green-50'
                        :                             'border-slate-700 bg-slate-50'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl">{profile.emoji}</span>
                      <div>
                        <div className="font-black text-slate-800">{profile.label}</div>
                      </div>
                      {securityProfile === profile.id && (
                        <div className={`ml-auto w-5 h-5 rounded-full flex items-center justify-center shrink-0
                          ${profile.color === 'blue'  ? 'bg-[#1a73e8]'
                          : profile.color === 'green' ? 'bg-[#1e8e3e]'
                          :                             'bg-slate-700'}`}>
                          <div className="w-2 h-2 rounded-full bg-white" />
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-3">{profile.desc}</p>
                    <div className="flex flex-wrap gap-2">
                      {profile.tags.map(tag => (
                        <span
                          key={tag}
                          className={`text-xs px-2 py-1 rounded-lg font-medium ${
                            securityProfile === profile.id
                              ? profile.color === 'blue'  ? 'bg-blue-100 text-blue-700'
                              : profile.color === 'green' ? 'bg-green-100 text-green-700'
                              :                             'bg-slate-200 text-slate-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3 mt-2">
                <BackBtn onClick={() => setStep(4)} />
                <NavBtn label="Próximo" onClick={() => setStep(6)} color="blue" />
              </div>
            </div>
          )}

          {/* ── STEP 6: Daily Goal ────────────────────────────────────────── */}
          {step === 6 && (
            <div className="space-y-5">
              <p className="text-sm text-slate-500">
                A IA vai priorizar corridas que te aproximam da meta mais rápido. Defina um valor realista para o seu dia.
              </p>

              <div className="flex flex-wrap gap-2">
                {GOAL_PRESETS.map(g => (
                  <button
                    key={g}
                    onClick={() => setDailyGoal(g)}
                    className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${
                      dailyGoal === g
                        ? 'bg-[#1e8e3e] text-white shadow'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    R$ {g}
                  </button>
                ))}
              </div>

              <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-5 text-center focus-within:border-[#1e8e3e] transition-colors">
                <div className="text-slate-400 text-sm font-bold mb-1">Valor personalizado</div>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-2xl font-black text-slate-400">R$</span>
                  <input
                    type="number"
                    min={50}
                    max={2000}
                    value={dailyGoal}
                    onChange={e => setDailyGoal(Number(e.target.value))}
                    className="w-32 bg-transparent text-5xl font-black text-center text-[#1e8e3e] border-none focus:ring-0 outline-none"
                  />
                </div>
              </div>

              {/* Quick insight based on schedule */}
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-sm text-green-800">
                💡 Com {workStartTime}–{workEndTime}, meta de <strong>R$ {dailyGoal}</strong> = ~R$ {
                  (() => {
                    const [sh, sm] = workStartTime.split(':').map(Number);
                    const [eh, em] = workEndTime.split(':').map(Number);
                    let hours = (eh + em / 60) - (sh + sm / 60);
                    if (hours <= 0) hours += 24;
                    return hours > 0 ? (dailyGoal / hours).toFixed(0) : '—';
                  })()
                }/hora para bater a meta.
              </div>

              <div className="flex gap-3">
                <BackBtn onClick={() => setStep(5)} />
                <NavBtn label="Próximo" onClick={() => setStep(7)} color="green" />
              </div>
            </div>
          )}

          {/* ── STEP 7: Summary + Save ────────────────────────────────────── */}
          {step === 7 && (
            <div className="space-y-5">
              {/* Summary grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100">
                  <div className="text-xs text-blue-500 font-bold uppercase mb-1">Perfil</div>
                  <div className="font-black text-slate-800 text-sm">
                    {driverMode === 'novice' ? '🆕 Iniciante'
                      : driverMode === 'learning' ? '📈 Intermediário'
                      : '🏆 Veterano'}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{city || cityInput}</div>
                </div>

                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <div className="text-xs text-slate-500 font-bold uppercase mb-1">Veículo</div>
                  <div className="font-black text-slate-800 text-sm">
                    {VEHICLE_SIZES.find(v => v.id === vehicleSize)?.label}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {FUEL_TYPES.find(f => f.id === fuelType)?.label.split(' ')[1]}
                  </div>
                </div>

                <div className="bg-green-50 rounded-2xl p-4 border border-green-100">
                  <div className="text-xs text-green-600 font-bold uppercase mb-1">Meta</div>
                  <div className="font-black text-[#1e8e3e] text-xl">R$ {dailyGoal}</div>
                  <div className="text-xs text-slate-500 mt-1">por dia de trabalho</div>
                </div>

                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <div className="text-xs text-slate-500 font-bold uppercase mb-1">Horário</div>
                  <div className="font-black text-slate-800 text-sm">
                    {SCHEDULE_PRESETS.find(p => p.id === schedulePreset)?.emoji ?? '📅'}{' '}
                    {workStartTime} – {workEndTime}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {workDays.length} dias/semana
                  </div>
                </div>

                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 col-span-2">
                  <div className="text-xs text-slate-500 font-bold uppercase mb-2">Filtros & Segurança</div>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-600 font-medium">
                      {SECURITY_PROFILES.find(p => p.id === securityProfile)?.emoji} {SECURITY_PROFILES.find(p => p.id === securityProfile)?.label}
                    </span>
                    {avoidDirtRoads && (
                      <span className="text-xs px-2 py-1 rounded-lg bg-orange-100 text-orange-700 font-medium">
                        🚧 Sem terra
                      </span>
                    )}
                    {avoidRidesWithStops && (
                      <span className="text-xs px-2 py-1 rounded-lg bg-orange-100 text-orange-700 font-medium">
                        🛑 Sem paradas
                      </span>
                    )}
                    {avoidTolls && (
                      <span className="text-xs px-2 py-1 rounded-lg bg-orange-100 text-orange-700 font-medium">
                        🛣️ Sem pedágio
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Brain info */}
              <div className="bg-gradient-to-br from-[#1a73e8] to-[#1557b0] rounded-2xl p-5 text-white">
                <div className="flex items-center gap-2 mb-2">
                  <BrainCircuit className="w-5 h-5" />
                  <span className="font-black text-sm">Como o Algoritmo vai Aprender</span>
                </div>
                <p className="text-sm text-blue-100 leading-relaxed">
                  {driverMode === 'novice'
                    ? 'Você começa com a base coletiva de motoristas da sua cidade. A cada corrida avaliada, o algoritmo se personaliza para o seu perfil.'
                    : driverMode === 'learning'
                    ? 'Seus dados pessoais são mesclados com a base coletiva. Com 50+ corridas avaliadas, o algoritmo passa a usar exclusivamente seu histórico.'
                    : 'Thresholds 100% baseados no seu histórico pessoal. A cada corrida aceita/rejeitada, a IA recalibra em tempo real.'}
                </p>
              </div>

              {/* Android note */}
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex gap-3">
                <Info className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-orange-800 text-sm">App Android em breve</div>
                  <div className="text-xs text-orange-700 mt-1">
                    Para leitura automática de corridas da Uber/99, baixe o app nativo Android quando disponível. Agora, use o botão "Simular" para treinar o algoritmo.
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-2">
                <BackBtn onClick={() => setStep(6)} />
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-[#1e8e3e] hover:bg-[#166c30] disabled:opacity-60 text-white font-black py-4 rounded-xl shadow-lg flex justify-center items-center gap-2 transition-all active:scale-95"
                >
                  {saving ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      Começar a Usar!
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
