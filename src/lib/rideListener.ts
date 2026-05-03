/**
 * rideListener.ts — Hook de escuta automática de corridas
 *
 * Conecta o app React ao plugin nativo de Android (NotificationPlugin)
 * que lê as notificações do Uber/99 em background.
 *
 * Quando o motorista recebe uma corrida no Uber/99:
 *  1. O RideNotificationListener.java intercepta a notificação
 *  2. Extrai preço, km, destino do texto
 *  3. Dispara broadcast → NotificationPlugin.java recebe
 *  4. NotificationPlugin.java dispara evento "rideDetected" pro React
 *  5. Este hook chama o callback → analyzeRide → som ACEITAR/RECUSAR
 *
 * No browser (PWA sem APK), o plugin não está disponível e o hook
 * retorna isAvailable: false sem quebrar o app.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { analyzeRide } from './analyzer';
import { parseNotificationText } from './rideOcr';
import { playAcceptSound, playRejectSound } from './audio';
import {
  DriverProfile, VehicleCategory, PersonalBrainState,
  RideRequest, RideAnalysisV2,
} from '../types';
import { UserPreferences } from './analyzer';

// ─── Capacitor bridge (null-safe) ─────────────────────────────────────────────

async function getPlugin(): Promise<any | null> {
  try {
    // Capacitor injeta os plugins nativos em window.Capacitor.Plugins
    const cap = (window as any).Capacitor;
    if (!cap || !cap.isNativePlatform()) return null;
    const plugin = cap.Plugins?.RideNotification;
    return plugin ?? null;
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RideListenerState {
  isAvailable:   boolean;   // plugin nativo presente (APK)
  hasPermission: boolean;   // permissão de acesso a notificações concedida
  isListening:   boolean;   // listener ativo
  lastRide:      RideAnalysisV2 | null;
}

export interface RideListenerOptions {
  activeProfile:    DriverProfile;
  activeCategory:   VehicleCategory;
  userPreferences:  UserPreferences;
  brainState?:      PersonalBrainState;
  uid?:             string;
  currentNeighborhood: string;
  currentWeather:   'Limpo' | 'Chovendo' | 'Nublado';
  onRideDetected?:  (analysis: RideAnalysisV2, ride: RideRequest) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRideListener(opts: RideListenerOptions): {
  state: RideListenerState;
  requestPermission: () => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
} {
  const [state, setState] = useState<RideListenerState>({
    isAvailable:   false,
    hasPermission: false,
    isListening:   false,
    lastRide:      null,
  });

  // Manter referência atual das opções sem re-montar o listener
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // ── Inicializa: detecta se plugin está disponível ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const plugin = await getPlugin();
      if (cancelled || !plugin) return;

      const { granted } = await plugin.hasPermission().catch(() => ({ granted: false }));
      if (!cancelled) {
        setState(s => ({ ...s, isAvailable: true, hasPermission: granted }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Processa corrida detectada ─────────────────────────────────────────────
  const handleRideDetected = useCallback((event: any) => {
    const o = optsRef.current;

    // Monta dados a partir do evento nativo
    const totalPrice     = Number(event.totalPrice)     || 0;
    const pickupDistance = Number(event.pickupDistance) || 0;
    const rideDistance   = Number(event.rideDistance)   || 0;

    // Se o listener nativo não conseguiu extrair os números mínimos,
    // tenta o parser de texto do rideOcr.ts como fallback
    let finalPickup = pickupDistance;
    let finalRide   = rideDistance;
    let finalPrice  = totalPrice;

    if ((!finalPrice || !finalPickup || !finalRide) && event.rawText) {
      const parsed = parseNotificationText({
        title:       event.rawTitle || '',
        text:        event.rawText  || '',
        packageName: event.platform === '99' ? 'com.taxis99.motorista' : 'com.ubercab.driver',
      });
      finalPrice  = finalPrice  || (parsed.totalPrice     ?? 0);
      finalPickup = finalPickup || (parsed.pickupDistance ?? 0);
      finalRide   = finalRide   || (parsed.rideDistance   ?? 0);
    }

    // Precisa de preço E pelo menos uma distância para analisar
    if (!finalPrice && !finalRide) {
      console.warn('[RideListener] Dados insuficientes na notificação:', event);
      return;
    }

    const now = new Date();
    const hours = now.getHours();
    let timeOfDay: 'Manhã' | 'Tarde' | 'Noite' | 'Madrugada' = 'Tarde';
    if (hours >= 5  && hours < 12) timeOfDay = 'Manhã';
    if (hours >= 18 && hours < 23) timeOfDay = 'Noite';
    if (hours >= 23 || hours < 5)  timeOfDay = 'Madrugada';

    const days = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

    const pickupTimeMin = Math.max(1, Math.round(finalPickup / 25 * 60));
    const rideTimeMin   = Math.max(2, Math.round(finalRide   / 30 * 60));

    const ride: RideRequest = {
      id:              `notif-${Date.now()}`,
      platform:        event.platform === '99' ? '99' : 'Uber',
      passengerRating: 4.9,
      passengerName:   'Passageiro',
      pickupDistance:  finalPickup,
      pickupTimeMin,
      rideDistance:    finalRide,
      rideTimeMin,
      totalPrice:      finalPrice,
      pickupLocation:  o.currentNeighborhood,
      dropoffLocation: event.destination || 'Destino detectado',
      isRiskArea:      false,
      hasStops:        false,
      isDirtRoad:      false,
      hasTolls:        false,
      context: {
        dayOfWeek:          days[now.getDay()],
        timeOfDay,
        exactTime:          `${String(hours).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
        weather:            o.currentWeather,
        pickupNeighborhood: o.currentNeighborhood,
      },
    };

    const analysis = analyzeRide(
      ride,
      o.activeProfile,
      o.activeCategory.multiplier,
      o.userPreferences,
      o.brainState,
      o.uid
    );

    // 🔊 SOM AUTOMÁTICO — sem precisar tocar na tela
    if (analysis.shouldAccept) {
      playAcceptSound();
    } else {
      playRejectSound();
    }

    setState(s => ({ ...s, lastRide: analysis }));
    o.onRideDetected?.(analysis, ride);
  }, []);

  // ── Pedir permissão ────────────────────────────────────────────────────────
  const requestPermission = useCallback(async () => {
    const plugin = await getPlugin();
    if (!plugin) return;
    await plugin.requestPermission().catch(console.error);

    // Verifica novamente após o usuário voltar da tela de configurações
    setTimeout(async () => {
      const { granted } = await plugin.hasPermission().catch(() => ({ granted: false }));
      setState(s => ({ ...s, hasPermission: granted }));
    }, 1000);
  }, []);

  // ── Iniciar escuta ─────────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    const plugin = await getPlugin();
    if (!plugin) return;

    await plugin.startListening().catch(console.error);

    // Registra o listener de eventos
    plugin.addListener('rideDetected', handleRideDetected);

    setState(s => ({ ...s, isListening: true }));
  }, [handleRideDetected]);

  // ── Parar escuta ───────────────────────────────────────────────────────────
  const stopListening = useCallback(async () => {
    const plugin = await getPlugin();
    if (!plugin) return;

    await plugin.stopListening().catch(console.error);
    plugin.removeAllListeners?.();

    setState(s => ({ ...s, isListening: false }));
  }, []);

  // ── Auto-inicia quando permissão está concedida ────────────────────────────
  useEffect(() => {
    if (state.isAvailable && state.hasPermission && !state.isListening) {
      startListening();
    }
  }, [state.isAvailable, state.hasPermission, state.isListening, startListening]);

  return { state, requestPermission, startListening, stopListening };
}
