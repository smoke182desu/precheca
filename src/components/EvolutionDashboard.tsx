import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Calendar, MapPin, Activity, Award, CheckCircle2, Calculator } from 'lucide-react';

const mockDailyData = [
  { name: 'Seg', lucro: 185, km: 90 },
  { name: 'Ter', lucro: 210, km: 110 },
  { name: 'Qua', lucro: 240, km: 120 },
  { name: 'Qui', lucro: 220, km: 105 },
  { name: 'Sex', lucro: 380, km: 150 },
  { name: 'Sáb', lucro: 410, km: 180 },
  { name: 'Dom', lucro: 310, km: 130 },
];

const mockMonthlyData = [
  { name: 'Jan', lucro: 4200 },
  { name: 'Fev', lucro: 3900 },
  { name: 'Mar', lucro: 4600 },
  { name: 'Abr', lucro: 5100 },
  { name: 'Mai', lucro: 4800 },
  { name: 'Jun', lucro: 5400 },
  { name: 'Jul', lucro: 5900 },
];

const mockNeighborhoods = [
  { name: 'Centro', value: 400, color: '#3b82f6' },
  { name: 'Pinheiros', value: 300, color: '#10b981' },
  { name: 'Vila Mariana', value: 300, color: '#8b5cf6' },
  { name: 'Itaim Bibi', value: 200, color: '#f59e0b' },
];

export function EvolutionDashboard() {
  const [period, setPeriod] = useState<'semana' | 'mes' | 'semestre' | 'ano'>('semana');
  const [simulatorHours, setSimulatorHours] = useState(8);

  const chartData = period === 'semana' ? mockDailyData : mockMonthlyData;
  const totalLucro = chartData.reduce((acc, curr) => acc + curr.lucro, 0);

  // Simulador Engine
  const basePerHour = 22; // Ganho base de motorista comum limpo
  const proPerHour = basePerHour * 1.42; // +42% com PRÉCHECA
  const simulatedMonthlyBase = (basePerHour * simulatorHours) * 22; // 22 dias trabalhados
  const simulatedMonthlyPro = (proPerHour * simulatorHours) * 22;
  const diff = simulatedMonthlyPro - simulatedMonthlyBase;

  return (
    <div className="space-y-6 pb-24 animate-in fade-in slide-in-from-bottom-6">
      <div className="mb-6">
        <h2 className="text-3xl font-black mb-1 text-gray-900 flex items-center gap-3 italic uppercase tracking-tighter">
           <Activity className="w-8 h-8 text-[#1a73e8]" /> Centro de Comando
        </h2>
        <p className="text-[#5f6368] text-xs font-bold uppercase tracking-[0.2em] mb-4">Relatório de Performance: Unidade Alfa</p>
        
        {/* Toggle Period */}
        <div className="bg-[#f1f3f4] p-1 rounded-xl flex items-center justify-between border border-[#dadce0]">
          {(['semana', 'mes', 'semestre', 'ano'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${period === p ? 'bg-[#1a73e8] text-white shadow-lg' : 'text-[#5f6368] hover:text-[#202124]'}`}
            >
              {p === 'mes' ? 'Mês' : p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
         <div className="bg-black border-l-4 border-[#1a73e8] p-5 rounded-2xl shadow-xl">
            <h4 className="text-white/60 text-[9px] font-black uppercase tracking-widest mb-1">Extração Líquida</h4>
            <div className="text-2xl font-black text-white italic">R$ {totalLucro.toFixed(0)}</div>
            <div className="flex items-center gap-1 text-[#1e8e3e] text-[10px] font-black mt-2 uppercase">
               <TrendingUp className="w-3 h-3" /> Superioridade: +14%
            </div>
         </div>
         <div className="bg-white border-2 border-[#dadce0] p-5 rounded-2xl shadow-md relative overflow-hidden">
            <h4 className="text-[#80868b] text-[9px] font-black uppercase tracking-widest mb-1">Diferencial Tático</h4>
            <div className="text-xl font-black text-[#1a73e8] mt-1 italic">
               + 42% ROE
            </div>
            <div className="text-[10px] text-[#5f6368] mt-1 leading-tight font-bold uppercase">
               Vetor de ociosidade reduzido.
            </div>
         </div>
      </div>

      {/* Main Chart */}
      <div className="bg-white border border-[#dadce0] rounded-3xl p-5 shadow-sm relative overflow-hidden">
         <div className="absolute top-0 right-0 bg-black text-white text-[9px] font-black uppercase px-3 py-1 rounded-bl-xl shadow-md z-10 tracking-widest">
            DADOS AUDITADOS
         </div>
         <h3 className="font-black text-[#202124] text-sm flex items-center gap-2 mb-6 uppercase italic">
            <TrendingUp className="w-5 h-5 text-[#1a73e8]" /> Projeção de Faturamento
         </h3>
         <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
               <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorLucro" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1a73e8" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#1a73e8" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" vertical={false} />
                <XAxis dataKey="name" stroke="#80868b" fontSize={10} fontWeight="bold" tickLine={false} axisLine={false} />
                <YAxis stroke="#80868b" fontSize={10} fontWeight="bold" tickLine={false} axisLine={false} tickFormatter={(val) => `R$${val}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)', border: 'none', borderRadius: '12px', color: 'white' }}
                  itemStyle={{ color: '#1a73e8', fontWeight: '900', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="lucro" stroke="#1a73e8" strokeWidth={4} fillOpacity={1} fill="url(#colorLucro)" />
              </AreaChart>
            </ResponsiveContainer>
         </div>
      </div>

      {/* Seasonality and Locations Maps */}
      <div className="bg-white border border-[#dadce0] rounded-3xl p-5 shadow-sm">
         <h3 className="font-black text-[#202124] text-sm flex items-center gap-2 mb-4 uppercase italic">
            <MapPin className="w-5 h-5 text-[#1a73e8]" /> Zonas de Alta Conversão
         </h3>
         <div className="flex items-center">
            <div className="w-1/2 h-40">
               <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                     <Pie data={mockNeighborhoods} innerRadius={40} outerRadius={65} dataKey="value" stroke="none">
                       {mockNeighborhoods.map((entry, index) => (
                         <Cell key={`cell-${index}`} fill={entry.color} />
                       ))}
                     </Pie>
                     <Tooltip />
                  </PieChart>
               </ResponsiveContainer>
            </div>
            <div className="w-1/2 flex flex-col justify-center gap-3">
               {mockNeighborhoods.map((n, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-tighter">
                     <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: n.color }}></span>
                     <span className="text-[#3c4043]">{n.name}</span>
                  </div>
               ))}
            </div>
         </div>
      </div>

      <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-orange-500/30 rounded-2xl p-5 relative overflow-hidden">
         <h4 className="font-bold text-orange-400 flex items-center gap-2 mb-2">
           <Calendar className="w-5 h-5" /> Sazonalidade Inteligente
         </h4>
         <p className="text-gray-600 text-sm leading-relaxed mb-3">
           Baseado no seu histórico, <strong>Sextas-feiras à noite na região de Pinheiros</strong> são seus picos de ganho (+40% acima da média). 
         </p>
         <button className="bg-orange-500/20 hover:bg-orange-500/40 text-orange-400 font-bold px-4 py-2 rounded-xl text-sm transition-colors border border-orange-500/50">
            Adicionar na Trilha de Hoje
         </button>
      </div>

      <div className="bg-[#f8f9fa] border-2 border-[#dadce0] rounded-3xl p-6 shadow-sm text-center">
        <h3 className="font-black text-[#202124] text-xl mb-2 flex items-center justify-center gap-2 uppercase italic tracking-tighter">
          <Award className="w-7 h-7 text-[#1a73e8]" /> Você vs. Setor Comum
        </h3>
        <p className="text-[#5f6368] text-xs mb-6 max-w-xs mx-auto font-bold uppercase tracking-tight">
          Sua superioridade operativa convertida em poupança de recursos e tempo.
        </p>
        
        <div className="grid grid-cols-2 gap-px bg-[#dadce0] rounded-2xl overflow-hidden border border-[#dadce0]">
           <div className="bg-white p-4">
              <div className="text-[#80868b] text-[9px] font-black uppercase mb-1 tracking-widest">Média Local</div>
              <div className="text-xl font-black text-[#5f6368] italic">R$ {basePerHour.toFixed(0)}<span className="text-xs font-normal">/h</span></div>
              <div className="text-[9px] text-[#ea4335] mt-2 font-black uppercase tracking-tighter underline">Alta Ineficiência</div>
           </div>
           <div className="bg-[#1a73e8]/10 p-4 relative">
              <div className="text-[#1a73e8] text-[9px] font-black uppercase mb-1 tracking-widest">Seu Perfil</div>
              <div className="text-xl font-black text-[#1a73e8] italic">R$ {proPerHour.toFixed(0)}<span className="text-xs font-normal">/h</span></div>
              <div className="text-[9px] text-[#1e8e3e] mt-2 font-black uppercase tracking-tighter underline">Vantagem Tática</div>
           </div>
        </div>
      </div>

      {/* REVENUE SIMULATOR */}
      <div className="bg-black border-t-8 border-[#1a73e8] rounded-3xl p-6 shadow-2xl">
         <h3 className="font-black text-white text-lg mb-4 flex items-center gap-2 uppercase italic tracking-tighter">
            <Calculator className="w-5 h-5 text-[#1a73e8]" /> Simulador de Retorno Operativo
         </h3>
         
         <div className="mb-6">
            <label className="text-white/60 text-[10px] font-black flex justify-between mb-2 uppercase tracking-widest">
               <span>Esforço Diário (Horas)</span>
               <span className="text-[#1a73e8] text-base">{simulatorHours}H</span>
            </label>
            <input 
              type="range" 
              min="4" max="14" step="1" 
              value={simulatorHours}
              onChange={(e) => setSimulatorHours(parseInt(e.target.value))}
              className="w-full accent-[#1a73e8] bg-white/10 h-2 rounded-lg appearance-none cursor-pointer"
            />
            <div className="text-[9px] text-white/40 mt-3 text-center font-bold uppercase tracking-widest">Parâmetro: 22 Ciclos por Mês</div>
         </div>

         <div className="bg-white/5 rounded-2xl p-5 border border-white/10 relative overflow-hidden">
            <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-[#1a73e8]"></div>
            <div className="text-[10px] font-black text-white/60 uppercase tracking-widest mb-1">Projeção PRÉCHECA</div>
            <div className="text-4xl font-black text-white italic tracking-tighter">R$ {simulatedMonthlyPro.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}</div>
         </div>
         
         <div className="flex items-center gap-3 mt-4 text-[#1a73e8] bg-[#1a73e8]/10 px-4 py-4 rounded-xl border border-[#1a73e8]/20 shadow-inner">
            <div className="bg-[#1a73e8] p-1.5 rounded-full text-white shadow-lg">
               <TrendingUp className="w-4 h-4" />
            </div>
            <span className="text-xs font-black uppercase italic leading-tight">Ganho Excedente Gerado: <br/> R$ {diff.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
         </div>
      </div>

    </div>
  );
}
