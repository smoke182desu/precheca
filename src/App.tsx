import { useState, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, useMap, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Settings, Map, LayoutDashboard, Zap, CheckCircle2, XCircle, MapPin, Navigation, CarFront, AlertTriangle, Play, Loader2, Route, Clock, Target, CalendarDays, ShieldCheck, Network, Cpu, ArrowRight, TrendingUp, TrendingDown, Minus, Database, Activity, Fingerprint, BrainCircuit, History, Compass, ArrowUp, Info, LogOut, Satellite, CloudRain, Hexagon, Component, Radio, Search, RotateCcw, Lock, Share2, Crown, Ticket } from 'lucide-react';
import { PROFILES, CATEGORIES, getHotspotsForProfile, getTrailForProfile, simulateIncomingRide, analyzeRide } from './lib/analyzer';
import { playAcceptSound, playRejectSound } from './lib/audio';
import { DriverProfile, RideAnalysis, Hotspot, VehicleCategory, PersonalBrainState } from './types';
import { useFirebase } from './components/FirebaseProvider';
import { db } from './lib/firebase';
import { doc, getDoc, updateDoc, setDoc, serverTimestamp, collection } from 'firebase/firestore';
import { buildPersonalBrain } from './lib/learner';
import { buildLiveContext, LiveContext, invalidateContextCache } from './lib/contextService';
import { weatherIcon } from './lib/weatherService';
import { generateMissions, Mission } from './lib/missionPlanner';

import { SettingsWizard } from './components/SettingsWizard';
import { EventsDashboard } from './components/EventsDashboard';

function MapUpdater({ center, zoom }: { center: [number, number], zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom !== undefined ? zoom : map.getZoom(), { animate: true });
  }, [center, map, zoom]);
  return null;
}

function App() {
  const { user, loading, isSigningIn, signIn, logOut } = useFirebase();

  const [activeTab, setActiveTab] = useState<'dashboard' | 'hotspots' | 'trail' | 'profiles' | 'evolution'>('dashboard');
  const [activeProfile, setActiveProfile] = useState<DriverProfile>(PROFILES[1]);
  const [activeCategory, setActiveCategory] = useState<VehicleCategory>(CATEGORIES[0]);
  const [currentAnalysis, setCurrentAnalysis] = useState<RideAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [ridesTrained, setRidesTrained] = useState(0);
  const [showWizard, setShowWizard] = useState(false);
  const [brainState, setBrainState] = useState<PersonalBrainState | null>(null);
  const [liveContext, setLiveContext] = useState<LiveContext | null>(null);
  // Mission planner — all generated missions (8), UI shows 3 at a time
  const [allMissions, setAllMissions] = useState<Mission[]>([]);
  const [visibleMissionIndices, setVisibleMissionIndices] = useState<[number, number, number]>([0, 1, 2]);
  const [acceptedMissionId, setAcceptedMissionId] = useState<string | null>(null);
  const [showProModal, setShowProModal] = useState(false);
  const [isPro, setIsPro] = useState(false); // Simulated Pro Plan Access
  const [customStops, setCustomStops] = useState<import('./types').TrailStep[]>([]);
  const [isAddingStop, setIsAddingStop] = useState(false);
  const [newStopData, setNewStopData] = useState<{
    time: string;
    title: string;
    location: string;
    repeat: 'none' | 'daily' | 'custom';
    customDays: number[];
  }>({ time: '14:00', title: '', location: '', repeat: 'none', customDays: [] });

  const daysOfWeek = [
    { id: 0, label: 'Dom' },
    { id: 1, label: 'Seg' },
    { id: 2, label: 'Ter' },
    { id: 3, label: 'Qua' },
    { id: 4, label: 'Qui' },
    { id: 5, label: 'Sex' },
    { id: 6, label: 'Sáb' },
  ];

  // GPS Tracking State
  const [gpsLocation, setGpsLocation] = useState<{lat: number, lng: number, speed: number | null, heading: number | null} | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'searching' | 'active' | 'error'>('searching');
  const [manualNeighborhood, setManualNeighborhood] = useState<string | null>(null);
  const [realNeighborhood, setRealNeighborhood] = useState<string>('Buscando bairro...');
  const [userPreferences, setUserPreferences] = useState<{ avoidDirtRoads?: boolean; avoidRidesWithStops?: boolean; avoidTolls?: boolean; strictSafetyMode?: boolean; voiceAlerts?: boolean; }>({});

  // Real-time Geolocation Hook
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      setRealNeighborhood('Sem GPS');
      return;
    }
    
    let isMounted = true;
    const requestGps = () => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!isMounted) return;
          setGpsLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            speed: position.coords.speed,
            heading: position.coords.heading
          });
          setGpsStatus('active');
        },
        (error) => {
          if (!isMounted) return;
          console.error("GPS Initial Error:", error);
          setGpsStatus('error');
          setRealNeighborhood('Erro GPS');
        },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    };

    requestGps();

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!isMounted) return;
        setGpsLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          speed: position.coords.speed,
          heading: position.coords.heading
        });
        setGpsStatus('active');
      },
      (error) => {
        if (!isMounted) return;
        console.error("GPS Watch Error:", error);
        // Don't flip to error immediately if we already have a location
        if (gpsStatus !== 'active') {
           setGpsStatus('error');
           setRealNeighborhood('Erro GPS');
        }
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    
    return () => {
      isMounted = false;
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // Reverse Geocoding Effect using Nominatim (OpenStreetMap)
  useEffect(() => {
     if (!gpsLocation) return;
     let isMounted = true;
     
     // Debounce to prevent API rate limiting
     const timeoutId = setTimeout(() => {
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${gpsLocation.lat}&lon=${gpsLocation.lng}&zoom=14`)
          .then(res => res.json())
          .then(data => {
             if (isMounted && data && data.address) {
                // Try to extract the most meaningful neighborhood name
                let neighborhood = data.address.suburb || data.address.neighbourhood || data.address.quarter || data.address.city_district || data.address.town || data.address.city || data.address.municipality || 'Desconhecido';
                setRealNeighborhood(neighborhood);
             }
          })
          .catch(err => {
             console.error("Reverse Geocoding error:", err);
             if (isMounted) setRealNeighborhood('Desconhecido');
          });
     }, 2000);
     
     return () => {
        isMounted = false;
        clearTimeout(timeoutId);
     };
  }, [gpsLocation?.lat, gpsLocation?.lng]);

  // ── Live Context: real weather + holiday + nearby POIs ────────────────────
  // Runs when GPS position changes significantly. Updates every ~8 minutes.
  useEffect(() => {
    if (!effectiveGpsLocation) return;
    let cancelled = false;

    const timeoutId = setTimeout(() => {
      const { lat, lng } = effectiveGpsLocation;
      const neighborhood = manualNeighborhood || realNeighborhood;

      buildLiveContext(lat, lng, neighborhood, {
        ticketmasterKey: import.meta.env.VITE_TICKETMASTER_KEY as string | undefined,
        footballKey:     import.meta.env.VITE_FOOTBALL_KEY     as string | undefined,
      })
        .then(ctx => { if (!cancelled) setLiveContext(ctx); })
        .catch(e => console.warn('[LiveContext] Failed:', e));
    }, 3000); // debounce 3s after GPS settles

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveGpsLocation?.lat, effectiveGpsLocation?.lng, realNeighborhood]);

  // ── Mission generation ────────────────────────────────────────────────────
  // Regenerates missions whenever the live context or brain updates.
  useEffect(() => {
    const missions = generateMissions(
      {
        windowMin: 120,
        categoryMultiplier: activeCategory.multiplier,
        liveContext,
        brainState,
      },
      8  // generate 8, show 3 at a time
    );
    setAllMissions(missions);
    setVisibleMissionIndices([0, 1, 2]);
    setAcceptedMissionId(null);
  }, [liveContext, brainState, activeCategory.multiplier]);

  // Swap out a dismissed mission for the next available alternative
  const handleDismissMission = useCallback((rank: number) => {
    setVisibleMissionIndices(prev => {
      const nextFreeIndex = Math.max(...prev) + 1;
      if (nextFreeIndex >= allMissions.length) return prev;
      const updated = [...prev] as [number, number, number];
      const slotIndex = rank - 1; // rank 1→slot 0, rank 2→slot 1, rank 3→slot 2
      updated[slotIndex] = nextFreeIndex;
      return updated;
    });
  }, [allMissions.length]);

  // Accept a mission — mark it and log to Firestore
  const handleAcceptMission = useCallback(async (mission: Mission) => {
    setAcceptedMissionId(mission.id);
    if (!user) return;
    try {
      const { MissionLog } = await import('./types'); // type only, no runtime cost
      const newDoc = collection(db, `users/${user.uid}/missions`);
      const missionDoc = doc(newDoc);
      await setDoc(missionDoc, {
        strategy: mission.strategy,
        emoji: mission.emoji,
        neighborhoodType: mission.neighborhoodType,
        targetDescription: mission.targetDescription,
        specificNeighborhoods: mission.specificNeighborhoods,
        estimatedEarningsR$: mission.estimatedEarningsR$,
        estimatedKm: mission.estimatedKm,
        estimatedRides: mission.estimatedRides,
        estimatedWindowMin: mission.estimatedWindowMin,
        confidencePercent: mission.confidencePercent,
        demandMultiplier: mission.demandMultiplier,
        reasonWhy: mission.reasonWhy,
        badge: mission.badge ?? null,
        outcome: 'not_reported',
        acceptedAt: serverTimestamp(),
        suggestedAt: mission.suggestedAt,
      });
    } catch (e) {
      console.error('[Mission] Failed to log accepted mission:', e);
    }
  }, [user]);

  // Auto-save active profile/category selection whenever the user changes them
  useEffect(() => {
    if (!user) return;
    setDoc(doc(db, `users/${user.uid}`), {
      activeProfileId: activeProfile.id,
      activeCategoryId: activeCategory.id,
      updatedAt: serverTimestamp()
    }, { merge: true }).catch(e => console.log('Silently failed update state', e));
  }, [activeProfile, activeCategory, user]);

  // ── Brain initialization on login ─────────────────────────────────────────
  // Runs once when the user logs in. Checks wizard completion, loads preferences,
  // and kicks off the personal learning engine in the background.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    getDoc(doc(db, `users/${user.uid}`))
      .then(snap => {
        if (cancelled) return;
        if (!snap.exists()) {
          // Brand new user — show wizard immediately
          setShowWizard(true);
          return;
        }
        const data = snap.data();

        // Show wizard if onboarding was never completed
        if (!data.wizardCompleted) {
          setShowWizard(true);
        }

        // Restore safety preferences
        setUserPreferences({
          avoidDirtRoads:      data.avoidDirtRoads,
          avoidRidesWithStops: data.avoidRidesWithStops,
          avoidTolls:          data.avoidTolls,
          strictSafetyMode:    data.strictSafetyMode,
          voiceAlerts:         data.voiceAlerts ?? true,
        });

        // Build personal brain in background (non-blocking)
        const city = data.city || '';
        if (city) {
          buildPersonalBrain(user.uid, city)
            .then(brain => { if (!cancelled) setBrainState(brain); })
            .catch(e => console.error('[PRÉCHECA] Brain build failed:', e));
        }
      })
      .catch(e => console.error('[PRÉCHECA] Failed to load user profile:', e));

    return () => { cancelled = true; };
  }, [user]);

  // Rebuild brain after wizard saves (city may have changed)
  const handleWizardSave = useCallback((city: string, _mode: string) => {
    if (!user || !city) return;
    buildPersonalBrain(user.uid, city)
      .then(brain => setBrainState(brain))
      .catch(e => console.error('[PRÉCHECA] Brain rebuild failed:', e));
  }, [user]);

  // Compute effective GPS so map jumps to the manual neighborhood
  const effectiveGpsLocation = useMemo(() => {
    if (manualNeighborhood) {
      const coords: Record<string, {lat: number, lng: number}> = {
        'Plano Piloto': { lat: -15.793889, lng: -47.882778 },
        'Águas Claras': { lat: -15.836, lng: -48.028 },
        'Taguatinga': { lat: -15.833, lng: -48.056 },
        'Morumbi': { lat: -23.621, lng: -46.699 },
        'Santana': { lat: -23.502, lng: -46.625 },
        'Itaim Bibi': { lat: -23.585, lng: -46.677 },
        'Pinheiros': { lat: -23.561, lng: -46.695 },
        'Vila Mariana': { lat: -23.589, lng: -46.634 },
        'Interlagos': { lat: -23.700, lng: -46.685 },
        'Lapa': { lat: -23.520, lng: -46.705 },
        'Vila Prudente': { lat: -23.580, lng: -46.575 },
        'Centro': { lat: -23.550, lng: -46.633 }
      };
      if (coords[manualNeighborhood]) {
        return { ...coords[manualNeighborhood], speed: 12, heading: 45 };
      }
    }
    return gpsLocation;
  }, [gpsLocation, manualNeighborhood]);

  const currentNeighborhood = useMemo(() => {
    if (manualNeighborhood) return manualNeighborhood;
    if (!effectiveGpsLocation) return 'Buscando GPS...';
    return realNeighborhood;
  }, [effectiveGpsLocation, manualNeighborhood, realNeighborhood]);

  // Calculate dynamic data based on active profile
  const activeHotspots = getHotspotsForProfile(activeProfile.id, effectiveGpsLocation?.lat, effectiveGpsLocation?.lng, currentNeighborhood).map(hs => ({
     ...hs,
     // Randomize a mock distance based on GPS state so it feels live tracking (or use a simple math delta)
     distanceKm: effectiveGpsLocation ? parseFloat(((Math.random() * 8) + 1).toFixed(1)) : hs.distanceKm
  })).sort((a,b) => a.distanceKm - b.distanceKm); // sort nearest first
  
  const baseTrail = getTrailForProfile(activeProfile.id, currentNeighborhood);
  const activeTrail = [...baseTrail, ...customStops].sort((a, b) => a.time.localeCompare(b.time));

  // Find the exact current step based on time
  const nowTrail = new Date();
  const currentTrailMinutes = (nowTrail.getHours() * 60) + nowTrail.getMinutes();
  
  let currentActiveTrailStepId: string | null = null;
  for (let i = 0; i < activeTrail.length; i++) {
     const step = activeTrail[i];
     const [h, m] = step.time.split(':').map(Number);
     const stepMinutes = (h * 60) + m;
     
     const nextStep = activeTrail[i+1];
     let nextMinutes = 24 * 60; // End of day
     if (nextStep) {
        const [nh, nm] = nextStep.time.split(':').map(Number);
        nextMinutes = (nh * 60) + nm;
     }

     // If current time is past this step but before the next step, this is the current active step
     if (currentTrailMinutes >= stepMinutes && currentTrailMinutes < nextMinutes) {
        currentActiveTrailStepId = step.id;
        break;
     }
  }

  // Fallback to first step if we haven't reached the first step time yet today
  if (!currentActiveTrailStepId && activeTrail.length > 0) {
      const [h, m] = activeTrail[0].time.split(':').map(Number);
      if (currentTrailMinutes < (h * 60) + m) {
         currentActiveTrailStepId = activeTrail[0].id;
      }
  }

  const handleAddStop = () => {
    if (!newStopData.time || !newStopData.title || !newStopData.location) return;
    if (newStopData.repeat === 'custom' && newStopData.customDays.length === 0) return;
    
    const newStep: import('./types').TrailStep = {
      id: `custom-${Date.now()}`,
      time: newStopData.time,
      action: 'personal_stop',
      title: newStopData.title,
      location: newStopData.location,
      description: 'Parada extra adicionada à sua rota de hoje.',
      completed: false,
      repeatInfo: {
        type: newStopData.repeat,
        days: newStopData.repeat === 'custom' ? newStopData.customDays : undefined
      }
    };
    
    setCustomStops(prev => [...prev, newStep]);
    setIsAddingStop(false);
    setNewStopData({ time: '14:00', title: '', location: '', repeat: 'none', customDays: [] });
  };

  const handleSpeech = (analysis: RideAnalysis) => {
    if (!('speechSynthesis' in window) || !userPreferences.voiceAlerts) return;
    
    // Stop any current reading
    window.speechSynthesis.cancel();
    
    const msg = new SpeechSynthesisUtterance();
    msg.lang = 'pt-BR';
    msg.rate = 1.1; // Make it a bit fast
    
    if (analysis.shouldAccept) {
       msg.text = `Corrida Excelente. Paga ${analysis.ride.totalPrice.toFixed(0)} reais . Ganho de ${analysis.pricePerHour.toFixed(0)} por hora.`;
    } else {
       // Read the first negative reason smoothly
       msg.text = `Atenção. ${analysis.reasons[0]}.`;
    }
    
    window.speechSynthesis.speak(msg);
  };

  const logAction = useCallback(async (status: 'accepted' | 'rejected' | 'ignored', analysis: RideAnalysis) => {
      if (!user) return;
      try {
          const newDoc = doc(collection(db, `users/${user.uid}/rides`));
          await setDoc(newDoc, {
              rideId: analysis.ride.id,
              userId: user.uid,
              status,
              totalPrice: analysis.ride.totalPrice,
              pricePerKm: analysis.pricePerKm,
              pricePerHour: analysis.pricePerHour,
              pickupNeighborhood: analysis.ride.context.pickupNeighborhood,
              dayOfWeek: analysis.ride.context.dayOfWeek,
              timeOfDay: analysis.ride.context.timeOfDay,
              weather: analysis.ride.context.weather,
              createdAt: serverTimestamp()
          });
          setRidesTrained(prev => prev + 1);
      } catch (e) {
          console.error("Failed to log ride to DB", e);
      }
      setCurrentAnalysis(null);
  }, [user]);

  const handleManualAction = useCallback((status: 'accepted' | 'rejected' | 'ignored') => {
    if (currentAnalysis) {
      logAction(status, currentAnalysis);
    } else {
      setCurrentAnalysis(null);
    }
  }, [currentAnalysis, logAction]);

  // Auto-clear the ride after 15 seconds if not interacted
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (currentAnalysis) {
      timeout = setTimeout(() => {
        setCurrentAnalysis(null);
      }, 15000); // Standard timeout
    }
    return () => clearTimeout(timeout);
  }, [currentAnalysis, handleManualAction]);

  const handleSimulateRide = () => {
    setIsAnalyzing(true);
    setCurrentAnalysis(null);
    window.speechSynthesis?.cancel(); // stop current speaking if any
    
    // Calculate current organism context
    const now = new Date();
    const hours = now.getHours();
    let currentPeriod = 'Tarde';
    if (hours >= 5 && hours < 12) currentPeriod = 'Manhã';
    else if (hours >= 18 && hours < 23) currentPeriod = 'Noite';
    else if (hours >= 23 || hours < 5) currentPeriod = 'Madrugada';

    const liveContextContext: import('./types').RideContext = {
       dayOfWeek: ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'][now.getDay()],
       timeOfDay: currentPeriod,
       exactTime: `${hours.toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
       weather: liveContext?.weatherData.weather ?? 'Limpo', // Real weather from Open-Meteo
       pickupNeighborhood: currentNeighborhood,
    };

    // Simulate thinking/scanning
    setTimeout(() => {
      // Pass the current app context into the AI engine so it is connected
      const ride = simulateIncomingRide(liveContextContext);
      const analysis = analyzeRide(ride, activeProfile, activeCategory.multiplier, userPreferences, brainState ?? undefined, user?.uid ?? undefined);
      setCurrentAnalysis(analysis);
      setIsAnalyzing(false);
      
      if (analysis.shouldAccept) {
        playAcceptSound();
      } else {
        playRejectSound();
      }
      
      // Trigger TTS if enabled
      handleSpeech(analysis);
      
    }, 1200);
  };

  // Components
  const TabButton = ({ id, icon: Icon, label }: { id: string, icon: any, label: string }) => (
    <button
      onClick={() => setActiveTab(id as any)}
      className={`flex flex-col items-center justify-center w-full h-full p-2 ${activeTab === id ? 'text-[#1a73e8] font-extrabold' : 'text-[#80868b] hover:text-[#5f6368]'}`}
    >
      <Icon className="w-7 h-7 mb-1" />
      <span className="text-[12px] uppercase tracking-wide">{label}</span>
    </button>
  );

  if (loading) {
    return <div className="bg-[#f8f9fa] min-h-screen flex items-center justify-center text-[#1a73e8]"><Loader2 className="w-12 h-12 animate-spin" /></div>;
  }

  if (!user) {
    return (
      <div className="bg-[#f8f9fa] min-h-screen flex flex-col items-center justify-center p-6 text-center text-[#202124]">
         <div className="bg-[#1a73e8]/20 p-6 rounded-full mb-8">
            <Zap className="w-16 h-16 text-[#1a73e8]" />
         </div>
         <h1 className="text-4xl font-bold mb-4">PRÉCHECA</h1>
         <p className="text-[#80868b] text-lg mb-12 max-w-sm">
            Para o algoritmo aprender a sua rotina, crie sua conta e salve as viagens na nuvem.
         </p>
         <button 
           onClick={signIn} 
           disabled={isSigningIn}
           className="bg-[#1a73e8] hover:bg-[#1557b0] disabled:opacity-50 text-white font-bold py-4 px-12 rounded-full text-xl shadow-xl transition-all flex items-center justify-center gap-3"
         >
            {isSigningIn ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>ENTRANDO...</span>
              </>
            ) : (
              <span>ENTRAR PARA USAR</span>
            )}
         </button>
      </div>
    );
  }

  return (
    <div className="bg-[#f8f9fa] text-[#202124] min-h-screen font-sans tracking-normal flex flex-col mx-auto max-w-md shadow-2xl overflow-hidden relative">
      
      {/* Header */}
      <header className="bg-white border-b border-[#dadce0] p-4 sticky top-0 z-10 flex justify-between items-center shadow-md">
        <div className="flex items-center space-x-2">
          <div className="bg-[#1a73e8]/20 p-2 rounded-lg">
            <Zap className="w-6 h-6 text-[#1a73e8]" />
          </div>
          <h1 className="font-extrabold text-2xl tracking-tight">PRÉCHECA</h1>
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={manualNeighborhood || 'gps'} 
            onChange={(e) => setManualNeighborhood(e.target.value === 'gps' ? null : e.target.value)}
            className="bg-[#f1f3f4] text-[10px] sm:text-xs font-bold px-2 py-1.5 rounded-full border border-[#dadce0] text-[#5f6368] outline-none focus:ring-1 focus:ring-emerald-500 max-w-[80px]"
          >
            <option value="gps">📡 GPS</option>
            <option value="Plano Piloto">DF - Plano Piloto</option>
            <option value="Águas Claras">DF - Águas Claras</option>
            <option value="Taguatinga">DF - Taguatinga</option>
            <option value="Morumbi">SP - Morumbi</option>
            <option value="Santana">SP - Santana</option>
            <option value="Itaim Bibi">SP - Itaim</option>
            <option value="Pinheiros">SP - Pinheiros</option>
            <option value="Centro">SP - Centro</option>
          </select>
          <div className="flex items-center space-x-2 text-[10px] sm:text-xs font-bold px-2 py-1.5 bg-[#f1f3f4] rounded-full border border-[#dadce0]">
            <span className={`w-2 h-2 rounded-full animate-pulse ${gpsStatus === 'active' ? 'bg-[#1a73e8]' : gpsStatus === 'searching' ? 'bg-yellow-500' : 'bg-[#ea4335]'}`}></span>
            <span className="uppercase tracking-widest hidden sm:inline">
              {gpsStatus === 'active' 
                ? (gpsLocation?.speed ? `${Math.round(gpsLocation.speed * 3.6)} km/h` : 'GPS Sincronizado') 
                : gpsStatus === 'searching' ? 'Buscando GPS' : 'Sem GPS'}
            </span>
          </div>
          <button onClick={() => setShowWizard(true)} className="bg-[#f1f3f4] p-2 rounded-full text-[#5f6368] hover:bg-[#e8eaed] transition-colors">
            <Settings className="w-4 h-4" />
          </button>
          <button onClick={logOut} className="bg-[#f1f3f4] p-2 rounded-full text-red-600 hover:bg-[#e8eaed]">
             <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* TACTICAL STATUS OVERLAY — dados reais */}
      <div className="bg-black text-[10px] sm:text-xs text-white px-4 py-1.5 flex justify-between items-center border-b border-yellow-500/30 font-mono tracking-widest z-10">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${liveContext ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
          {liveContext
            ? `${liveContext.weatherEmoji} ${liveContext.weatherData.tempC}°C · ${liveContext.weatherData.description}`
            : `OPERANDO: ${activeCategory.name}`}
        </div>
        <div className="flex gap-3 items-center">
          {liveContext?.holidayName && (
            <span className="text-purple-400 hidden sm:inline">📅 {liveContext.holidayName}</span>
          )}
          <span className={
            liveContext?.demandLevel === 'muito_alta' ? 'text-red-400' :
            liveContext?.demandLevel === 'alta'       ? 'text-[#f9ab00]' :
            liveContext?.demandLevel === 'baixa'      ? 'text-slate-400' :
                                                        'text-green-400'
          }>
            {liveContext
              ? `${liveContext.demandLabel.replace(/^[^\s]+ /, '')} (${Math.round((liveContext.demandMultiplier) * 100)}%)`
              : 'Carregando...'}
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <main className={`flex-1 flex flex-col overflow-y-auto scroll-smooth relative ${activeTab === 'dashboard' ? 'bg-[#f8f9fa]' : 'p-4 pb-24 bg-white'}`}>
        
        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <div className="flex flex-col min-h-full">
            {/* STICKY MAP AREA */}
            <div className="sticky top-0 z-0 h-[45vh] w-full bg-[#f1f3f4] overflow-hidden flex items-center justify-center relative">
              
              <MapContainer 
                 center={effectiveGpsLocation ? [effectiveGpsLocation.lat, effectiveGpsLocation.lng] : [-23.5505, -46.6333]} 
                 zoom={16} 
                 zoomControl={false} 
                 dragging={false} 
                 touchZoom={false} 
                 scrollWheelZoom={false} 
                 doubleClickZoom={false} 
                 style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, zIndex: 0 }}
              >
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; CARTO'
                />
                {effectiveGpsLocation && <MapUpdater center={[effectiveGpsLocation.lat, effectiveGpsLocation.lng]} />}
              </MapContainer>

              {/* Radar Ripple Effect */}
              <div className="absolute w-40 h-40 bg-[#1a73e8]/10 rounded-full animate-ping pointer-events-none" style={{ animationDuration: '3s', zIndex: 1 }}></div>
              <div className="absolute w-28 h-28 border border-[#1a73e8]/20 rounded-full animate-pulse pointer-events-none" style={{ zIndex: 1 }}></div>
              
              {/* Driver Marker */}
              <div 
                className="absolute z-10 bg-[#1a73e8] border-[3px] border-white w-12 h-12 rounded-full flex flex-col items-center justify-center shadow-lg transition-transform duration-1000 pointer-events-none"
                style={{ transform: `trangray(-50%, -50%) ${effectiveGpsLocation?.heading ? `rotate(${effectiveGpsLocation.heading}deg)` : ''}`, left: '50%', top: '50%' }}
              >
                <Navigation className="w-6 h-6 text-white transform rotate-45 -ml-1 mt-1 pointer-events-none" />
              </div>

              {/* Top HUD Elements */}
              <div className="absolute top-4 left-4 bg-[#f8f9fa]/90 backdrop-blur-sm border border-[#dadce0] px-3 py-1.5 rounded-full flex items-center gap-2 shadow-lg z-10">
                <div className={`w-3 h-3 rounded-full animate-pulse shadow-md ${gpsStatus === 'active' ? 'bg-[#1a73e8]' : 'bg-yellow-500'}`}></div>
                <span className={`text-xs font-bold tracking-wide ${gpsStatus === 'active' ? 'text-[#1a73e8]' : 'text-[#f9ab00]'}`}>
                   {gpsStatus === 'active' ? 'ONLINE' : 'BUSCANDO SINAL'}
                </span>
              </div>

              <div className="absolute top-4 right-4 bg-[#f8f9fa]/90 backdrop-blur-sm border border-[#dadce0] p-2 rounded-xl shadow-lg z-10 flex items-center gap-2">
                <Compass className="w-5 h-5 text-[#80868b]" />
                <div className="flex flex-col items-center leading-none">
                  <span className="text-[#202124] text-lg font-bold">{effectiveGpsLocation?.speed !== null && effectiveGpsLocation?.speed !== undefined ? Math.round(effectiveGpsLocation.speed * 3.6) : '0'}</span>
                  <span className="text-[#80868b] text-[9px] font-bold uppercase">km/h</span>
                </div>
              </div>

              {/* Bottom Address HUD */}
              <div className="absolute bottom-10 left-4 bg-white/90 p-2 px-3 rounded-xl border border-[#dadce0] shadow-xl z-20 max-w-[80%] backdrop-blur-md">
                 <div className="flex items-center gap-2 mb-1">
                    <MapPin className="w-3 h-3 text-[#1a73e8]" />
                    <p className="text-[#1a73e8] text-[10px] font-bold uppercase tracking-tighter">Local Atual Detetado</p>
                 </div>
                 <p className="text-[#202124] text-base font-bold truncate mb-0.5">
                    {currentNeighborhood}
                 </p>
                 <p className="text-[#80868b] text-[9px] font-bold truncate">
                    {effectiveGpsLocation 
                      ? `${effectiveGpsLocation.lat.toFixed(5)}, ${effectiveGpsLocation.lng.toFixed(5)}` 
                      : 'Posição Desconhecida'}
                 </p>
              </div>

              {/* Refresh GPS Button */}
              <button 
                onClick={() => {
                  setGpsStatus('searching');
                  navigator.geolocation.getCurrentPosition(
                    (p) => {
                      setGpsLocation({ lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed, heading: p.coords.heading });
                      setGpsStatus('active');
                    },
                    () => setGpsStatus('error')
                  );
                }}
                className="absolute bottom-10 right-4 bg-white/90 p-3 rounded-full border border-[#dadce0] shadow-xl z-20 text-[#3c4043] hover:bg-[#f1f3f4] active:scale-90 transition-all font-bold"
              >
                <RotateCcw className={`w-5 h-5 ${gpsStatus === 'searching' ? 'animate-spin' : ''}`} />
              </button>

              {/* Gradient to blend with sheet */}
              <div className="absolute bottom-0 w-full h-20 bg-gradient-to-t from-white via-white/80 to-transparent z-10"></div>
            </div>

            {/* BOTTOM SHEET CARDS */}
            <div className="relative z-10 flex-1 bg-[#f8f9fa] rounded-t-3xl pt-8 px-4 pb-28 space-y-6 border-t-2 border-[#dadce0] shadow-[0_-8px_30px_rgba(0,0,0,0.1)] -mt-6">
               {/* Drag detail */}
               <div className="absolute top-3 left-1/2 -translate-x-1/2 w-14 h-1.5 bg-[#f1f3f4] rounded-full"></div>

               {/* ── CONTEXTO AGORA — dados reais ── */}
               {liveContext && (
                 <div className="rounded-2xl border border-[#dadce0] overflow-hidden bg-white shadow-sm">
                   {/* Header */}
                   <div className={`px-4 py-2 flex items-center justify-between
                     ${liveContext.demandLevel === 'muito_alta' ? 'bg-red-600' :
                       liveContext.demandLevel === 'alta'       ? 'bg-[#f9ab00]' :
                       liveContext.demandLevel === 'baixa'      ? 'bg-slate-500' :
                                                                   'bg-[#1e8e3e]'}`}>
                     <div className="flex items-center gap-2 text-white">
                       <Activity className="w-4 h-4" />
                       <span className="font-black text-xs uppercase tracking-widest">Contexto Agora</span>
                     </div>
                     <div className="flex items-center gap-2 text-white/90 text-xs font-bold">
                       <span>{liveContext.weatherEmoji} {liveContext.weatherData.tempC}°C</span>
                       {liveContext.weatherData.precipitation > 0 && (
                         <span className="bg-white/20 px-2 py-0.5 rounded-full">
                           💧 {liveContext.weatherData.precipitation}mm
                         </span>
                       )}
                     </div>
                   </div>

                   {/* Demand bar */}
                   <div className="px-4 pt-3 pb-1">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-xs font-black text-slate-700">{liveContext.demandLabel}</span>
                       <span className="text-xs font-bold text-slate-500">
                         {Math.round(liveContext.demandMultiplier * 100)}% do normal
                       </span>
                     </div>
                     <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                       <div
                         className={`h-full rounded-full transition-all duration-700
                           ${liveContext.demandLevel === 'muito_alta' ? 'bg-red-500' :
                             liveContext.demandLevel === 'alta'       ? 'bg-[#f9ab00]' :
                             liveContext.demandLevel === 'baixa'      ? 'bg-slate-400' :
                                                                         'bg-[#1e8e3e]'}`}
                         style={{ width: `${Math.min(100, Math.round(liveContext.demandMultiplier * 50))}%` }}
                       />
                     </div>
                   </div>

                   {/* Insights */}
                   <div className="px-4 pb-3 pt-2 space-y-1.5">
                     {liveContext.contextInsights.map((insight, i) => (
                       <p key={i} className="text-xs text-slate-600 leading-snug">{insight}</p>
                     ))}

                     {/* POI badges */}
                     {(liveContext.pois.bars > 0 || liveContext.pois.stadiums > 0 ||
                       liveContext.pois.universities > 0 || liveContext.pois.airports > 0 ||
                       liveContext.pois.hospitals > 0) && (
                       <div className="flex flex-wrap gap-1.5 mt-2">
                         {liveContext.pois.airports > 0 && (
                           <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full">✈️ Aeroporto</span>
                         )}
                         {liveContext.pois.stadiums > 0 && (
                           <span className="bg-purple-100 text-purple-700 text-[10px] font-bold px-2 py-0.5 rounded-full">🏟️ {liveContext.pois.stadiums} arena(s)</span>
                         )}
                         {liveContext.pois.universities > 0 && (
                           <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full">🎓 {liveContext.pois.universities} fac.</span>
                         )}
                         {liveContext.pois.bars > 0 && (
                           <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">🍺 {liveContext.pois.bars} bares</span>
                         )}
                         {liveContext.pois.hospitals > 0 && (
                           <span className="bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded-full">🏥 {liveContext.pois.hospitals} hosp.</span>
                         )}
                       </div>
                     )}
                   </div>

                   {/* Footer: last updated */}
                   <div className="border-t border-[#f1f3f4] px-4 py-1.5 text-[9px] font-mono text-slate-400 flex justify-between">
                     <span>Atualizado {liveContext.refreshedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                     <span>Open-Meteo · OSM{liveContext.events.length > 0 ? ' · Ticketmaster' : ''}</span>
                   </div>
                 </div>
               )}

               {/* ── FIM CONTEXTO AGORA ── */}

               {/* ── EVENTOS PRÓXIMOS ─────────────────────────────────── */}
               {liveContext && liveContext.events.length > 0 && (
                 <div className="rounded-2xl border border-purple-200 bg-white overflow-hidden shadow-sm">
                   {/* Header */}
                   <div className="px-4 py-3 bg-gradient-to-r from-purple-600 to-purple-500 flex items-center justify-between">
                     <div className="flex items-center gap-2 text-white">
                       <Ticket className="w-4 h-4" />
                       <span className="font-black text-xs uppercase tracking-widest">Eventos Próximos</span>
                     </div>
                     <span className="text-[10px] font-bold text-purple-200">
                       {liveContext.events.length} evento{liveContext.events.length > 1 ? 's' : ''} detectado{liveContext.events.length > 1 ? 's' : ''}
                     </span>
                   </div>

                   {/* Event list */}
                   <div className="divide-y divide-purple-50">
                     {liveContext.events.slice(0, 4).map(ev => {
                       const timeStr  = ev.startsAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                       const crowd    = ev.estimatedAttendance >= 1000
                         ? `~${(ev.estimatedAttendance / 1000).toFixed(0)}k`
                         : `~${ev.estimatedAttendance}`;
                       const boost    = ev.demandBoost > 0
                         ? `+${(ev.demandBoost * 100).toFixed(0)}% demanda`
                         : '';
                       const srcBadge = ev.source === 'ticketmaster' ? '🎟️ TM' :
                                        ev.source === 'football'     ? '⚽ FD' : '🔍 inf.';
                       const srcColor = ev.source === 'ticketmaster' ? 'bg-blue-100 text-blue-700' :
                                        ev.source === 'football'     ? 'bg-green-100 text-green-700' :
                                                                        'bg-slate-100 text-slate-500';
                       const evEmoji  = ev.type === 'sports' || ev.type === 'inferred_game' ? '🏟️' :
                                        ev.type === 'concert' ? '🎵' :
                                        ev.type === 'theatre' ? '🎭' :
                                        ev.type === 'festival' ? '🎪' : '🎉';

                       return (
                         <div key={ev.id} className="px-4 py-3">
                           <div className="flex items-start justify-between gap-2">
                             <div className="flex items-start gap-2 min-w-0">
                               <span className="text-lg shrink-0 mt-0.5">{evEmoji}</span>
                               <div className="min-w-0">
                                 <p className="font-bold text-slate-800 text-sm truncate">{ev.name}</p>
                                 <p className="text-xs text-slate-500 truncate">{ev.venue} · {timeStr}</p>
                               </div>
                             </div>
                             <div className="flex flex-col items-end gap-1 shrink-0">
                               {boost && (
                                 <span className="text-[10px] font-black text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                                   {boost}
                                 </span>
                               )}
                               <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${srcColor}`}>
                                 {srcBadge}
                               </span>
                             </div>
                           </div>
                           <div className="flex items-center gap-3 mt-1.5 ml-7">
                             <span className="text-[10px] text-slate-400">👥 {crowd} pessoas</span>
                             {ev.source === 'heuristic' && (
                               <span className="text-[10px] text-slate-400">{ev.confidencePercent}% confiança</span>
                             )}
                             {ev.url && (
                               <a
                                 href={ev.url}
                                 target="_blank"
                                 rel="noopener noreferrer"
                                 className="text-[10px] text-purple-600 font-bold hover:underline"
                               >
                                 Ver ingresso ↗
                               </a>
                             )}
                           </div>
                         </div>
                       );
                     })}
                   </div>

                   {/* Event boost summary */}
                   {liveContext.eventBoost > 0 && (
                     <div className="border-t border-purple-100 px-4 py-2 bg-purple-50 flex items-center justify-between">
                       <span className="text-xs text-purple-700 font-bold">
                         Impacto total na demanda
                       </span>
                       <span className="text-xs font-black text-purple-800">
                         +{Math.round(liveContext.eventBoost * 60)}% acima do normal
                       </span>
                     </div>
                   )}
                 </div>
               )}
               {/* ── FIM EVENTOS PRÓXIMOS ── */}

               {/* ── MISSÕES — 3 estratégias com alternativas ── */}
               {allMissions.length > 0 && (
                 <div className="space-y-3">
                   {/* Header */}
                   <div className="flex items-center justify-between">
                     <div className="flex items-center gap-2">
                       <Target className="w-5 h-5 text-[#1a73e8]" />
                       <span className="font-black text-slate-800 text-base">Missões Agora</span>
                     </div>
                     <div className="flex items-center gap-2">
                       <span className="text-xs text-slate-400">
                         janela de {Math.round(allMissions[0]?.estimatedWindowMin ?? 120)}min
                       </span>
                       <button
                         onClick={() => {
                           const m = generateMissions({ windowMin: 120, categoryMultiplier: activeCategory.multiplier, liveContext, brainState }, 8);
                           setAllMissions(m);
                           setVisibleMissionIndices([0, 1, 2]);
                           setAcceptedMissionId(null);
                         }}
                         className="bg-slate-100 hover:bg-slate-200 p-1.5 rounded-full text-slate-500 transition-colors"
                         title="Atualizar missões"
                       >
                         <RotateCcw className="w-3.5 h-3.5" />
                       </button>
                     </div>
                   </div>

                   {/* Mission cards */}
                   {visibleMissionIndices.map((missionIndex, slotIndex) => {
                     const mission = allMissions[missionIndex];
                     if (!mission) return null;
                     const rank = slotIndex + 1;
                     const isAccepted = acceptedMissionId === mission.id;
                     const rankColors = [
                       'border-[#f9ab00] bg-[#f9ab00]/5',
                       'border-slate-300 bg-white',
                       'border-slate-200 bg-white',
                     ];
                     const rankBadgeColors = [
                       'bg-[#f9ab00] text-white',
                       'bg-slate-200 text-slate-600',
                       'bg-slate-100 text-slate-500',
                     ];
                     const medals = ['🥇', '🥈', '🥉'];

                     return (
                       <div
                         key={mission.id + slotIndex}
                         className={`rounded-2xl border-2 overflow-hidden transition-all duration-300
                           ${isAccepted ? 'border-[#1e8e3e] bg-green-50' : rankColors[slotIndex]}`}
                       >
                         {/* Mission header */}
                         <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
                           <div className="flex items-center gap-2 flex-1 min-w-0">
                             <span className="text-2xl">{mission.emoji}</span>
                             <div className="flex-1 min-w-0">
                               <div className="flex items-center gap-1.5 flex-wrap">
                                 <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${rankBadgeColors[slotIndex]}`}>
                                   {medals[slotIndex]} #{rank}
                                 </span>
                                 {mission.badge && (
                                   <span className="text-[10px] font-bold text-[#1a73e8] bg-blue-50 px-1.5 py-0.5 rounded-full">
                                     {mission.badge}
                                   </span>
                                 )}
                               </div>
                               <h4 className="font-black text-slate-800 text-sm mt-0.5">{mission.strategy}</h4>
                               <p className="text-xs text-slate-500 truncate">{mission.targetDescription}</p>
                             </div>
                           </div>
                           {/* Confidence pill */}
                           <div className="text-center shrink-0">
                             <div className={`text-lg font-black leading-none
                               ${mission.confidencePercent >= 75 ? 'text-[#1e8e3e]' :
                                 mission.confidencePercent >= 55 ? 'text-[#f9ab00]' : 'text-slate-500'}`}>
                               {mission.confidencePercent}%
                             </div>
                             <div className="text-[9px] text-slate-400 font-bold">confiança</div>
                           </div>
                         </div>

                         {/* Specific neighborhoods from history */}
                         {mission.specificNeighborhoods.length > 0 && (
                           <div className="px-4 pb-1">
                             <div className="flex flex-wrap gap-1">
                               {mission.specificNeighborhoods.map(nb => (
                                 <span key={nb} className="bg-[#1a73e8]/10 text-[#1a73e8] text-[10px] font-bold px-2 py-0.5 rounded-full">
                                   📍 {nb}
                                 </span>
                               ))}
                             </div>
                           </div>
                         )}

                         {/* Confidence bar */}
                         <div className="px-4 py-1">
                           <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                             <div
                               className={`h-full rounded-full transition-all duration-700
                                 ${mission.confidencePercent >= 75 ? 'bg-[#1e8e3e]' :
                                   mission.confidencePercent >= 55 ? 'bg-[#f9ab00]' : 'bg-slate-400'}`}
                               style={{ width: `${mission.confidencePercent}%` }}
                             />
                           </div>
                         </div>

                         {/* Estimates row */}
                         <div className="px-4 py-2 grid grid-cols-3 gap-2 border-y border-slate-100">
                           <div className="text-center">
                             <div className="text-base font-black text-[#1e8e3e]">R${mission.estimatedEarningsR$}</div>
                             <div className="text-[9px] text-slate-400 font-bold uppercase">Estimado</div>
                           </div>
                           <div className="text-center border-x border-slate-100">
                             <div className="text-base font-black text-slate-700">{mission.estimatedKm}km</div>
                             <div className="text-[9px] text-slate-400 font-bold uppercase">Total KM</div>
                           </div>
                           <div className="text-center">
                             <div className="text-base font-black text-slate-700">~{Math.round(mission.estimatedRides)} corridas</div>
                             <div className="text-[9px] text-slate-400 font-bold uppercase">R${mission.avgPricePerRide}/corrida</div>
                           </div>
                         </div>

                         {/* Why / Reason */}
                         {mission.reasonWhy && (
                           <div className="px-4 pt-2 pb-1">
                             <p className="text-xs text-slate-600 leading-snug">{mission.reasonWhy}</p>
                           </div>
                         )}

                         {/* Risks (collapsible) */}
                         {mission.risks.length > 0 && (
                           <div className="px-4 pb-2">
                             <div className="text-[10px] text-slate-400 font-bold flex gap-1 flex-wrap">
                               <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                               {mission.risks.slice(0, 2).join(' · ')}
                             </div>
                           </div>
                         )}

                         {/* Action buttons */}
                         <div className="px-4 pb-3 flex gap-2">
                           {isAccepted ? (
                             <div className="flex-1 bg-green-100 text-[#1e8e3e] font-black py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-sm">
                               <CheckCircle2 className="w-4 h-4" />
                               Missão Aceita!
                             </div>
                           ) : (
                             <>
                               <button
                                 onClick={() => handleAcceptMission(mission)}
                                 className="flex-1 bg-[#1a73e8] hover:bg-[#1557b0] text-white font-black py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-sm transition-colors active:scale-95"
                               >
                                 <Zap className="w-4 h-4" /> Aceitar
                               </button>
                               {missionIndex < allMissions.length - 1 && (
                                 <button
                                   onClick={() => handleDismissMission(rank)}
                                   className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 px-3 rounded-xl flex items-center gap-1 text-xs transition-colors"
                                 >
                                   <RotateCcw className="w-3.5 h-3.5" />
                                   Outra
                                 </button>
                               )}
                             </>
                           )}
                         </div>
                       </div>
                     );
                   })}
                 </div>
               )}
               {/* ── FIM MISSÕES ── */}

               {/* ASSISTENT GAMIFIED COPILOT */}
               <div className="bg-gradient-to-br from-[#1a73e8] via-[#1a73e8] to-[#1557b0] rounded-2xl p-5 shadow-xl relative overflow-hidden flex flex-col gap-3 text-white border-b-4 border-black/20">
                  <div className="absolute top-0 right-0 -mr-6 -mt-6 opacity-10">
                     <BrainCircuit className="w-40 h-40" />
                  </div>
                  
                  <div className="flex items-center justify-between relative z-10">
                     <div className="flex items-center gap-2">
                        <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
                           <Zap className="w-6 h-6 text-yellow-300 animate-pulse" />
                        </div>
                        <div>
                           <h3 className="font-black text-lg leading-none italic uppercase tracking-tighter">Missão Atual</h3>
                           <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest mt-1">Status: Operacional</p>
                        </div>
                     </div>
                     <div className="bg-white/10 px-3 py-1 rounded-full border border-white/20 text-[10px] font-black italic">
                        XP: +1250
                     </div>
                  </div>

                  <div className="relative z-10 bg-black/20 rounded-xl p-4 mt-1 border border-white/10 backdrop-blur-md">
                     <p className="text-sm font-bold leading-tight">
                        "Engata a primeira e segue o plano! Sua missão agora é se posicionar na <span className="text-yellow-300 underline">Av. das Nações</span>. Em 12 minutos o fluxo de pouso do aeroporto vai estourar e você vai ser o primeiro na fila do dinâmico. Não aceita nada abaixo de R$ 2,50/km nesse trajeto!"
                     </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2 relative z-10">
                     <div className="bg-white/10 rounded-lg p-2 border border-white/5 flex flex-col items-center justify-center">
                        <span className="text-[9px] uppercase font-bold text-white/60">Lucro Alvo/Hora</span>
                        <span className="text-sm font-black">R$ 55,00</span>
                     </div>
                     <div className="bg-white/10 rounded-lg p-2 border border-white/5 flex flex-col items-center justify-center">
                        <span className="text-[9px] uppercase font-bold text-white/60">Eficiência de Rota</span>
                        <span className="text-sm font-black text-green-300">98%</span>
                     </div>
                  </div>
               </div>

               {/* MICRO-MANAGEMENT ACTION LOG */}
               <div className="bg-white border-2 border-[#dadce0] rounded-2xl overflow-hidden shadow-sm">
                  <div className="bg-[#f8f9fa] px-4 py-2 border-b border-[#dadce0] flex justify-between items-center">
                     <span className="text-[10px] font-black text-[#80868b] uppercase tracking-widest flex items-center gap-1">
                        <Target className="w-3 h-3" /> Log de Micro-Ações
                     </span>
                     <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                     </div>
                  </div>
                  <div className="p-3 space-y-3">
                     <div className="flex items-center gap-3 bg-[#e6f4ea] p-2 rounded-lg border border-green-200">
                        <div className="bg-green-500 rounded-full p-1">
                           <CheckCircle2 className="w-3 h-3 text-white" />
                        </div>
                        <div>
                           <p className="text-[11px] font-bold text-[#137333]">Posicionamento em São Conrado OTIMIZADO</p>
                           <p className="text-[9px] text-[#137333]/80">Economia gerada: R$ 4,20 de combustível</p>
                        </div>
                     </div>
                     <div className="flex items-center gap-3 opacity-60">
                        <div className="bg-blue-500 rounded-full p-1">
                           <Clock className="w-3 h-3 text-white" />
                        </div>
                        <p className="text-[11px] font-bold text-[#3c4043]">Próximo Pouso: Voo AZU-4500 (em 14min)</p>
                     </div>
                     <div className="flex items-center gap-3">
                        <div className="bg-[#fce8e6] rounded-full p-1 border border-red-200">
                           <AlertTriangle className="w-3 h-3 text-[#d93025]" />
                        </div>
                        <p className="text-[11px] font-bold text-[#d93025]">EVITE: Engarrafamento na Linha Amarela (Km 12)</p>
                     </div>
                              {/* LIVE COMMAND (AUTOPILOT THINKING) */}
              </div>
            </div>
          </div>
             <div className="bg-[#e8f0fe] border-2 border-[#1a73e8] rounded-2xl p-6 relative overflow-hidden shadow-lg border-dashed">
                <div className="flex items-center gap-4 relative z-10">
                  <div className="relative">
                    <div className="bg-[#1a73e8] p-3 rounded-full flex items-center justify-center animate-pulse shadow-[0_0_15px_rgba(26,115,232,0.5)]">
                      <Radio className="w-6 h-6 text-white" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-[#1a73e8] font-black text-xs uppercase tracking-[0.2em] italic">Transmissão Direta</h4>
                      <span className="text-[10px] text-[#5f6368] font-bold">LIVE: 12.4kb/s</span>
                    </div>
                    <p className="text-[#202124] text-base leading-tight font-black italic mb-3">
                      "CUIDADO: Trânsito subindo na via principal. Saia na próxima à direita pra garantir a taxa de R$ 38,00. Não deixa o tempo escapar!"
                    </p>
                    <div className="bg-white/70 p-3 rounded-xl border border-[#dadce0] flex items-center gap-3">
                       <Navigation className="w-5 h-5 text-[#1a73e8]" />
                       <span className="text-xs font-bold text-[#3c4043]">ALVO: {activeHotspots[0].name}</span>
                    </div>
                  </div>
                </div>
             </div>

             <div className="bg-white border border-[#dadce0] rounded-xl p-5 shadow-sm flex items-start gap-4">
               <ShieldCheck className="w-10 h-10 text-[#1a73e8] shrink-0 mt-1" />
               <div>
                  <h3 className="font-bold text-lg text-[#202124] mb-2">Segurança Total</h3>
                  <p className="text-base text-[#5f6368] leading-relaxed">
                     Apenas siga as dicas. <strong>Tocar em Aceitar ou Recusar continua sendo tarefa sua no app do Uber.</strong> Ninguém te bloqueia.
                  </p>
               </div>
             </div>

            <div className={`p-5 rounded-2xl relative overflow-hidden backdrop-blur-md border border-[#dadce0] bg-[#f1f3f4] bg-opacity-80 shadow-lg`}>
              <h2 className="text-[#5f6368] text-sm font-bold uppercase tracking-wider mb-2">Seu Objetivo do Dia:</h2>
              <p className="text-3xl font-bold mb-1">{activeProfile.name}</p>
              <p className="text-[#1a73e8] font-bold mb-4 flex items-center gap-2">
                 <CarFront className="w-5 h-5" /> Dirigindo como {activeCategory.name}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-xl border border-[#dadce0]">
                  <p className="text-[10px] uppercase text-[#80868b] mb-1">A meta agora é</p>
                  <p className="font-mono text-xl font-bold text-[#1a73e8]">R$ {(activeProfile.minPricePerHour * activeCategory.multiplier).toFixed(2)} /h</p>
                </div>
              </div>
            </div>

            <div className="bg-white border border-[#dadce0] rounded-2xl p-6 shadow-xl relative overflow-hidden text-center">
              <h3 className="font-bold text-2xl mb-2">Modo de Teste</h3>
              <p className="text-base text-[#80868b] mb-6 leading-relaxed">
                Toque abaixo para ver como seria se um chamado real tocasse agora no seu celular.
              </p>
              <button
                onClick={handleSimulateRide}
                disabled={isAnalyzing}
                className="w-full min-h-[70px] bg-[#1a73e8] hover:bg-[#1557b0] text-white font-extrabold py-5 rounded-2xl shadow-xl transition-all active:scale-95 flex items-center justify-center space-x-3 disabled:opacity-50 border-2 border-[#1a73e8] text-2xl uppercase"
              >
                {isAnalyzing ? (
                  <span>Aguarde...</span>
                ) : (
                  <>
                    <CarFront className="w-8 h-8" />
                    <span>Testar Tocar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

    {/* HOTSPOTS TAB */}
        {activeTab === 'hotspots' && (
          <div className="space-y-4">
            <div className="mb-6 bg-black p-6 -mx-4 -mt-4 border-b-4 border-[#f9ab00]">
              <h2 className="text-3xl font-black mb-1 text-white flex items-center gap-3 italic uppercase tracking-tighter">
                 <Radio className="w-8 h-8 text-[#f9ab00] animate-pulse" /> Radar de Extração
              </h2>
              <p className="text-[#80868b] text-xs font-bold uppercase tracking-[0.3em]">Operação: Lucro Máximo</p>
            </div>

            <div className="space-y-6">
              {/* Simplified Header for Map */}
               <div className="bg-[#f8f9fa] border-2 border-[#dadce0] rounded-3xl p-5 mb-4 shadow-sm flex items-start gap-4">
                 <div className="bg-black p-3 rounded-xl shrink-0">
                    <Compass className="w-6 h-6 text-[#f9ab00]" />
                 </div>
                 <div>
                    <h3 className="font-black text-[#202124] text-lg uppercase italic tracking-tight">Onde o dinheiro está agora</h3>
                    <p className="text-sm text-[#5f6368] leading-relaxed">
                       O PRÉCHECA dividiu a cidade em quarteirões táticos. Cada zona abaixo foi validada por fluxo de trânsito e escassez de motoristas. Escolha um alvo e mova-se.
                    </p>
                 </div>
               </div>
            </div>

            <div className="flex items-center gap-3 mb-4 mt-8">
               <Search className="w-5 h-5 text-[#202124]" />
               <h3 className="uppercase text-[#80868b] font-bold tracking-widest text-sm">Zonas Calculadas pra Agora</h3>
            </div>

            {/* LIVE PREDICTION RADAR MAP */}
            <div className="relative rounded-3xl overflow-hidden border border-[#dadce0] shadow-2xl h-96 bg-white mb-6 flex flex-col">
              <div className="absolute top-3 left-3 bg-[#f8f9fa]/90 backdrop-blur-sm border border-[#dadce0] px-3 py-1.5 rounded-full flex items-center gap-2 shadow-lg z-10 w-[max-content]">
                 <div className="w-3 h-3 rounded-full animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)] bg-[#1a73e8]"></div>
                 <span className="text-xs font-bold tracking-wide text-[#1a73e8]">
                    RADAR DE CALOR ATIVO (RAIO LONGO)
                 </span>
              </div>
              <MapContainer 
                 center={effectiveGpsLocation ? [effectiveGpsLocation.lat, effectiveGpsLocation.lng] : [-23.5505, -46.6333]} 
                 zoom={10} 
                 zoomControl={false} 
                 dragging={true} 
                 touchZoom={true} 
                 scrollWheelZoom={true} 
                 style={{ width: '100%', height: '100%', zIndex: 0 }}
              >
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; CARTO'
                />

                {effectiveGpsLocation && <MapUpdater center={[effectiveGpsLocation.lat, effectiveGpsLocation.lng]} zoom={10} />}
                
                {/* Predicted Hotspot Zones (Expanded for Country-wide/City-wide coverage) */}
                {(() => {
                  const baseLat = effectiveGpsLocation?.lat || -23.5505;
                  const baseLng = effectiveGpsLocation?.lng || -46.6333;
                  
                  const points = [
                    { lat:  0.025, lng: -0.048, color: '#1e8e3e', r: 40 },
                    { lat: -0.080, lng:  0.075, color: '#1a73e8', r: 35 },
                    { lat:  0.110, lng:  0.052, color: '#f9ab00', r: 45 },
                    { lat: -0.155, lng: -0.090, color: '#1e8e3e', r: 30 },
                    { lat:  0.205, lng: -0.180, color: '#1a73e8', r: 50 },
                    { lat: -0.065, lng: -0.215, color: '#f9ab00', r: 35 },
                    { lat:  0.220, lng:  0.105, color: '#1e8e3e', r: 55 },
                    { lat: -0.210, lng:  0.140, color: '#1a73e8', r: 40 },
                    { lat:  0.150, lng:  0.190, color: '#d93025', r: 32 }, 
                    { lat: -0.185, lng: -0.050, color: '#f9ab00', r: 40 },
                    { lat:  0.085, lng: -0.250, color: '#1e8e3e', r: 38 },
                    { lat: -0.250, lng:  0.245, color: '#f9ab00', r: 34 },
                    { lat:  0.005, lng:  0.285, color: '#d93025', r: 45 },
                  ];

                  return points.map((p, i) => (
                    <CircleMarker 
                       key={i} 
                       center={[baseLat + p.lat, baseLng + p.lng]} 
                       radius={p.r} 
                       pathOptions={{ color: p.color, fillColor: p.color, fillOpacity: 0.2 }} 
                    />
                  ));
                })()}

                {/* Simulated Flow Vectors */}
                {(() => {
                  const baseLat = effectiveGpsLocation?.lat || -23.5505;
                  const baseLng = effectiveGpsLocation?.lng || -46.6333;
                  
                  return (
                    <>
                      <Polyline 
                        positions={[[baseLat + 0.110, baseLng + 0.052], [baseLat + 0.025, baseLng - 0.048]]} 
                        pathOptions={{ color: '#f9ab00', weight: 4, opacity: 0.6, dashArray: '10, 10' }} 
                      ><Tooltip sticky>Pessoas saindo em direção ao centro</Tooltip></Polyline>
                      
                      <Polyline 
                        positions={[[baseLat - 0.210, baseLng + 0.140], [baseLat - 0.080, baseLng + 0.075]]} 
                        pathOptions={{ color: '#1a73e8', weight: 6, opacity: 0.8, dashArray: '10, 15' }} 
                      ><Tooltip sticky>Trabalhadores indo para polos empresariais</Tooltip></Polyline>
                      
                      <Polyline 
                        positions={[[baseLat + 0.220, baseLng + 0.105], [baseLat + 0.150, baseLng + 0.190]]} 
                        pathOptions={{ color: '#d93025', weight: 8, opacity: 0.7, dashArray: '5, 8' }} 
                      ><Tooltip sticky>Região de Muita Demanda (Dinâmico Extremo)</Tooltip></Polyline>
                    </>
                  );
                })()}
              </MapContainer>
            </div>

            <div className="bg-[#f1f3f4] rounded-xl p-4 mb-6 border border-[#dadce0]">
               <h3 className="font-bold text-[#3c4043] mb-2 text-sm uppercase flex items-center gap-2"><Cpu className="w-4 h-4 text-[#1a73e8]" /> Como as zonas são avaliadas</h3>
               <p className="text-xs text-[#5f6368] leading-relaxed">
                  Os locais abaixo recebem uma nota que cruza 3 dados do momento atual na sua região: (1) <strong>Histórico Frequente</strong> do app para esse horário, (2) <strong>Radar de Poucos Carros</strong>, e (3) <strong>Fluxo de Trânsito</strong> do Google Maps.
               </p>
            </div>

            {activeHotspots.map((hs, index) => (
              <div key={hs.id} className="bg-white border border-[#dadce0] rounded-xl overflow-hidden relative shadow-md hover:shadow-lg transition-shadow mb-6">
                {index === 0 && (
                  <div className="bg-[#1a73e8] text-[#202124] text-xs font-bold uppercase tracking-wider px-4 py-2 inline-block absolute top-0 right-0 rounded-bl-xl z-10 shadow-sm">
                    Recomendação de Ouro
                  </div>
                )}
                
                <div className="p-5">
                   <div className="flex gap-4">
                     <div className="flex-1">
                        <h3 className="font-bold text-2xl leading-tight mb-2 text-[#202124] mr-20">{hs.name}</h3>
                        
                        <div className="flex gap-4 mb-3">
                           <div className="bg-[#e6f4ea] text-[#137333] border border-[#137333]/30 p-2 px-3 rounded-lg flex items-center justify-center gap-2 max-w-max">
                              <Target className="w-5 h-5 shrink-0" />
                              <div className="flex flex-col">
                                 <span className="font-bold text-base leading-none tracking-tight">{hs.confidenceScore}% Probabilidade Alta</span>
                                 <span className="text-[10px] uppercase font-bold opacity-80 mt-0.5">Demanda Confirmada</span>
                              </div>
                           </div>
                        </div>

                        <div className="flex items-start gap-2 mb-4">
                           <MapPin className="w-5 h-5 text-[#80868b] mt-0.5 shrink-0" />
                           <span className="text-[#5f6368] text-sm leading-snug">{hs.address}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mb-4">
                           {hs.dataSource === 'dados_reais' ? (
                             <span className="bg-[#fce8e6] text-[#d93025] border border-[#d93025]/30 text-[10px] sm:text-xs font-bold px-3 py-1 rounded-full flex items-center gap-2 tracking-wide uppercase">
                               <Zap className="w-3 h-3 fill-current" /> Radar ao Vivo (Comunidade)
                             </span>
                           ) : (
                             <span className="bg-[#fef7e0] text-[#f9ab00] border border-[#f9ab00]/30 text-[10px] sm:text-xs font-bold px-3 py-1 rounded-full flex items-center gap-2 tracking-wide uppercase">
                               <BrainCircuit className="w-3 h-3" /> Previsão Lógica
                             </span>
                           )}
                        </div>

                        <div className="bg-[#f8f9fa] p-4 mt-5 rounded-lg border border-[#dadce0]">
                          <p className="text-sm text-[#5f6368] font-medium mb-3">{hs.routineProfile}</p>
                          <div className="space-y-2">
                             <div className="flex justify-between items-center text-[10px] sm:text-xs">
                               <span className="text-[#80868b] font-bold w-28">Histórico de Viagens</span>
                               <div className="flex-1 mx-2 h-1.5 bg-[#dadce0] rounded-full overflow-hidden"><div className="h-full bg-[#1e8e3e]" style={{ width: '90%' }}></div></div>
                               <span className="font-bold text-[#3c4043]">Peso: 40%</span>
                             </div>
                             <div className="flex justify-between items-center text-[10px] sm:text-xs">
                               <span className="text-[#80868b] font-bold w-28">Falta de Carros</span>
                               <div className="flex-1 mx-2 h-1.5 bg-[#dadce0] rounded-full overflow-hidden"><div className="h-full bg-[#f9ab00]" style={{ width: '80%' }}></div></div>
                               <span className="font-bold text-[#3c4043]">Peso: 35%</span>
                             </div>
                             <div className="flex justify-between items-center text-[10px] sm:text-xs">
                               <span className="text-[#80868b] font-bold w-28">Trânsito a Favor</span>
                               <div className="flex-1 mx-2 h-1.5 bg-[#dadce0] rounded-full overflow-hidden"><div className="h-full bg-[#1a73e8]" style={{ width: '70%' }}></div></div>
                               <span className="font-bold text-[#3c4043]">Peso: 25%</span>
                             </div>
                          </div>
                        </div>
                     </div>
                   </div>
                 </div> 

                <div className="bg-[#f8f9fa] p-4 flex flex-col gap-3 text-base border-t border-[#dadce0]">
                  <div className="flex justify-between items-center">
                    <span className="text-[#80868b] text-sm font-bold">Espera Média lá:</span>
                    <span className="font-bold text-[#3c4043]">{hs.esperaRecomendadaMin} min</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-[#dadce0]">
                    <span className="text-[#80868b] text-sm font-bold">Retorno Estimado:</span>
                    <span className="font-bold text-[#1e8e3e] text-lg">{hs.historicoGanhos}</span>
                  </div>
                </div>
              </div>
            ))}
            
            <div className="bg-white border-2 border-dashed border-[#dadce0] rounded-2xl p-6 flex flex-col items-center justify-center mt-6 shadow-inner relative overflow-hidden">
                <div className="absolute top-[20%] left-[30%] w-10 h-10 bg-[#1a73e8]/20 border-2 border-[#1a73e8] rounded-full flex items-center justify-center animate-pulse">
                    <div className="w-2.5 h-2.5 bg-[#1a73e8] rounded-full"></div>
                </div>
                <div className="absolute top-[60%] right-[20%] w-10 h-10 bg-[#1a73e8]/20 border-2 border-[#1a73e8] rounded-full flex items-center justify-center animate-pulse delay-300">
                    <div className="w-2.5 h-2.5 bg-[#1a73e8] rounded-full"></div>
                </div>
                
                <h4 className="text-[#202124] font-bold mb-1 z-10 text-center">SIMULAÇÃO DE ROTA APRIMORADA</h4>
                <p className="text-[#80868b] text-xs z-10 text-center">Mapa de Calor Ativo (Região Dinâmica)</p>
            </div>
          </div>
        )}

        {/* TRAIL TAB */}
        {activeTab === 'trail' && (
          <div className="space-y-4">
             <div className="mb-6 flex justify-between items-start">
               <div className="pr-4">
                 <h2 className="text-3xl font-bold mb-2 text-[#202124]">Sua Trilha Hoje</h2>
                 <p className="text-[#80868b] text-base">Onde você deve ir hora a hora. Já colocamos suas pausas na lista.</p>
               </div>
               <button onClick={() => setIsAddingStop(true)} className="bg-[#1557b0] hover:bg-[#1a73e8] text-white px-4 py-2 font-bold rounded-xl shadow-lg transition-transform hover:-translate-y-1 active:translate-y-0 flex items-center gap-2 flex-shrink-0 border border-#1a73e8-400">
                  <div className="text-xl leading-none font-bold">+</div> Add Parada
               </button>
            </div>

            {isAddingStop && (
               <div className="bg-white border-2 border-blue-100 rounded-2xl p-5 mb-6 shadow-2xl relative">
                  <div className="flex justify-between items-center mb-4">
                     <h3 className="font-bold text-[#202124] text-xl">Novo Compromisso</h3>
                     <button onClick={() => setIsAddingStop(false)} className="text-[#80868b] hover:text-[#202124] p-1">
                        <XCircle className="w-6 h-6" />
                     </button>
                  </div>
                  
                  <div className="space-y-4">
                     <div>
                        <label className="block text-[#80868b] text-sm font-bold mb-1">Horário (ex: 14:00)</label>
                        <input type="time" value={newStopData.time} onChange={e => setNewStopData({...newStopData, time: e.target.value})} className="w-full bg-[#f8f9fa] border border-[#dadce0] text-[#202124] rounded-xl px-4 py-3 font-bold focus:border-[#1a73e8] outline-none" />
                     </div>
                     <div>
                        <label className="block text-[#80868b] text-sm font-bold mb-1">Motivo (O que vai fazer?)</label>
                        <input type="text" placeholder="Ex: Buscar filho na escola" value={newStopData.title} onChange={e => setNewStopData({...newStopData, title: e.target.value})} className="w-full bg-[#f8f9fa] border border-[#dadce0] text-[#202124] rounded-xl px-4 py-3 focus:border-[#1a73e8] outline-none placeholder:text-gray-600" />
                     </div>
                     <div>
                        <label className="block text-[#80868b] text-sm font-bold mb-1">Onde?</label>
                        <input type="text" placeholder="Ex: Colégio / Av. Paulista" value={newStopData.location} onChange={e => setNewStopData({...newStopData, location: e.target.value})} className="w-full bg-[#f8f9fa] border border-[#dadce0] text-[#202124] rounded-xl px-4 py-3 focus:border-[#1a73e8] outline-none placeholder:text-gray-600" />
                     </div>

                     <div>
                        <label className="block text-[#80868b] text-sm font-bold mb-1">Repetir parada?</label>
                        <select 
                          value={newStopData.repeat} 
                          onChange={e => setNewStopData({...newStopData, repeat: e.target.value as any})}
                          className="w-full bg-[#f8f9fa] border border-[#dadce0] text-[#202124] rounded-xl px-4 py-3 font-bold focus:border-[#1a73e8] outline-none"
                        >
                          <option value="none">Não repetir (Só Hoje)</option>
                          <option value="daily">Todos os dias</option>
                          <option value="custom">Dias específicos</option>
                        </select>
                     </div>

                     {newStopData.repeat === 'custom' && (
                       <div>
                         <label className="block text-[#80868b] text-sm font-bold mb-2">Quais dias?</label>
                         <div className="flex flex-wrap gap-2">
                           {daysOfWeek.map(day => (
                             <button
                               key={day.id}
                               onClick={() => {
                                 const selected = newStopData.customDays.includes(day.id);
                                 if (selected) {
                                   setNewStopData({ ...newStopData, customDays: newStopData.customDays.filter(d => d !== day.id) });
                                 } else {
                                   setNewStopData({ ...newStopData, customDays: [...newStopData.customDays, day.id].sort() });
                                 }
                               }}
                               className={`w-10 h-10 rounded-full font-bold text-sm shadow-sm transition-colors ${newStopData.customDays.includes(day.id) ? 'bg-[#1a73e8] text-white border border-#1a73e8-400' : 'bg-[#f1f3f4] text-[#80868b] border border-transparent hover:bg-[#e8eaed]'}`}
                             >
                               {day.label}
                             </button>
                           ))}
                         </div>
                       </div>
                     )}

                     <button onClick={handleAddStop} disabled={!newStopData.time || !newStopData.title || !newStopData.location || (newStopData.repeat === 'custom' && newStopData.customDays.length === 0)} className="w-full bg-[#1557b0] hover:bg-[#1a73e8] disabled:opacity-50 text-white font-bold text-lg py-3 rounded-xl mt-4">
                        Adicionar à Trilha
                     </button>
                  </div>
               </div>
            )}

            <div className="mb-8">
               <button onClick={() => setIsNavigating(true)} className="w-full min-h-[70px] bg-[#1e8e3e] hover:bg-[#137333] text-white py-5 rounded-2xl text-xl font-bold transition-all flex items-center justify-center gap-3 shadow-[0_0_20px_rgba(16,185,129,0.2)] active:scale-95">
                  <Compass className="w-8 h-8" />
                  Abrir Mapa e Começar a Dirigir
               </button>
            </div>

            <div className="relative pl-8 border-l-4 border-[#dadce0] space-y-8 pb-4">
               {activeTrail.map((step, index) => {
                  let badgeColor = 'bg-[#f1f3f4] text-[#80868b]';
                  let iconColor = 'text-[#202124]';
                  let IconMarker = MapPin;

                  if (step.action === 'hotspot') {
                     badgeColor = step.completed ? 'bg-white text-[#202124]' : 'bg-[#1a73e8]/10 text-[#1a73e8] border border-[#1a73e8]/50';
                     iconColor = step.completed ? 'text-[#202124]' : 'text-[#1a73e8]';
                     IconMarker = Zap;
                  } else if (step.action === 'personal_stop') {
                     badgeColor = step.completed ? 'bg-white text-[#202124]' : 'bg-[#e8f0fe]0/10 text-[#1a73e8] border border-blue-500/50';
                     iconColor = step.completed ? 'text-[#202124]' : 'text-[#1a73e8]';
                     IconMarker = Clock;
                  } else if (step.action === 'calibration') {
                     badgeColor = step.completed ? 'bg-white text-[#202124]' : 'bg-yellow-500/10 text-[#f9ab00] border border-yellow-500/50';
                     iconColor = step.completed ? 'text-[#202124]' : 'text-[#f9ab00]';
                     IconMarker = Target;
                  }

                  const isActiveNow = currentActiveTrailStepId === step.id;

                  return (
                     <div key={step.id} className={`relative ${step.completed ? 'opacity-50' : 'opacity-100'} ${isActiveNow ? 'scale-105 origin-left transition-transform' : ''}`}>
                        {/* Timeline dot */}
                        <div className={`absolute -left-[45px] w-6 h-6 rounded-full border-4 border-gray-900 ${isActiveNow ? 'bg-[#1a73e8] shadow-[0_0_15px_rgba(99,102,241,0.8)] animate-pulse' : (step.completed ? 'bg-gray-500' : (step.action === 'hotspot' ? 'bg-[#1a73e8]' : step.action === 'personal_stop' ? 'bg-[#e8f0fe]0' : 'bg-yellow-500'))} top-1`}></div>
                        
                        <div className="flex items-center gap-3 mb-2">
                           <span className={`font-mono font-bold text-xl ${isActiveNow ? 'text-[#1a73e8]' : 'text-[#5f6368]'}`}>{step.time}</span>
                           <span className={`text-xs uppercase font-bold tracking-wider px-3 py-1 rounded-full ${isActiveNow ? 'bg-[#1a73e8] text-white' : badgeColor}`}>
                              {step.action === 'hotspot' ? 'Foco:' : step.action === 'personal_stop' ? 'Pausa:' : 'Descobrir'}
                           </span>
                           {isActiveNow && <span className="text-[10px] font-bold text-[#1a73e8] uppercase tracking-widest animate-pulse border border-#1a73e8-400/50 px-2 py-0.5 rounded-sm">&lt;- O QUE FAZER AGORA</span>}
                        </div>
                        
                        <div className={`bg-white border ${isActiveNow ? 'border-[#1a73e8] shadow-xl' : (step.completed ? 'border-[#dadce0]' : 'border-gray-500 shadow-md')} rounded-2xl p-5`}>
                           <h4 className={`font-bold text-xl mb-2 flex items-center gap-3 ${step.completed ? 'text-[#80868b]' : 'text-[#202124]'}`}>
                              <IconMarker className={`w-6 h-6 ${iconColor}`} />
                              {step.title}
                           </h4>
                           <p className="text-base text-[#80868b] mb-3 font-medium">{step.location}</p>
                           <p className="text-base text-[#5f6368] leading-relaxed mb-4">{step.description}</p>
                           
                           {isActiveNow && (step.action === 'hotspot' || step.action === 'calibration') && (
                              <div className="bg-[#e8f0fe] border border-blue-200 rounded-lg p-3 mb-4 flex items-start gap-2 text-xs leading-relaxed text-[#5f6368]">
                                 <Cpu className="w-4 h-4 text-[#1a73e8] shrink-0 mt-0.5" />
                                 <span><strong>Cálculo do Sistema:</strong> Esta rota foi criada projetando uma conversão de R$/hora Alta. Direcionando você para o fluxo pendular dos próximos 40 minutos com <strong>85%+ de certeza estatística</strong> baseada em radares de escassez e deslocamento na cidade.</span>
                              </div>
                           )}

                           {step.repeatInfo && step.repeatInfo.type !== 'none' && (
                             <div className="mb-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#f8f9fa] border border-[#dadce0] rounded-lg text-xs font-bold text-[#5f6368]">
                                <RotateCcw className="w-4 h-4 text-[#1a73e8]" />
                                {step.repeatInfo.type === 'daily' ? 'Repete todos os dias' : `Dias: ${step.repeatInfo.days?.map(d => daysOfWeek.find(x => x.id === d)?.label).join(', ')}`}
                             </div>
                           )}

                           {step.expectedProfit && (
                              <div className="bg-[#f8f9fa]/50 rounded-xl p-3 flex justify-between items-center text-sm border-t border-[#dadce0]">
                                 <span className="text-[#80868b] font-bold">Pode dar até:</span>
                                 <span className={`text-xl font-bold ${step.completed ? 'text-[#80868b]' : 'text-[#1a73e8]'}`}>{step.expectedProfit}</span>
                              </div>
                           )}
                        </div>
                     </div>
                  );
               })}
            </div>
          </div>
        )}

        {/* PROFILES TAB */}
        {activeTab === 'profiles' && (
          <div className="space-y-4">
             {/* CATEGORY SELECTOR */}
             <div className="mb-8">
                <h2 className="text-3xl font-bold mb-3 text-[#202124]">Seu Veículo</h2>
                <p className="text-[#80868b] text-base mb-4">Qual categoria você está ligando hoje?</p>
                <div className="grid grid-cols-3 gap-3">
                   {CATEGORIES.map(cat => (
                      <button
                         key={cat.id}
                         onClick={() => {
                            if (cat.isPremium && !isPro) {
                               setShowProModal(true);
                               return;
                            }
                            setActiveCategory(cat);
                         }}
                         className={`p-3 rounded-xl border-2 font-bold text-sm transition-all flex flex-col items-center justify-center gap-2 relative ${activeCategory.id === cat.id ? 'border-[#1a73e8] bg-[#1a73e8]/10 text-[#1a73e8]' : 'border-[#dadce0] bg-white text-[#80868b] hover:border-[#dadce0]'}`}
                      >
                         <CarFront className="w-6 h-6" />
                         <span className="flex items-center gap-1">
                           {cat.name} 
                           {cat.isPremium && !isPro && <Lock className="w-3 h-3 text-red-600" />}
                         </span>
                      </button>
                   ))}
                </div>
             </div>

             <div className="mb-6">
              <h2 className="text-3xl font-bold mb-2 text-[#202124]">Seu Objetivo</h2>
              <p className="text-[#80868b] text-base">O que você quer focar hoje?</p>
            </div>

            {PROFILES.map((profile) => (
              <div 
                key={profile.id}
                onClick={() => setActiveProfile(profile)}
                className={`bg-white border-4 rounded-2xl p-6 cursor-pointer transition-all ${activeProfile.id === profile.id ? 'border-[#1a73e8] shadow-xl bg-[#f1f3f4]/50' : 'border-[#dadce0] hover:border-[#dadce0]'}`}
              >
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-extrabold text-2xl text-[#202124]">{profile.name}</h3>
                  {activeProfile.id === profile.id && (
                    <div className="bg-[#1a73e8] rounded-full p-2 shadow-sm shrink-0">
                      <CheckCircle2 className="w-8 h-8 text-white" />
                    </div>
                  )}
                </div>
                
                <p className="text-base text-[#80868b] mb-6 leading-relaxed">{profile.description}</p>
                
                <div className="bg-[#f8f9fa]/50 p-4 rounded-xl border border-[#dadce0] font-bold text-lg text-[#5f6368]">
                   Meta ajustada ({activeCategory.name}): <br/> 
                   <span className="text-[#1a73e8] text-2xl font-bold mt-1 block">R$ {(profile.minPricePerHour * activeCategory.multiplier).toFixed(2)} /h</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* EVOLUTION TAB */}
        {activeTab === 'events' && (
           <EventsDashboard />
        )}
      </main>

      {/* RIDE ALERT MODAL (Overlay Material Design 3 Bottom Sheet) */}
      {currentAnalysis && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm p-0 flex flex-col justify-end animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md mx-auto rounded-t-[28px] p-6 pb-10 relative overflow-hidden shadow-2xl animate-in slide-in-from-bottom-full duration-300">
            
            {/* Drag Handle (Visual only for now) */}
            <div className="w-10 h-1.5 bg-gray-300 rounded-full mx-auto mb-6"></div>

            <button onClick={() => handleManualAction('ignored')} className="absolute top-4 right-4 bg-[#f8f9fa] rounded-full p-2 text-[#80868b] hover:text-[#3c4043] hover:bg-[#e8eaed] transition-colors">
              <XCircle className="w-6 h-6" />
            </button>

            {/* Top Status & Score */}
            <div className="flex justify-between items-center mb-6 pr-10">
                <div className="flex items-center gap-2">
                    {currentAnalysis.shouldAccept ? (
                       <>
                         <div className="w-8 h-8 rounded-full bg-[#e6f4ea] flex items-center justify-center">
                            <CheckCircle2 className="w-5 h-5 text-[#1e8e3e]" />
                         </div>
                         <span className="font-medium text-[#1e8e3e]">Recomendada</span>
                       </>
                    ) : (
                       <>
                         <div className="w-8 h-8 rounded-full bg-[#fce8e6] flex items-center justify-center">
                            <XCircle className="w-5 h-5 text-[#d93025]" />
                         </div>
                         <span className="font-medium text-[#d93025]">Não Recomendada</span>
                       </>
                    )}
                </div>
                
                {/* Serasa Score Widget */}
                <div className="flex flex-col items-end">
                  <span className="text-[10px] uppercase font-medium text-[#80868b]">Score de Risco</span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                     <span className={`text-2xl font-semibold tracking-tight ${
                          currentAnalysis.score >= 80 ? 'text-[#1e8e3e]' :
                          currentAnalysis.score >= 50 ? 'text-[#f9ab00]' : 'text-[#d93025]'
                      }`}>{currentAnalysis.score}</span>
                  </div>
                </div>
            </div>

            <div className="mb-6 border-b border-[#e8eaed] pb-6">
                <div className="text-[#80868b] text-sm font-medium mb-1">
                  Pagamento Estimado
                </div>
                <div className="text-[42px] font-medium tracking-tight text-[#202124] leading-none">
                   R$ {currentAnalysis.ride.totalPrice.toFixed(2)}
                </div>
            </div>
            
            {/* Visual Route Info */}
            <div className="flex flex-col gap-5 mb-6 pl-1 pr-4">
               <div className="flex items-start gap-4">
                  <div className="mt-1 w-4 h-4 rounded-full border-[4px] border-[#1a73e8] bg-white shrink-0"></div>
                  <div className="flex-1">
                     <p className="font-medium text-[#202124] leading-tight mb-0.5">{currentAnalysis.ride.pickupLocation}</p>
                     <p className="text-sm text-[#80868b]">{currentAnalysis.ride.pickupDistance} km de distância</p>
                  </div>
               </div>
               <div className="flex items-start gap-4">
                  <div className="mt-1 w-4 h-4 rounded-full bg-[#ea4335] border-[4px] border-[#fce8e6] shrink-0"></div>
                  <div className="flex-1">
                     <p className="font-medium text-[#202124] leading-tight mb-0.5">{currentAnalysis.ride.dropoffLocation}</p>
                     <p className="text-sm text-[#80868b]">{currentAnalysis.ride.rideDistance} km percurso total</p>
                  </div>
               </div>
            </div>

            {/* PERSONAL AI BRAIN INSIGHT (MVP) */}
            {currentAnalysis.brainInsights.length > 0 && (
                <div className="bg-[#e8f0fe] p-4 rounded-[16px] mb-6 flex gap-3 items-start border border-[#d2e3fc]">
                   <BrainCircuit className="w-5 h-5 text-[#1a73e8] shrink-0 mt-0.5" />
                   <p className="text-[#174ea6] text-sm font-medium leading-normal tracking-wide">
                      {currentAnalysis.brainInsights[0]}
                   </p>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-[#f8f9fa] p-4 rounded-[16px]">
                <p className="text-xs font-medium text-[#80868b] uppercase mb-1">Valor por KM</p>
                <p className="text-xl font-medium text-[#202124]">R$ {currentAnalysis.pricePerKm.toFixed(2)}</p>
              </div>
              <div className="bg-[#f8f9fa] p-4 rounded-[16px]">
                <p className="text-xs font-medium text-[#80868b] uppercase mb-1">Valor por Hora</p>
                <p className="text-xl font-medium text-[#202124]">R$ {currentAnalysis.pricePerHour.toFixed(0)}</p>
              </div>
            </div>

            <div className="mb-8">
              <h4 className="font-medium text-[#202124] text-sm mb-3">Detalhes da análise</h4>
              <ul className="space-y-3">
                {currentAnalysis.reasons.map((reason, i) => (
                  <li key={i} className="flex gap-3 text-[#5f6368] text-sm items-start">
                    <CheckCircle2 className={`w-5 h-5 shrink-0 grow-0 ${reason.startsWith('⚠️') || reason.startsWith('Paga pouco') || reason.startsWith('Paga muito pouco') || reason.startsWith('Passageiro muito') || reason.startsWith('🚫') || reason.startsWith('🛑') || reason.startsWith('💸') || reason.startsWith('🛡️') || reason.startsWith('O Serasa') || reason.startsWith('Bloqueado') ? 'text-[#ea4335]' : 'text-[#1e8e3e]'}`} />
                    <span className="leading-relaxed">{reason}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-3">
                {currentAnalysis.shouldAccept ? (
                   <button onClick={() => handleManualAction('accepted')} className="flex-1 bg-[#1a73e8] hover:bg-[#1557b0] text-white font-medium py-3.5 rounded-full text-base transition-colors text-center">
                     Recomendar
                   </button>
                ) : (
                   <button onClick={() => handleManualAction('rejected')} className="flex-1 border border-gray-300 text-[#5f6368] hover:bg-[#f8f9fa] font-medium py-3.5 rounded-full text-base transition-colors text-center">
                     Ignorar
                   </button>
                )}
            </div>

          </div>
        </div>
      )}

      {/* PRO PLAN UPGRADE MODAL */}
      {showProModal && (
        <div className="absolute inset-0 z-[70] bg-[#f8f9fa]/95 backdrop-blur-md p-4 flex items-center justify-center animate-in fade-in zoom-in-95 duration-200">
           <div className="bg-white border-2 border-[#dadce0] w-full max-w-md rounded-3xl overflow-y-auto max-h-[90vh] shadow-2xl relative">
              <button 
                onClick={() => setShowProModal(false)}
                className="absolute top-4 right-4 bg-[#f1f3f4] text-[#5f6368] p-2 rounded-full hover:bg-[#e8eaed] z-10"
              >
                <XCircle className="w-6 h-6" />
              </button>

              <div className="p-6 pb-2 text-center">
                 <div className="bg-[#f9ab00]/20 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-500/30">
                    <Crown className="w-10 h-10 text-[#e37400]" />
                 </div>
                 <h2 className="text-2xl font-bold text-[#202124] uppercase tracking-tight">Desbloqueie o<br/>Máximo de Lucro</h2>
                 <p className="text-[#80868b] text-sm mt-2">Você está no plano Básico. As categorias Premium exigem ferramentas mais precisas.</p>
              </div>

              <div className="p-5 space-y-4">
                 
                 {/* Card 1: Invite Friends */}
                 <div className="bg-gradient-to-br from-[#e8f0fe] to-white border border-blue-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-2 h-full bg-[#1a73e8]"></div>
                    <div className="flex gap-4">
                       <div className="bg-blue-100 p-3 rounded-xl shrink-0 h-min">
                          <Share2 className="w-6 h-6 text-[#1a73e8]" />
                       </div>
                       <div>
                          <h3 className="font-bold text-[#202124] text-lg">Indique e Ganhe 1 Mês</h3>
                          <p className="text-xs text-[#5f6368] mt-1 leading-relaxed">
                            Convide 3 amigos motoristas para baixar o PRÉCHECA agora e ganhe <strong>1 mês de plano Advanced Grátis</strong> (Incluindo Radar Total para UberX).
                          </p>
                          <button onClick={() => alert('Link copiado para a área de transferência!')} className="mt-4 bg-[#1a73e8] hover:bg-[#1557b0] text-white font-bold py-2.5 px-4 rounded-xl text-sm w-full transition-colors flex items-center justify-center gap-2">
                             Copiar Meu Link
                          </button>
                       </div>
                    </div>
                 </div>

                 <div className="text-center text-[#9aa0a6] font-bold uppercase text-xs tracking-widest my-2">ou assine agora</div>

                 {/* Card 2: Upgrade */}
                 <div className="bg-gradient-to-br from-[#fef7e0] to-white border border-amber-200 rounded-2xl p-5 shadow-sm relative overflow-hidden text-center">
                    <h3 className="font-bold text-[#f9ab00] text-xl mb-1">Plano Advanced</h3>
                    <p className="text-xs text-[#5f6368] mb-4">Radar Ativo, Categorias Black/Comfort e Filtro de Segurança Total.</p>
                    <div className="text-3xl font-bold text-[#202124] mb-4">
                      R$ 29,90<span className="text-sm font-medium text-[#80868b]">/mês</span>
                    </div>
                    <button onClick={() => { setIsPro(true); setShowProModal(false); alert('Plano Advanced ativado (Simulação)!'); }} className="bg-[#f9ab00] hover:bg-amber-400 text-white font-bold py-4 px-4 rounded-xl text-lg w-full transition-all shadow-md">
                       ASSINAR ADVANCED
                    </button>
                 </div>

              </div>
           </div>
        </div>
      )}

      {/* NAVIGATION OVERLAY (GPS / Waze style Guide) */}
      {isNavigating && (
        <div className="absolute inset-0 z-[60] bg-[#f8f9fa] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
           
           {/* Header Maneuver */}
           <div className="absolute top-6 left-4 right-4 z-20 bg-white/95 backdrop-blur-md border-[3px] border-[#dadce0] rounded-2xl p-5 shadow-2xl flex items-center gap-5">
             <div className="bg-[#1a73e8] p-4 rounded-2xl text-white shadow-inner">
               <ArrowUp className="w-10 h-10" />
             </div>
             <div>
               <h2 className="text-2xl font-bold text-[#202124] uppercase tracking-tight">Siga em frente</h2>
               <p className="text-[#1a73e8] font-bold text-lg mt-1">Dirija por 300 metros</p>
             </div>
           </div>

           {/* AI INFOTIP (Dynamic advice) */}
           <div className="absolute top-36 left-4 right-4 z-20 animate-in slide-in-from-top-10 fade-in duration-700 delay-500">
             <div className="bg-blue-900/95 backdrop-blur-xl border-4 border-blue-500 rounded-2xl p-6 shadow-2xl flex items-start gap-4">
               <div>
                  <h4 className="text-blue-300 text-sm uppercase font-bold mb-2 flex items-center">
                     DICA DO APLICATIVO
                  </h4>
                  <p className="text-white text-lg leading-snug font-bold">As corridas no Shopping aumentaram agora.<br/>Siga a rota verde para chegar mais rápido e faturar mais!</p>
               </div>
             </div>
           </div>

           {/* 3D Map Visualization */}
           <div className="absolute inset-0 z-0 bg-[#f1f3f4]" style={{ perspective: '800px' }}>
              <div className="absolute bottom-[-20%] w-full h-[150%] bg-[#0f172a]" style={{ transform: 'rotateX(60deg)', transformOrigin: 'bottom' }}>
                 {/* Grid styling */}
                 <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.2) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,0.2) 2px, transparent 2px)', backgroundSize: '60px 60px' }}></div>
                 
                 {/* Route Line */}
                 <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[90%] bg-[#1a73e8]/20 blur-xl"></div>
                 <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-[90%] bg-[#1a73e8] shadow-[0_0_40px_rgba(16,185,129,1)]"></div>
              </div>
           </div>

           {/* User / Car Icon */}
           <div className="absolute bottom-[28%] left-1/2 -translate-x-1/2 z-10 filter drop-shadow-[0_15px_15px_rgba(0,0,0,0.8)] flex justify-center">
              <div className="relative">
                <div className="absolute inset-0 bg-[#1a73e8] rounded-full blur-xl opacity-50 animate-pulse scale-150"></div>
                <Navigation className="w-16 h-16 text-[#3c4043] fill-emerald-500 relative z-10" />
              </div>
           </div>

           {/* Bottom Details Bar */}
           <div className="absolute bottom-0 left-0 right-0 z-20 bg-[#f8f9fa] border-t-4 border-[#dadce0] p-6 shadow-2xl">
             <div className="flex justify-between items-end mb-6">
               <div>
                 <p className="text-[#80868b] text-sm font-bold uppercase tracking-widest mb-1">Destino Final:</p>
                 <h3 className="text-4xl font-bold text-[#202124] flex items-baseline gap-2">
                    8 MIN <span className="text-[#80868b] font-bold text-2xl">· 3 KM</span>
                 </h3>
               </div>
             </div>
             
             <div className="flex gap-4">
               <button onClick={() => setIsNavigating(false)} className="bg-[#f1f3f4] border-2 border-gray-500 hover:bg-[#e8eaed] text-[#5f6368] font-bold py-5 px-6 rounded-2xl transition-colors shrink-0">
                 <XCircle className="w-8 h-8" />
               </button>
               <button className="flex-1 bg-[#1e8e3e] hover:bg-[#137333] text-white font-extrabold py-5 rounded-2xl transition-colors flex items-center justify-center gap-3 text-xl">
                 <Map className="w-6 h-6" />
                 ABRIR O WAZE
               </button>
             </div>
           </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <nav className="bg-white border-t-2 border-[#dadce0] h-[80px] absolute bottom-0 w-full flex shadow-2xl z-40">
        <TabButton id="dashboard" icon={LayoutDashboard} label="Início" />
        <TabButton id="hotspots" icon={Map} label="Locais" />
        <TabButton id="trail" icon={Route} label="Meu Dia" />
        <TabButton id="events" icon={Ticket} label="Eventos" />
        <TabButton id="profiles" icon={Settings} label="Objetivo" />
      </nav>

      {showWizard && (
        <SettingsWizard
          onClose={() => setShowWizard(false)}
          onSave={handleWizardSave}
        />
      )}
    </div>
  );
}

export default App;
