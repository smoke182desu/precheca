import React, { useState, useEffect } from 'react';
import { X, Clock, CalendarDays, Target, Smartphone, AlertTriangle, CheckCircle2, ChevronRight, Settings, SlidersHorizontal, ShieldAlert } from 'lucide-react';
import { useFirebase } from './FirebaseProvider';
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

interface SettingsWizardProps {
  onClose: () => void;
}

export function SettingsWizard({ onClose }: SettingsWizardProps) {
  const { user } = useFirebase();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);

  const [workStartTime, setWorkStartTime] = useState('07:00');
  const [workEndTime, setWorkEndTime] = useState('18:00');
  const [dailyGoal, setDailyGoal] = useState<number>(250);
  const [workDays, setWorkDays] = useState<string[]>(['Seg', 'Ter', 'Qua', 'Qui', 'Sex']);
  const [avoidDirtRoads, setAvoidDirtRoads] = useState<boolean>(true);
  const [avoidRidesWithStops, setAvoidRidesWithStops] = useState<boolean>(true);
  const [avoidTolls, setAvoidTolls] = useState<boolean>(false);
  const [strictSafetyMode, setStrictSafetyMode] = useState<boolean>(true);
  const [voiceAlerts, setVoiceAlerts] = useState<boolean>(true);
  const [autoReject, setAutoReject] = useState<boolean>(false);

  const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  useEffect(() => {
    async function loadSettings() {
      if (!user) return;
      try {
        const userDoc = await getDoc(doc(db, `users/${user.uid}`));
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.workStartTime) setWorkStartTime(data.workStartTime);
          if (data.workEndTime) setWorkEndTime(data.workEndTime);
          if (data.dailyGoal) setDailyGoal(data.dailyGoal);
          if (data.workDays) setWorkDays(data.workDays);
          if (data.avoidDirtRoads !== undefined) setAvoidDirtRoads(data.avoidDirtRoads);
          if (data.avoidRidesWithStops !== undefined) setAvoidRidesWithStops(data.avoidRidesWithStops);
          if (data.avoidTolls !== undefined) setAvoidTolls(data.avoidTolls);
          if (data.strictSafetyMode !== undefined) setStrictSafetyMode(data.strictSafetyMode);
          if (data.voiceAlerts !== undefined) setVoiceAlerts(data.voiceAlerts);
          if (data.autoReject !== undefined) setAutoReject(data.autoReject);
        }
      } catch (e) {
        console.error("Failed to load settings", e);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, [user]);

  const toggleDay = (day: string) => {
    setWorkDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleSave = async () => {
    if (!user) return;
    try {
      await setDoc(doc(db, `users/${user.uid}`), {
        workStartTime,
        workEndTime,
        dailyGoal,
        workDays,
        avoidDirtRoads,
        avoidRidesWithStops,
        avoidTolls,
        strictSafetyMode,
        voiceAlerts,
        autoReject,
        updatedAt: serverTimestamp()
      }, { merge: true });
      onClose();
    } catch (e) {
      console.error("Failed to save settings", e);
    }
  };

  if (loading) return null;

  return (
    <div className="fixed inset-0 z-50 bg-white/90 backdrop-blur-sm p-4 flex items-center justify-center animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-white rounded-3xl w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 bg-slate-100 rounded-full p-2 text-gray-9000 hover:text-slate-800 transition-colors z-10">
          <X className="w-6 h-6" />
        </button>

        <div className="p-6">
           <h2 className="text-2xl font-black text-slate-800 mb-6 flex items-center gap-2">
             <Settings className="w-6 h-6 text-[#1e8e3e]" />
             Configurações
           </h2>

           {/* Step Navigation Dots */}
           <div className="flex gap-2 mb-8 justify-center">
             {[1, 2, 3, 4].map(i => (
               <div key={i} className={`h-2 rounded-full transition-all ${step === i ? 'w-8 bg-[#1e8e3e]' : 'w-2 bg-slate-200'}`} />
             ))}
           </div>

           {/* STEP 1: HORÁRIOS */}
           {step === 1 && (
             <div className="space-y-6 animate-in slide-in-from-right-8">
                <div className="text-center mb-8">
                   <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Clock className="w-8 h-8 text-blue-600" />
                   </div>
                   <h3 className="text-xl font-bold text-slate-800">Sua Rotina</h3>
                   <p className="text-gray-9000 text-sm mt-1">Configure seus dias e horários de trabalho.</p>
                </div>

                <div>
                   <label className="text-xs font-bold text-gray-9000 uppercase tracking-wider mb-2 block">Dias da Semana</label>
                   <div className="flex flex-wrap gap-2">
                     {DAYS.map(day => (
                        <button
                          key={day}
                          onClick={() => toggleDay(day)}
                          className={`px-3 py-2 rounded-xl text-sm font-bold transition-all ${workDays.includes(day) ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 text-gray-9000 hover:bg-slate-200'}`}
                        >
                          {day}
                        </button>
                     ))}
                   </div>
                </div>

                <div className="flex gap-4">
                   <div className="flex-1">
                      <label className="text-xs font-bold text-gray-9000 uppercase tracking-wider mb-2 block">Início</label>
                      <input 
                        type="time" 
                        value={workStartTime} 
                        onChange={(e) => setWorkStartTime(e.target.value)}
                        className="w-full bg-slate-100 border-none rounded-xl p-4 font-bold text-slate-800 focus:ring-2 focus:ring-blue-500"
                      />
                   </div>
                   <div className="flex-1">
                      <label className="text-xs font-bold text-gray-9000 uppercase tracking-wider mb-2 block">Fim</label>
                      <input 
                        type="time" 
                        value={workEndTime} 
                        onChange={(e) => setWorkEndTime(e.target.value)}
                        className="w-full bg-slate-100 border-none rounded-xl p-4 font-bold text-slate-800 focus:ring-2 focus:ring-blue-500"
                      />
                   </div>
                </div>

                <button onClick={() => setStep(2)} className="w-full mt-6 bg-blue-600 text-white font-black py-4 rounded-xl shadow-lg hover:bg-blue-700 flex justify-center items-center gap-2">
                   Próximo <ChevronRight className="w-5 h-5" />
                </button>
             </div>
           )}

           {/* STEP 2: META FINANCEIRA */}
           {step === 2 && (
             <div className="space-y-6 animate-in slide-in-from-right-8">
                <div className="text-center mb-8">
                   <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Target className="w-8 h-8 text-green-600" />
                   </div>
                   <h3 className="text-xl font-bold text-slate-800">Meta Diária</h3>
                   <p className="text-gray-9000 text-sm mt-1">Quanto você pretende faturar por dia longo?</p>
                </div>

                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 text-center relative">
                   <span className="absolute left-6 top-1/2 -translate-y-1/2 text-2xl font-black text-gray-9000">R$</span>
                   <input 
                     type="number"
                     value={dailyGoal}
                     onChange={(e) => setDailyGoal(Number(e.target.value))}
                     className="w-full bg-transparent text-5xl font-black text-center text-green-600 border-none focus:ring-0 outline-none"
                   />
                </div>

                <div className="flex gap-3 mt-6">
                   <button onClick={() => setStep(1)} className="px-6 py-4 rounded-xl font-bold text-gray-9000 bg-slate-100 hover:bg-slate-200">
                     Voltar
                   </button>
                   <button onClick={() => setStep(3)} className="flex-1 bg-green-600 text-white font-black py-4 rounded-xl shadow-lg hover:bg-green-700 flex justify-center items-center gap-2">
                     Próximo <ChevronRight className="w-5 h-5" />
                   </button>
                </div>
             </div>
           )}

           {/* STEP 3: PREFERÊNCIAS DE ROTA */}
           {step === 3 && (
             <div className="space-y-6 animate-in slide-in-from-right-8">
                <div className="text-center mb-8">
                   <div className="bg-sky-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                      <SlidersHorizontal className="w-8 h-8 text-sky-600" />
                   </div>
                   <h3 className="text-xl font-bold text-slate-800">Preferências da IA</h3>
                   <p className="text-gray-9000 text-sm mt-1">O que a inteligência deve evitar ao filtrar?</p>
                </div>

                <div className="space-y-4">
                   <label className="flex items-center justify-between bg-blue-50 p-4 rounded-2xl border border-blue-100 cursor-pointer hover:bg-blue-100 transition-colors">
                     <div>
                       <span className="font-bold text-blue-800 text-base block">Alertas por Voz (Ler Motivo)</span>
                       <span className="text-xs text-blue-600">A IA vai ditar o alerta em voz alta no carro.</span>
                     </div>
                     <div className={`w-12 h-7 rounded-full flex items-center shrink-0 border-2 transition-colors ${voiceAlerts ? 'bg-[#1a73e8] border-blue-500' : 'bg-blue-200 border-blue-200'}`}>
                       <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${voiceAlerts ? 'translate-x-6' : 'translate-x-1'}`} />
                     </div>
                     <input type="checkbox" className="hidden" checked={voiceAlerts} onChange={(e) => setVoiceAlerts(e.target.checked)} />
                   </label>

                   <label className="flex items-center justify-between bg-blue-50 p-4 rounded-2xl border border-blue-100 cursor-pointer hover:bg-blue-100 transition-colors">
                     <div>
                       <span className="font-bold text-blue-800 text-base block">Automático: Ignorar (Deixar Passar)</span>
                       <span className="text-xs text-blue-600">A IA recusa ocultando o chamado na mesma hora (anti-taxa).</span>
                     </div>
                     <div className={`w-12 h-7 rounded-full flex items-center shrink-0 border-2 transition-colors ${autoReject ? 'bg-[#1a73e8] border-blue-500' : 'bg-blue-200 border-blue-200'}`}>
                       <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${autoReject ? 'translate-x-6' : 'translate-x-1'}`} />
                     </div>
                     <input type="checkbox" className="hidden" checked={autoReject} onChange={(e) => setAutoReject(e.target.checked)} />
                   </label>

                   <div className="h-px bg-slate-200 my-2"></div>

                   <label className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors">
                     <div>
                       <span className="font-bold text-slate-800 text-base block">Evitar Estrada de Terra</span>
                       <span className="text-xs text-gray-9000">Recusa corridas para áreas não pavimentadas</span>
                     </div>
                     <div className={`w-12 h-7 rounded-full flex items-center shrink-0 border-2 transition-colors ${avoidDirtRoads ? 'bg-[#1e8e3e] border-green-500' : 'bg-slate-200 border-slate-200'}`}>
                       <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${avoidDirtRoads ? 'translate-x-6' : 'translate-x-1'}`} />
                     </div>
                     <input type="checkbox" className="hidden" checked={avoidDirtRoads} onChange={(e) => setAvoidDirtRoads(e.target.checked)} />
                   </label>

                   <label className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors">
                     <div>
                       <span className="font-bold text-slate-800 text-base block">Evitar Viagens com Paradas</span>
                       <span className="text-xs text-gray-9000">Recusa quando o passageiro adiciona paradas no meio</span>
                     </div>
                     <div className={`w-12 h-7 rounded-full flex items-center shrink-0 border-2 transition-colors ${avoidRidesWithStops ? 'bg-[#1e8e3e] border-green-500' : 'bg-slate-200 border-slate-200'}`}>
                       <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${avoidRidesWithStops ? 'translate-x-6' : 'translate-x-1'}`} />
                     </div>
                     <input type="checkbox" className="hidden" checked={avoidRidesWithStops} onChange={(e) => setAvoidRidesWithStops(e.target.checked)} />
                   </label>

                   <label className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors">
                     <div>
                       <span className="font-bold text-slate-800 text-base block">Evitar Pedágios</span>
                       <span className="text-xs text-gray-9000">Aumenta o rigor para rotas com praça de pedágio</span>
                     </div>
                     <div className={`w-12 h-7 rounded-full flex items-center shrink-0 border-2 transition-colors ${avoidTolls ? 'bg-[#1e8e3e] border-green-500' : 'bg-slate-200 border-slate-200'}`}>
                       <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${avoidTolls ? 'translate-x-6' : 'translate-x-1'}`} />
                     </div>
                     <input type="checkbox" className="hidden" checked={avoidTolls} onChange={(e) => setAvoidTolls(e.target.checked)} />
                   </label>

                   <label className="flex items-center justify-between bg-red-50 p-4 rounded-2xl border border-red-100 cursor-pointer hover:bg-red-100 transition-colors">
                     <div>
                       <span className="font-bold text-red-800 text-base flex items-center gap-2">
                         <ShieldAlert className="w-5 h-5" /> Segurança Total
                       </span>
                       <span className="text-xs text-red-600 block mt-1">Garante que a IA funcionará <strong>somente em locais com baixa criminalidade</strong>. Recusa TUDO que for diferente.</span>
                     </div>
                     <div className={`w-12 h-7 rounded-full flex items-center shrink-0 border-2 transition-colors ${strictSafetyMode ? 'bg-red-500 border-red-500' : 'bg-red-200 border-red-200'}`}>
                       <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${strictSafetyMode ? 'translate-x-6' : 'translate-x-1'}`} />
                     </div>
                     <input type="checkbox" className="hidden" checked={strictSafetyMode} onChange={(e) => setStrictSafetyMode(e.target.checked)} />
                   </label>
                </div>

                <div className="flex gap-3 mt-6">
                   <button onClick={() => setStep(2)} className="px-6 py-4 rounded-xl font-bold text-gray-9000 bg-slate-100 hover:bg-slate-200">
                     Voltar
                   </button>
                   <button onClick={() => setStep(4)} className="flex-1 bg-green-600 text-white font-black py-4 rounded-xl shadow-lg hover:bg-green-700 flex justify-center items-center gap-2">
                     Próximo <ChevronRight className="w-5 h-5" />
                   </button>
                </div>
             </div>
           )}

           {/* STEP 4: CONEXÃO UBER & LEITURA DA TELA */}
           {step === 4 && (
             <div className="space-y-6 animate-in slide-in-from-right-8">
                <div className="text-center mb-6">
                   <div className="bg-orange-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Smartphone className="w-8 h-8 text-orange-600" />
                   </div>
                   <h3 className="text-xl font-bold text-slate-800">Integração Uber</h3>
                   <p className="text-gray-9000 text-sm mt-1">Como vamos ler a sua tela.</p>
                </div>

                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 mb-4">
                   <div className="flex items-start gap-3">
                      <AlertTriangle className="w-6 h-6 text-orange-500 shrink-0 mt-1" />
                      <div>
                         <h4 className="font-bold text-orange-800">Restrição do Navegador</h4>
                         <p className="text-sm text-orange-700 mt-1">
                           Você está usando o PRÉCHECA pelo navegador web. Aplicativos web são <strong>bloqueados pela Apple e Google</strong> de ler notificações de outros apps (como a Uber) por segurança.
                         </p>
                      </div>
                   </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                   <h4 className="font-bold text-slate-800 text-sm mb-2">Para Automatizar Tudo:</h4>
                   <ul className="text-sm text-slate-600 space-y-3">
                     <li className="flex gap-2 items-start"><CheckCircle2 className="w-4 h-4 text-[#1e8e3e] shrink-0 mt-0.5" /> É necessário baixar o nosso aplicativo nativo Android oficial (disponível em breve).</li>
                     <li className="flex gap-2 items-start"><CheckCircle2 className="w-4 h-4 text-[#1e8e3e] shrink-0 mt-0.5" /> No App nativo, te pediremos a permissão de "Acessibilidade".</li>
                     <li className="flex gap-2 items-start"><CheckCircle2 className="w-4 h-4 text-[#1e8e3e] shrink-0 mt-0.5" /> Isso permite que a IA "leia" a oferta da Uber e toque o som certo ou recuse rapidamente.</li>
                   </ul>
                </div>

                <div className="flex gap-3 mt-8">
                   <button onClick={() => setStep(3)} className="px-6 py-4 rounded-xl font-bold text-gray-9000 bg-slate-100 hover:bg-slate-200">
                     Voltar
                   </button>
                   <button onClick={handleSave} className="flex-1 bg-white text-white font-black py-4 rounded-xl shadow-lg hover:bg-white flex justify-center items-center gap-2 transition-transform active:scale-95">
                     Concluir & Salvar
                   </button>
                </div>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}
