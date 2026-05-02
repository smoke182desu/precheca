/**
 * RideInputModal.tsx — Analisador de Corrida Real
 *
 * Três modos:
 *  1. 📸 PRINT — motorista manda print da tela do Uber/99
 *     → Gemini lê o print → extrai dados → análise automática + som
 *
 *  2. ✏️ MANUAL — preenche os campos (preço, km, destino)
 *     → análise instantânea + som
 *
 *  3. 🔔 NOTIFICAÇÃO — (APK) Capacitor injeta dados direto
 *     → análise automática sem toque + som
 *
 * O motorista NÃO precisa digitar nada no modo Print.
 * Basta tirar screenshot do Uber, abrir o PRÉCHECA e selecionar a imagem.
 */

import { useState, useCallback, useRef } from 'react';
import {
  X, Camera, Pencil, BrainCircuit, Zap,
  CheckCircle2, XCircle, AlertTriangle,
  ChevronRight, Loader2, Image,
} from 'lucide-react';

import { analyzeRide, UserPreferences } from '../lib/analyzer';
import { extractRideFromImage, ExtractedRideData } from '../lib/rideOcr';
import { playAcceptSound, playRejectSound } from '../lib/audio';
import {
  DriverProfile, VehicleCategory, PersonalBrainState,
  RideRequest, RideAnalysisV2,
} from '../types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface RideInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAnalysisDone: (analysis: RideAnalysisV2, ride: RideRequest) => void;
  activeProfile: DriverProfile;
  activeCategory: VehicleCategory;
  userPreferences: UserPreferences;
  brainState?: PersonalBrainState;
  uid?: string;
  currentNeighborhood: string;
  currentWeather?: 'Limpo' | 'Chovendo' | 'Nublado';
}

// ─── Quick-pick presets ────────────────────────────────────────────────────────

const PICKUP_PRESETS = [0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0];
const RIDE_PRESETS   = [3, 5, 8, 10, 12, 15, 20, 25, 30, 40];

// ─── Analysis runner ──────────────────────────────────────────────────────────

function runAnalysis(
  opts: {
    totalPrice: number;
    pickupDistance: number;
    rideDistance: number;
    destination: string;
    passengerRating: number;
    platform: 'Uber' | '99';
    hasTolls: boolean;
    hasStops: boolean;
    isRiskArea: boolean;
    currentNeighborhood: string;
    currentWeather: 'Limpo' | 'Chovendo' | 'Nublado';
    activeProfile: DriverProfile;
    activeCategory: VehicleCategory;
    userPreferences: UserPreferences;
    brainState?: PersonalBrainState;
    uid?: string;
  }
): { analysis: RideAnalysisV2; ride: RideRequest } {
  const now = new Date();
  const hours = now.getHours();

  let timeOfDay: 'Manhã' | 'Tarde' | 'Noite' | 'Madrugada' = 'Tarde';
  if (hours >= 5  && hours < 12) timeOfDay = 'Manhã';
  if (hours >= 18 && hours < 23) timeOfDay = 'Noite';
  if (hours >= 23 || hours < 5)  timeOfDay = 'Madrugada';

  const days = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

  const pickupTimeMin = Math.max(1, Math.round(opts.pickupDistance / 25 * 60));
  const rideTimeMin   = Math.max(2, Math.round(opts.rideDistance   / 30 * 60));

  const ride: RideRequest = {
    id:               `real-${Date.now()}`,
    platform:          opts.platform,
    passengerRating:   opts.passengerRating,
    passengerName:    'Passageiro',
    pickupDistance:    opts.pickupDistance,
    pickupTimeMin,
    rideDistance:      opts.rideDistance,
    rideTimeMin,
    totalPrice:        opts.totalPrice,
    pickupLocation:    opts.currentNeighborhood,
    dropoffLocation:   opts.destination || 'Destino informado',
    isRiskArea:        opts.isRiskArea,
    hasStops:          opts.hasStops,
    isDirtRoad:        false,
    hasTolls:          opts.hasTolls,
    context: {
      dayOfWeek:           days[now.getDay()],
      timeOfDay,
      exactTime:           `${String(hours).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
      weather:             opts.currentWeather,
      pickupNeighborhood:  opts.currentNeighborhood,
    },
  };

  const analysis = analyzeRide(
    ride,
    opts.activeProfile,
    opts.activeCategory.multiplier,
    opts.userPreferences,
    opts.brainState,
    opts.uid
  );

  return { analysis, ride };
}

// ─── Component ────────────────────────────────────────────────────────────────

type Mode = 'choose' | 'ocr-loading' | 'ocr-confirm' | 'manual' | 'result';

export function RideInputModal({
  isOpen,
  onClose,
  onAnalysisDone,
  activeProfile,
  activeCategory,
  userPreferences,
  brainState,
  uid,
  currentNeighborhood,
  currentWeather = 'Limpo',
}: RideInputModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Mode + result state ────────────────────────────────────────────────────
  const [mode, setMode]       = useState<Mode>('choose');
  const [result, setResult]   = useState<RideAnalysisV2 | null>(null);
  const [ocrData, setOcrData] = useState<Partial<ExtractedRideData> | null>(null);
  const [ocrError, setOcrError] = useState('');
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState('');

  // ── Manual form state ──────────────────────────────────────────────────────
  const [platform, setPlatform]       = useState<'Uber' | '99'>('Uber');
  const [price, setPrice]             = useState('');
  const [pickupKm, setPickupKm]       = useState<number | null>(null);
  const [rideKm, setRideKm]           = useState<number | null>(null);
  const [destination, setDestination] = useState('');
  const [rating, setRating]           = useState<number>(4.9);
  const [hasTolls, setHasTolls]       = useState(false);
  const [hasStops, setHasStops]       = useState(false);
  const [isRiskArea, setIsRiskArea]   = useState(false);
  const [formError, setFormError]     = useState('');

  const priceNum  = parseFloat(price.replace(',', '.')) || 0;
  const canSubmit = priceNum > 0 && (pickupKm ?? 0) > 0 && (rideKm ?? 0) > 0;

  // ── Reset & close ──────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    setMode('choose');
    setResult(null);
    setOcrData(null);
    setOcrError('');
    setOcrPreviewUrl('');
    setPrice('');
    setPickupKm(null);
    setRideKm(null);
    setDestination('');
    setRating(4.9);
    setHasTolls(false);
    setHasStops(false);
    setIsRiskArea(false);
    setFormError('');
    onClose();
  }, [onClose]);

  // ── Show result ────────────────────────────────────────────────────────────
  const showResult = useCallback((analysis: RideAnalysisV2, ride: RideRequest) => {
    setResult(analysis);
    setMode('result');

    // 🔊 EMITE SOM AUTOMATICAMENTE
    if (analysis.shouldAccept) {
      playAcceptSound();
    } else {
      playRejectSound();
    }

    onAnalysisDone(analysis, ride);
  }, [onAnalysisDone]);

  // ── OCR from image ─────────────────────────────────────────────────────────
  const handleImageSelected = useCallback(async (file: File) => {
    setOcrError('');
    setMode('ocr-loading');

    // Preview
    const url = URL.createObjectURL(file);
    setOcrPreviewUrl(url);

    const ocrResult = await extractRideFromImage(file);

    if (!ocrResult.ok) {
      setOcrError(ocrResult.error);
      // Ir pra manual com a imagem como referência visual
      setMode('ocr-confirm');
      setOcrData({});
      return;
    }

    const data = ocrResult.data;
    setOcrData(data);

    // Se confiança alta e dados completos → roda direto sem confirmação
    if (
      data.confidence === 'high' &&
      data.totalPrice > 0 &&
      data.pickupDistance > 0 &&
      data.rideDistance > 0
    ) {
      const { analysis, ride } = runAnalysis({
        totalPrice:       data.totalPrice,
        pickupDistance:   data.pickupDistance,
        rideDistance:     data.rideDistance,
        destination:      data.destination,
        passengerRating:  data.passengerRating,
        platform:         data.platform,
        hasTolls:         false,
        hasStops:         false,
        isRiskArea:       false,
        currentNeighborhood,
        currentWeather,
        activeProfile, activeCategory, userPreferences, brainState, uid,
      });
      showResult(analysis, ride);
    } else {
      // Confiança média/baixa → pede confirmação dos dados
      setMode('ocr-confirm');
    }
  }, [currentNeighborhood, currentWeather, activeProfile, activeCategory, userPreferences, brainState, uid, showResult]);

  // ── Manual form submit ─────────────────────────────────────────────────────
  const handleManualSubmit = useCallback(() => {
    if (!canSubmit) {
      setFormError('Preencha: preço, km até o passageiro e km da corrida.');
      return;
    }
    setFormError('');
    const { analysis, ride } = runAnalysis({
      totalPrice:      priceNum,
      pickupDistance:  pickupKm ?? 0,
      rideDistance:    rideKm   ?? 0,
      destination,
      passengerRating: rating,
      platform,
      hasTolls, hasStops, isRiskArea,
      currentNeighborhood, currentWeather,
      activeProfile, activeCategory, userPreferences, brainState, uid,
    });
    showResult(analysis, ride);
  }, [
    canSubmit, priceNum, pickupKm, rideKm, destination, rating,
    platform, hasTolls, hasStops, isRiskArea,
    currentNeighborhood, currentWeather,
    activeProfile, activeCategory, userPreferences, brainState, uid,
    showResult,
  ]);

  // ── OCR confirm submit ─────────────────────────────────────────────────────
  const handleOcrConfirm = useCallback(() => {
    const p  = ocrData?.totalPrice     || priceNum;
    const pk = ocrData?.pickupDistance || pickupKm || 0;
    const rk = ocrData?.rideDistance   || rideKm   || 0;

    if (!p || !pk || !rk) {
      setOcrError('Preencha os campos que não foram lidos corretamente.');
      return;
    }

    const { analysis, ride } = runAnalysis({
      totalPrice:      p,
      pickupDistance:  pk,
      rideDistance:    rk,
      destination:     ocrData?.destination || destination,
      passengerRating: ocrData?.passengerRating || 4.9,
      platform:        ocrData?.platform || 'Uber',
      hasTolls:        false,
      hasStops:        false,
      isRiskArea:      false,
      currentNeighborhood, currentWeather,
      activeProfile, activeCategory, userPreferences, brainState, uid,
    });
    showResult(analysis, ride);
  }, [
    ocrData, priceNum, pickupKm, rideKm, destination,
    currentNeighborhood, currentWeather,
    activeProfile, activeCategory, userPreferences, brainState, uid,
    showResult,
  ]);

  if (!isOpen) return null;

  // ─────────────────────────────────────────────────────────────────────────
  // RESULT SCREEN
  // ─────────────────────────────────────────────────────────────────────────
  if (mode === 'result' && result) {
    const accept = result.shouldAccept;
    const bg     = accept ? '#0a3d1f' : '#3d0a0a';
    const accent = accept ? '#1e8e3e' : '#d93025';
    const scoreLabel =
      result.score >= 80 ? 'Excelente' :
      result.score >= 65 ? 'Boa' :
      result.score >= 55 ? 'Marginal' : 'Fraca';

    return (
      <div
        className="fixed inset-0 z-[95] flex flex-col"
        style={{ background: bg }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 pt-10 pb-3">
          <button
            onClick={handleClose}
            className="bg-white/10 p-2 rounded-full"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <span className="text-white/50 text-[10px] font-black uppercase tracking-widest">
            Análise PRÉCHECA
          </span>
          <div className="w-9" />
        </div>

        {/* Verdict */}
        <div className="flex flex-col items-center py-6 px-6">
          <div
            className="w-36 h-36 rounded-full flex flex-col items-center justify-center mb-4 shadow-2xl"
            style={{ background: accent }}
          >
            {accept
              ? <CheckCircle2 className="w-20 h-20 text-white" />
              : <XCircle     className="w-20 h-20 text-white" />
            }
          </div>

          <h1 className="text-6xl font-black text-white uppercase tracking-tight mb-1">
            {accept ? 'ACEITA' : 'RECUSA'}
          </h1>
          <p className="text-white/50 text-xs font-black uppercase tracking-widest">
            Score {result.score}/100 — {scoreLabel}
          </p>

          <div className="bg-white/10 rounded-2xl px-8 py-3 mt-4">
            <span className="text-3xl font-black text-white">
              R$ {result.ride.totalPrice.toFixed(2)}
            </span>
            <span className="text-white/50 text-sm ml-2">
              R${result.pricePerKm.toFixed(2)}/km · R${result.pricePerHour.toFixed(0)}/h
            </span>
          </div>
        </div>

        {/* Insights */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2">
          {result.brainInsights[0] && (
            <div className="bg-white/10 rounded-2xl p-4 flex gap-3 items-start">
              <BrainCircuit className="w-5 h-5 text-white/80 shrink-0 mt-0.5" />
              <p className="text-white/90 text-sm leading-relaxed">{result.brainInsights[0]}</p>
            </div>
          )}

          {result.reasons.slice(0, 4).map((reason, i) => {
            const neg = reason.startsWith('⚠️') || reason.startsWith('🚫') ||
              reason.startsWith('🛑') || reason.includes('baixo') || reason.includes('Paga');
            return (
              <div
                key={i}
                className="flex gap-3 items-start rounded-xl px-4 py-3"
                style={{ background: neg ? 'rgba(217,48,37,0.28)' : 'rgba(30,142,62,0.28)' }}
              >
                {neg
                  ? <XCircle     className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
                  : <CheckCircle2 className="w-4 h-4 text-green-300 shrink-0 mt-0.5" />
                }
                <span className="text-white/90 text-xs leading-relaxed">{reason}</span>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="px-5 pb-10 pt-2 flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 py-4 rounded-2xl font-black text-sm uppercase bg-white/15 text-white"
          >
            Fechar
          </button>
          <button
            onClick={() => { setResult(null); setMode('choose'); setOcrData(null); setOcrPreviewUrl(''); }}
            className="flex-1 py-4 rounded-2xl font-black text-sm uppercase bg-white"
            style={{ color: bg }}
          >
            Nova Análise
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OCR LOADING
  // ─────────────────────────────────────────────────────────────────────────
  if (mode === 'ocr-loading') {
    return (
      <div className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-[#202124]">
        <div className="bg-[#1a73e8] w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-2xl">
          <BrainCircuit className="w-14 h-14 text-white animate-pulse" />
        </div>
        <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-2">
          Lendo a corrida...
        </h2>
        <p className="text-[#80868b] text-sm font-bold text-center max-w-xs">
          Gemini está extraindo preço, distância e destino do seu print
        </p>
        {ocrPreviewUrl && (
          <img
            src={ocrPreviewUrl}
            alt="print"
            className="mt-6 w-32 h-auto rounded-xl opacity-40 object-contain"
          />
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OCR CONFIRM (confiança média/baixa ou erro parcial)
  // ─────────────────────────────────────────────────────────────────────────
  if (mode === 'ocr-confirm') {
    const d = ocrData || {};

    return (
      <div className="fixed inset-0 z-[95] flex flex-col bg-[#f8f9fa]">
        {/* Header */}
        <div className="bg-[#202124] px-5 pt-10 pb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">
              Confirmar dados lidos
            </h2>
            <p className="text-[#80868b] text-xs font-bold mt-0.5">
              Gemini leu o print — confira se está certo
            </p>
          </div>
          <button onClick={handleClose} className="bg-white/10 p-2.5 rounded-full">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
          {/* Preview + status */}
          <div className="flex gap-3 items-start">
            {ocrPreviewUrl && (
              <img
                src={ocrPreviewUrl}
                alt="print"
                className="w-16 h-auto rounded-xl object-contain border border-[#dadce0]"
              />
            )}
            <div className="flex-1">
              {ocrError ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-amber-800 text-xs font-bold">{ocrError}</p>
                  <p className="text-amber-600 text-xs mt-1">Preencha os campos abaixo manualmente.</p>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <p className="text-green-800 text-xs font-bold">
                    Print lido! Confirme os dados extraídos.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Preço */}
          <div>
            <label className="text-xs font-black text-[#5f6368] uppercase tracking-widest mb-1.5 block">
              💰 Valor (R$)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-black text-[#202124]">R$</span>
              <input
                type="number"
                inputMode="decimal"
                defaultValue={d.totalPrice || ''}
                onChange={e => setOcrData(prev => ({ ...prev, totalPrice: parseFloat(e.target.value) || 0 }))}
                className="w-full bg-white border-2 border-[#dadce0] rounded-2xl pl-12 pr-4 py-3.5 text-2xl font-black text-[#202124] focus:border-[#1a73e8] focus:outline-none"
              />
            </div>
          </div>

          {/* Distâncias */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-black text-[#5f6368] uppercase tracking-widest mb-1.5 block">📍 Buscar (km)</label>
              <input
                type="number" inputMode="decimal"
                defaultValue={d.pickupDistance || ''}
                onChange={e => setOcrData(prev => ({ ...prev, pickupDistance: parseFloat(e.target.value) || 0 }))}
                className="w-full bg-white border-2 border-[#dadce0] rounded-2xl px-4 py-3 text-xl font-black text-[#202124] focus:border-[#1a73e8] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-black text-[#5f6368] uppercase tracking-widest mb-1.5 block">🛣️ Corrida (km)</label>
              <input
                type="number" inputMode="decimal"
                defaultValue={d.rideDistance || ''}
                onChange={e => setOcrData(prev => ({ ...prev, rideDistance: parseFloat(e.target.value) || 0 }))}
                className="w-full bg-white border-2 border-[#dadce0] rounded-2xl px-4 py-3 text-xl font-black text-[#202124] focus:border-[#1a73e8] focus:outline-none"
              />
            </div>
          </div>

          {/* Destino */}
          <div>
            <label className="text-xs font-black text-[#5f6368] uppercase tracking-widest mb-1.5 block">🏁 Destino</label>
            <input
              type="text"
              defaultValue={d.destination || ''}
              onChange={e => setOcrData(prev => ({ ...prev, destination: e.target.value }))}
              className="w-full bg-white border-2 border-[#dadce0] rounded-2xl px-4 py-3 text-base font-bold text-[#202124] focus:border-[#1a73e8] focus:outline-none"
              placeholder="Bairro ou local de destino"
            />
          </div>

          {ocrError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2 items-start">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-red-700 text-xs font-bold">{ocrError}</p>
            </div>
          )}
        </div>

        <div className="px-4 pb-10 pt-3 bg-white border-t border-[#dadce0]">
          <button
            onClick={handleOcrConfirm}
            className="w-full py-5 rounded-2xl font-black text-xl uppercase bg-[#1a73e8] text-white flex items-center justify-center gap-3 shadow-xl active:scale-95"
          >
            <Zap className="w-7 h-7" />
            ANALISAR AGORA
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MANUAL FORM
  // ─────────────────────────────────────────────────────────────────────────
  if (mode === 'manual') {
    return (
      <div className="fixed inset-0 z-[95] flex flex-col bg-[#f8f9fa]">
        <div className="bg-[#202124] px-5 pt-10 pb-5 flex items-center gap-3">
          <button
            onClick={() => setMode('choose')}
            className="bg-white/10 p-2.5 rounded-full"
          >
            <X className="w-4 h-4 text-white" />
          </button>
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">Digitar dados</h2>
            <p className="text-[#80868b] text-xs font-bold">Preencha o que aparece na corrida</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
          {/* Platform */}
          <div>
            <label className="text-xs font-black text-[#5f6368] uppercase tracking-widest mb-2 block">Plataforma</label>
            <div className="flex gap-2">
              {(['Uber', '99'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`flex-1 py-3 rounded-xl font-black text-base uppercase transition-all ${
                    platform === p
                      ? 'bg-[#202124] text-white shadow-lg scale-[1.02]'
                      : 'bg-white border-2 border-[#dadce0] text-[#5f6368]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Price */}
          <div>
            <label className="text-xs font-black text-[#5f6368] uppercase tracking-widest mb-2 block">
              💰 Valor da corrida (R$)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-black text-[#202124]">R$</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="0,00"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="w-full bg-white border-2 border-[#dadce0] rounded-2xl pl-12 pr-4 py-4 text-2xl font-black text-[#202124] focus:border-[#1a73e8] focus:outline-none"
              />
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {[5, 8, 10, 12, 15, 20, 25].map(v => (
                <button
                  key={v}
                  onClick={() => setPrice(String((priceNum + v).toFixed(2)))}
                  className="bg-white border border-[#dadce0] text-[#5f6368] rounded-lg px-3 py-1.5 text-sm font-bold"
                >
                  +{v}
                </button>
              ))}
            </div>
          </div>

          {/* Pickup distance */}
          <div>
            <label className="text-xs font-black text-[#5f6368] uppercase tracking-widest mb-2 block">
              📍 Km até o passageiro
            </label>
            <div className="flex flex-wrap gap-2">
              {PICKUP_PRESETS.map(v => (
                <button
                  key={v}
                  onClick={() => setPickupKm(v)}
                  className={`flex-1 min-w-[56px] py-3 rounded-xl font-black text-sm transition-all ${
                    pickupKm === v
                      ? 'bg-[#1a73e8] text-white shadow-md scale-[1.05]'
                      : 'bg-white border-2 border-[#dadce0] text-[#202124]'
                  }`}
                >
                  {v}km
                </button>
              ))}
            </div>
          </div>

          {/* Ride distance */}
          <div>
            <label className="text-xs font-black text-[#5f6368] uppercase tracking-widest mb-2 block">
              🛣️ Km da corrida
            </label>
            <div className="flex flex-wrap gap-2">
              {RIDE_PRESETS.map(v => (
                <button
                  key={v}
                  onClick={() => setRideKm(v)}
                  className={`flex-1 min-w-[46px] py-3 rounded-xl font-black text-sm transition-all ${
                    rideKm === v
                      ? 'bg-[#202124] text-white shadow-md scale-[1.05]'
                      : 'bg-white border-2 border-[#dadce0] text-[#202124]'
                  }`}
                >
                  {v}km
                </button>
              ))}
            </div>
          </div>

          {/* Destination */}
          <div>
            <label className="text-xs font-black text-[#5f6368] uppercase tracking-widest mb-2 block">
              🏁 Destino <span className="text-[#80868b] normal-case font-normal">(opcional)</span>
            </label>
            <input
              type="text"
              placeholder="Itaim Bibi, Aeroporto, Centro..."
              value={destination}
              onChange={e => setDestination(e.target.value)}
              className="w-full bg-white border-2 border-[#dadce0] rounded-2xl px-4 py-3.5 text-base font-bold text-[#202124] focus:border-[#1a73e8] focus:outline-none"
            />
          </div>

          {/* Flags */}
          <div>
            <label className="text-xs font-black text-[#5f6368] uppercase tracking-widest mb-2 block">
              ⚠️ Alertas
            </label>
            <div className="flex gap-2">
              {[
                { label: 'Pedágio',    state: hasTolls,   set: setHasTolls },
                { label: 'Parada',     state: hasStops,   set: setHasStops },
                { label: 'Área risco', state: isRiskArea, set: setIsRiskArea },
              ].map(({ label, state, set }) => (
                <button
                  key={label}
                  onClick={() => set(!state)}
                  className={`flex-1 py-2.5 rounded-xl font-black text-xs transition-all ${
                    state ? 'bg-[#d93025] text-white' : 'bg-white border-2 border-[#dadce0] text-[#5f6368]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {formError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-red-700 text-xs font-bold">{formError}</p>
            </div>
          )}
        </div>

        <div className="px-4 pb-10 pt-3 bg-white border-t border-[#dadce0]">
          <button
            onClick={handleManualSubmit}
            disabled={!canSubmit}
            className={`w-full py-5 rounded-2xl font-black text-xl uppercase flex items-center justify-center gap-3 shadow-xl active:scale-95 transition-all ${
              canSubmit
                ? 'bg-[#1a73e8] text-white'
                : 'bg-[#dadce0] text-[#80868b] cursor-not-allowed'
            }`}
          >
            <BrainCircuit className="w-7 h-7" />
            ANALISAR
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CHOOSE MODE (tela inicial)
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-[#202124]">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleImageSelected(file);
          e.target.value = ''; // reset so same file can be selected again
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-10 pb-6">
        <div>
          <h2 className="text-3xl font-black text-white uppercase tracking-tight">
            Corrida tocou?
          </h2>
          <p className="text-[#80868b] text-sm font-bold mt-1">
            Analisa antes de aceitar.
          </p>
        </div>
        <button onClick={handleClose} className="bg-white/10 p-3 rounded-full">
          <X className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Main options */}
      <div className="flex-1 px-5 space-y-4">

        {/* OCR Option — principal */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full bg-[#1a73e8] rounded-3xl p-6 text-left active:scale-[0.98] transition-all shadow-2xl shadow-blue-900/40"
        >
          <div className="flex items-center gap-4 mb-3">
            <div className="bg-white/20 w-14 h-14 rounded-2xl flex items-center justify-center">
              <Camera className="w-8 h-8 text-white" />
            </div>
            <div>
              <p className="text-white font-black text-xl uppercase tracking-tight">Enviar Print</p>
              <p className="text-blue-200 text-xs font-bold uppercase tracking-wider">Recomendado</p>
            </div>
          </div>
          <p className="text-blue-100 text-sm leading-relaxed">
            Tire um screenshot da corrida no Uber/99 e selecione aqui.{' '}
            <span className="font-black">A IA lê e decide automaticamente</span> — com som de aceitar ou recusar.
          </p>
          <div className="mt-4 bg-white/20 rounded-xl px-4 py-2 inline-flex items-center gap-2">
            <Image className="w-4 h-4 text-white" />
            <span className="text-white text-xs font-black uppercase tracking-wider">
              Selecionar imagem / galeria
            </span>
          </div>
        </button>

        {/* Manual Option */}
        <button
          onClick={() => setMode('manual')}
          className="w-full bg-white/10 border border-white/20 rounded-3xl p-6 text-left active:scale-[0.98] transition-all"
        >
          <div className="flex items-center gap-4 mb-3">
            <div className="bg-white/10 w-14 h-14 rounded-2xl flex items-center justify-center">
              <Pencil className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="text-white font-black text-xl uppercase tracking-tight">Digitar</p>
              <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Alternativa</p>
            </div>
          </div>
          <p className="text-white/60 text-sm leading-relaxed">
            Digite o preço e a distância manualmente. Mais rápido se você já sabe os números.
          </p>
        </button>

        {/* Tip */}
        <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
          <p className="text-white/50 text-xs leading-relaxed">
            <span className="text-white font-bold">💡 Dica:</span> Para máxima velocidade, deixe o PRÉCHECA aberto ao lado do Uber.
            Quando tocar, tire o screenshot, toque em "Enviar Print" e ouça o som de ACEITAR ou RECUSAR.
          </p>
        </div>
      </div>

      <div className="px-5 pb-10 pt-4" />
    </div>
  );
}
