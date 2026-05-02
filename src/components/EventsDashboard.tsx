import { PlaneLanding, Ticket, CloudRain, Zap, TrendingUp, Compass, CalendarDays, ExternalLink } from 'lucide-react';

export function EventsDashboard() {
  return (
    <div className="flex flex-col space-y-6 pb-20 animate-in fade-in duration-500">
      <div className="bg-gradient-to-r from-[#202124] to-[#3c4043] -mx-4 -mt-4 px-6 py-8 shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <CalendarDays className="w-32 h-32 text-white" />
        </div>
        <div className="relative z-10 flex items-center gap-3">
          <div className="bg-[#1a73e8]/20 p-2.5 rounded-xl border border-[#1a73e8]/30">
            <Zap className="w-6 h-6 text-[#1a73e8] animate-pulse" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-white mb-0.5 tracking-tight italic uppercase">Inteligência de Campo</h2>
            <p className="text-[#80868b] text-sm uppercase tracking-wider font-bold">Relatório de Oportunidades Alfa</p>
          </div>
        </div>
      </div>

      <div className="bg-[#e8f0fe] border-2 border-[#1a73e8]/30 rounded-2xl p-5 shadow-sm">
        <div className="flex gap-4">
           <div className="flex-1">
              <h3 className="font-black text-[#1a73e8] text-lg mb-1 leading-tight uppercase italic underline decoration-2 decoration-blue-500/30">Radar de Extração: Aeroportos</h3>
              <p className="text-sm text-[#5f6368] leading-relaxed mb-4 font-medium">
                 Vetor de faturamento detectado. Sincronização com pousos reais ativa. Posicionamento tático necessário.
              </p>
           </div>
           <PlaneLanding className="w-12 h-12 text-[#1a73e8] opacity-80 mt-1 shrink-0" />
        </div>
        
        <div className="space-y-3">
           {/* Flight Card */}
           <div className="bg-white p-4 rounded-xl border-2 border-[#dadce0] flex items-center justify-between shadow-sm">
              <div>
                 <div className="text-[10px] uppercase font-black text-[#1a73e8] mb-0.5 tracking-widest">Vetor LATAM 3064</div>
                 <div className="font-black text-[#202124] text-lg italic">POUSO: 15 MIN</div>
                 <div className="text-[10px] text-[#1e8e3e] mt-1 font-bold flex items-center gap-1 uppercase tracking-tighter">
                    <TrendingUp className="w-3 h-3" /> Status: Densidade Crítica
                 </div>
              </div>
              <button className="bg-[#1a73e8] text-white px-4 py-2 rounded-lg font-black text-xs uppercase tracking-tighter shadow-lg shadow-blue-500/20 active:scale-95 transition-all">
                 Interceptar
              </button>
           </div>
           
           <div className="bg-white p-4 rounded-xl border-2 border-[#dadce0] flex items-center justify-between opacity-70">
              <div>
                 <div className="text-[10px] uppercase font-black text-[#80868b] mb-0.5 tracking-widest">Vetor GOL 1940</div>
                 <div className="font-black text-[#202124] text-lg italic uppercase">Espera: 45 MIN</div>
                 <div className="text-[10px] text-[#5f6368] mt-1 font-bold flex items-center gap-1 uppercase tracking-tighter">
                    <Compass className="w-3 h-3" /> Protocolo: Agendar
                 </div>
              </div>
              <button className="border-2 border-[#dadce0] text-[#5f6368] px-4 py-2 rounded-lg font-black text-xs uppercase tracking-tighter">
                 Marcar
              </button>
           </div>
        </div>
      </div>

      <div className="bg-purple-50 border-2 border-purple-200 rounded-2xl p-5 shadow-sm">
        <div className="flex gap-4">
           <div className="flex-1">
              <h3 className="font-black text-[#9334e6] text-lg mb-1 leading-tight uppercase italic underline decoration-2 decoration-purple-500/30">Operação Evento: Zona de Engajamento</h3>
              <p className="text-sm text-[#5f6368] leading-relaxed mb-4 font-medium">
                 Varredura de rede concluída. Sinalização de saída em T-30 minutos. Mover para o perímetro.
              </p>
           </div>
           <Ticket className="w-12 h-12 text-[#9334e6] opacity-80 mt-1 shrink-0" />
        </div>
        
        <div className="space-y-3">
           <div className="bg-white p-4 rounded-xl border-2 border-purple-100 flex flex-col gap-3 shadow-sm">
              <div className="flex justify-between items-start">
                 <div>
                    <div className="text-[10px] uppercase font-black text-[#9334e6] mb-0.5 tracking-widest">Alvo: Arena de Show</div>
                    <div className="font-black text-[#202124] text-lg italic uppercase tracking-tighter">Saída do Público</div>
                 </div>
                 <div className="bg-red-500 text-white font-black px-2 py-1 rounded text-[10px] animate-pulse uppercase tracking-widest border border-black/10">Imediato</div>
              </div>
              <div className="bg-purple-100/50 p-3 rounded-lg text-xs font-bold text-[#9334e6] border border-purple-200 border-dashed">
                 PROTOLO: Mantenha-se a 2km do local até T-15. Evite saturação prematura de frota.
              </div>
           </div>
        </div>
      </div>

      <div className="bg-sky-50 border-2 border-sky-200 rounded-2xl p-5 shadow-sm">
        <div className="flex gap-4">
           <div className="flex-1">
              <h3 className="font-black text-[#12b5cb] text-lg mb-1 leading-tight uppercase italic underline decoration-2 decoration-sky-500/30">Efeito Climático: Alerta Hidro</h3>
              <p className="text-sm text-[#5f6368] leading-relaxed mb-4 font-medium">
                 Detecção de chuva. Recálculo de tarifa dinâmica em tempo real. Dinheiro caindo do céu.
              </p>
           </div>
           <CloudRain className="w-12 h-12 text-[#12b5cb] opacity-80 mt-1 shrink-0" />
        </div>
        
        <div className="space-y-3">
           <div className="bg-white p-4 rounded-xl border-2 border-sky-100 flex items-center justify-between shadow-sm italic">
              <div>
                 <div className="font-black text-[#202124] text-base uppercase tracking-tighter">Céu Limpo: Sem Alteração</div>
                 <div className="text-[10px] text-[#5f6368] font-bold mt-1 uppercase tracking-widest">Nenhuma anomalia climática detectada agora.</div>
              </div>
           </div>
        </div>
      </div>
      
    </div>
  );
}
