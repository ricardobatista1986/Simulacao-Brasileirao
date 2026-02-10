import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  BarChart3, 
  RefreshCw, 
  Play, 
  Trophy, 
  AlertCircle, 
  ChevronDown,
  Zap, 
  Shield, 
  Target, 
  Search, 
  TrendingUp, 
  Sliders, 
  Activity, 
  Award,
  MapPin,
  Home,
  Table as TableIcon,
  CheckCircle2,
  PieChart,
  Calendar,
  ArrowRightLeft,
  Info,
  Trash2,
  ListOrdered
} from 'lucide-react';

/**
 * CONFIGURAÇÕES TÉCNICAS
 */
const TRAIN_SHEET_ID = '1FGqg7rC3MmE8dYhd_7g8fXQUjgV9aarjwyTEovSATBI';
const SEASON_SHEET_ID = '1Nt0hpb81Uwzltz08UaawNGVhmJUK7Jx4iIR7i_67Hp0';
const SEASON_SHEET_TAB = 'Rodadas_com jogos faltantes';

const SIMULATION_COUNT = 10000; 
const LEAGUE_SIM_COUNT = 10000; 
const EPOCHS = 100; 
const LEARNING_RATE = 0.012; 
const XI_CANDIDATES = [0.0015, 0.0020, 0.0025, 0.0030]; 

const UI_SCALE_FACTOR = 8; 

/**
 * UTILITÁRIOS ESTATÍSTICOS
 */
const simulatePoisson = (lambda) => {
  const safeLambda = Math.max(0.01, lambda);
  let L = Math.exp(-safeLambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L && k < 15);
  return k - 1;
};

const tauCorrection = (h, a, lambdaH, lambdaA, rho) => {
  if (h === 0 && a === 0) return 1 - (lambdaH * lambdaA * rho);
  if (h === 0 && a === 1) return 1 + (lambdaH * rho);
  if (h === 1 && a === 0) return 1 + (lambdaA * rho);
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
};

const calcOdd = (prob) => (prob > 0 ? (100 / prob).toFixed(2) : '99.00');

const calculateRPS = (probs, outcome) => {
    const p = [probs.home / 100, probs.draw / 100, probs.away / 100];
    const e = [outcome === 'H' ? 1 : 0, outcome === 'D' ? 1 : 0, outcome === 'A' ? 1 : 0];
    let sum = 0;
    for (let i = 0; i < 2; i++) {
        let cumP = 0, cumE = 0;
        for (let j = 0; j <= i; j++) {
            cumP += p[j];
            cumE += e[j];
        }
        sum += Math.pow(cumP - cumE, 2);
    }
    return sum / 2;
};

const runMonteCarlo = (homeTeam, awayTeam, globalHfa, rho, iterations) => {
  const attH = (homeTeam?.attack || 0) / UI_SCALE_FACTOR;
  const defH = (homeTeam?.defense || 0) / UI_SCALE_FACTOR;
  const attA = (awayTeam?.attack || 0) / UI_SCALE_FACTOR;
  const defA = (awayTeam?.defense || 0) / UI_SCALE_FACTOR;
  const hfa_eff = ((globalHfa + (homeTeam?.hfa_raw || 0)) / 2);

  const lambdaH = Math.exp(attH + defA + hfa_eff);
  const lambdaA = Math.exp(attA + defH);

  let homeWins = 0, draws = 0, awayWins = 0;
  let scoreMatrix = Array(6).fill(0).map(() => Array(6).fill(0));

  for (let i = 1; i <= iterations; i++) {
    let hG = simulatePoisson(lambdaH);
    let aG = simulatePoisson(lambdaA);

    if (hG <= 1 && aG <= 1) {
      const probAdj = tauCorrection(hG, aG, lambdaH, lambdaA, rho);
      if (Math.random() > probAdj) {
        hG = simulatePoisson(lambdaH);
        aG = simulatePoisson(lambdaA);
      }
    }

    const cH = Math.min(hG, 5);
    const cA = Math.min(aG, 5);
    scoreMatrix[cH][cA]++;

    if (hG > aG) homeWins++;
    else if (aG > hG) awayWins++;
    else draws++;
  }

  return {
    probs: {
      home: (homeWins / iterations) * 100,
      draw: (draws / iterations) * 100,
      away: (awayWins / iterations) * 100
    },
    matrix: scoreMatrix.map(row => row.map(count => (count / iterations) * 100)),
    expectedGoals: { home: lambdaH, away: lambdaA },
    expectedPointsHome: (homeWins * 3 + draws * 1) / iterations,
    expectedPointsAway: (awayWins * 3 + draws * 1) / iterations
  };
};

const simulateMatchResult = (homeTeam, awayTeam, globalHfa, rho) => {
  const attH = (homeTeam?.attack || 0) / UI_SCALE_FACTOR;
  const defH = (homeTeam?.defense || 0) / UI_SCALE_FACTOR;
  const attA = (awayTeam?.attack || 0) / UI_SCALE_FACTOR;
  const defA = (awayTeam?.defense || 0) / UI_SCALE_FACTOR;
  const hfa_eff = ((globalHfa + (homeTeam?.hfa_raw || 0)) / 2);

  const lambdaH = Math.exp(attH + defA + hfa_eff);
  const lambdaA = Math.exp(attA + defH);
  
  let hG = simulatePoisson(lambdaH);
  let aG = simulatePoisson(lambdaA);

  if (hG <= 1 && aG <= 1) {
    const probAdj = tauCorrection(hG, aG, lambdaH, lambdaA, rho);
    if (Math.random() > probAdj) {
      hG = simulatePoisson(lambdaH);
      aG = simulatePoisson(lambdaA);
    }
  }
  return { hG, aG };
};

export default function App() {
  const [teams, setTeams] = useState({});
  const [globalParams, setGlobalParams] = useState({ hfa: 0.2, rho: 0.05, xi: 0.0019 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState({ dataCount: 0, avgGoals: 0 });
  
  const [selectedHome, setSelectedHome] = useState('');
  const [selectedAway, setSelectedAway] = useState('');
  const [simulationResult, setSimulationResult] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  
  const [leagueSchedule, setLeagueSchedule] = useState([]);
  const [leagueTable, setLeagueTable] = useState([]);
  const [isSimulatingLeague, setIsSimulatingLeague] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('match');
  const [selectedRound, setSelectedRound] = useState(1);
  const [roundResults, setRoundResults] = useState({});
  const [isSimulatingRound, setIsSimulatingRound] = useState(false);
  const [modelAccuracy, setModelAccuracy] = useState(null);

  const getInsensitive = (obj, key) => {
    const foundKey = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
    return foundKey ? obj[foundKey] : undefined;
  };

  const parseCSV = (text) => {
    if (!text) return [];
    const delimiter = text.includes(';') ? ';' : ',';
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
      return headers.reduce((obj, header, i) => {
        let val = values[i];
        if (val === '' || val === undefined) val = null;
        else if (typeof val === 'string' && !isNaN(val.replace(',', '.'))) val = Number(val.replace(',', '.'));
        obj[header] = val;
        return obj;
      }, {});
    });
  };

  const trainModel = (matches, xi) => {
    const teamStats = {};
    const allTeams = new Set([...matches.map(m => m.home), ...matches.map(m => m.away)]);
    allTeams.forEach(t => teamStats[t] = { attack_raw: 0, defense_raw: 0, hfa_raw: 0 });
    let currentHfa = 0.25, currentRho = 0.00;
    const now = new Date();
    let totalError = 0;
    const weightedMatches = matches.map(m => ({ ...m, weight: Math.exp(-xi * Math.max(0, (now - m.matchDate) / (1000 * 60 * 60 * 24))) }));

    for (let e = 0; e < EPOCHS; e++) {
      totalError = 0;
      const shuffled = [...weightedMatches].sort(() => Math.random() - 0.5);
      shuffled.forEach(match => {
        const h = teamStats[match.home], a = teamStats[match.away];
        const lambdaH = Math.exp(h.attack_raw + a.defense_raw + (currentHfa + h.hfa_raw)/2);
        const lambdaA = Math.exp(a.attack_raw + h.defense_raw);
        const errorH = match.hPond - lambdaH, errorA = match.aPond - lambdaA;
        
        totalError += (errorH * errorH + errorA * errorA) * match.weight;
        
        h.attack_raw += LEARNING_RATE * errorH * match.weight;
        a.attack_raw += LEARNING_RATE * errorA * match.weight;
        
        // Defesa: se sofreu mais que esperado, defesa_raw SOBE (piora).
        a.defense_raw += LEARNING_RATE * errorH * match.weight; 
        h.defense_raw += LEARNING_RATE * errorA * match.weight; 
        
        h.hfa_raw += (LEARNING_RATE * 0.2) * errorH * match.weight;
        currentHfa += (LEARNING_RATE * 0.05) * errorH * match.weight;
        
        if (match.hPond <= 1 && match.aPond <= 1) {
           const lowScoreError = (match.hPond === match.aPond ? 1 : -1); 
           currentRho += (LEARNING_RATE * 0.01) * lowScoreError * match.weight;
        }
      });
    }
    return { teamStats, hfa: currentHfa, rho: Math.max(-0.15, Math.min(0.15, currentRho)), error: totalError };
  };

  const processTrainingData = (matches) => {
    const processed = matches.map(m => {
      const home = getInsensitive(m, 'home'), away = getInsensitive(m, 'away');
      const hG = getInsensitive(m, 'hgoals') || 0, aG = getInsensitive(m, 'agoals') || 0;
      const hxG = getInsensitive(m, 'hxg') || hG, axG = getInsensitive(m, 'axg') || aG;
      const matchDate = new Date(getInsensitive(m, 'data'));
      return { home, away, matchDate, hPond: 0.7 * hxG + 0.3 * hG, aPond: 0.7 * axG + 0.3 * aG };
    }).filter(m => m.home && m.away && !isNaN(m.matchDate));
    processed.sort((a, b) => a.matchDate - b.matchDate);
    let bestXi = 0.0019, minErr = Infinity, bestModel = null;
    XI_CANDIDATES.forEach(xi => {
      const res = trainModel(processed, xi);
      if (res.error < minErr) { minErr = res.error; bestXi = xi; bestModel = res; }
    });
    const finalTeams = bestModel.teamStats, tCount = Object.keys(finalTeams).length;
    const avgAtt = Object.values(finalTeams).reduce((s, t) => s + t.attack_raw, 0) / tCount;
    const avgDef = Object.values(finalTeams).reduce((s, t) => s + t.defense_raw, 0) / tCount;
    Object.keys(finalTeams).forEach(n => {
      const att_zeroed = finalTeams[n].attack_raw - avgAtt, def_zeroed = finalTeams[n].defense_raw - avgDef;
      finalTeams[n].attack = Math.max(-5, Math.min(5, att_zeroed * UI_SCALE_FACTOR));
      finalTeams[n].defense = Math.max(-5, Math.min(5, def_zeroed * UI_SCALE_FACTOR));
      finalTeams[n].hfa_raw = finalTeams[n].hfa_raw;
    });
    setTeams(finalTeams);
    setGlobalParams({ hfa: bestModel.hfa, rho: bestModel.rho, xi: bestXi });
    setMetrics({ dataCount: processed.length, avgGoals: processed.reduce((s,m) => s + m.hPond + m.aPond, 0) / processed.length });
  };

  const processLeagueSchedule = (matches) => {
    const schedule = matches.map(m => ({
      round: getInsensitive(m, 'rodada'),
      home: getInsensitive(m, 'home'),
      away: getInsensitive(m, 'away'),
      hGoals: getInsensitive(m, 'hgoals'),
      aGoals: getInsensitive(m, 'agoals'),
      played: getInsensitive(m, 'hgoals') !== null && getInsensitive(m, 'hgoals') !== undefined && String(getInsensitive(m, 'hgoals')).trim() !== ''
    })).filter(m => m.home && m.away);
    setLeagueSchedule(schedule);
    const lastPlayed = [...schedule].reverse().find(m => m.played);
    setSelectedRound(lastPlayed ? (Number(lastPlayed.round) || 1) + 1 : 1);
  };

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const trainUrl = `https://docs.google.com/spreadsheets/d/${TRAIN_SHEET_ID}/export?format=csv&t=${Date.now()}`;
      const trainRes = await fetch(trainUrl);
      const trainCsv = await trainRes.text();
      processTrainingData(parseCSV(trainCsv));
      const leagueUrl = `https://docs.google.com/spreadsheets/d/${SEASON_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SEASON_SHEET_TAB)}&t=${Date.now()}`;
      const leagueRes = await fetch(leagueUrl);
      const leagueCsv = await leagueRes.text();
      processLeagueSchedule(parseCSV(leagueCsv));
      setLoading(false);
    } catch (err) { setError("Erro ao carregar dados."); setLoading(false); }
  }, []);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  useEffect(() => {
    if (Object.keys(teams).length > 0 && leagueSchedule.length > 0) {
        const playedGames = leagueSchedule.filter(m => m.played);
        if (playedGames.length > 0) {
            let totalRPS = 0;
            playedGames.forEach(m => {
                if (teams[m.home] && teams[m.away]) {
                    const sim = runMonteCarlo(teams[m.home], teams[m.away], globalParams.hfa, globalParams.rho, 10000);
                    const outcome = Number(m.hGoals) > Number(m.aGoals) ? 'H' : (Number(m.hGoals) < Number(m.aGoals) ? 'A' : 'D');
                    totalRPS += calculateRPS(sim.probs, outcome);
                }
            });
            setModelAccuracy(Math.max(0, 100 * (1 - (totalRPS / playedGames.length))).toFixed(1));
        }
    }
  }, [teams, leagueSchedule, globalParams]);

  const runLeagueSimulation = () => {
    if (!leagueSchedule.length || Object.keys(teams).length === 0) return;
    setIsSimulatingLeague(true);
    setTimeout(() => {
      const stats = {};
      const currentSeasonTeams = new Set();
      leagueSchedule.forEach(m => { if(m.home) currentSeasonTeams.add(m.home); if(m.away) currentSeasonTeams.add(m.away); });
      currentSeasonTeams.forEach(t => stats[t] = { simPoints: 0, title: 0, liberta: 0, preLiberta: 0, sula: 0, z4: 0 });

      for (let i = 0; i < LEAGUE_SIM_COUNT; i++) {
        const currentStandings = {};
        currentSeasonTeams.forEach(t => currentStandings[t] = 0);
        leagueSchedule.forEach(match => {
          let hG, aG;
          if (match.played) { hG = Number(match.hGoals); aG = Number(match.aGoals); }
          else {
            const res = simulateMatchResult(teams[match.home] || {attack:0, defense:0}, teams[match.away] || {attack:0, defense:0}, globalParams.hfa, globalParams.rho);
            hG = res.hG; aG = res.aG;
          }
          if (currentStandings.hasOwnProperty(match.home) && currentStandings.hasOwnProperty(match.away)) {
            if (hG > aG) currentStandings[match.home] += 3;
            else if (aG > hG) currentStandings[match.away] += 3;
            else { currentStandings[match.home] += 1; currentStandings[match.away] += 1; }
          }
        });
        const sorted = Object.entries(currentStandings).sort(([,a], [,b]) => b - a);
        sorted.forEach(([team, pts], rank) => {
          if (stats[team]) {
            stats[team].simPoints += pts;
            if (rank === 0) stats[team].title++;
            if (rank < 6) stats[team].liberta++;
            if (rank < 8) stats[team].preLiberta++;
            if (rank < 12) stats[team].sula++;
            if (rank >= sorted.length - 4) stats[team].z4++;
          }
        });
      }
      setLeagueTable(Object.entries(stats).map(([name, s]) => ({
        name, avgPoints: s.simPoints / LEAGUE_SIM_COUNT,
        titleProb: (s.title / LEAGUE_SIM_COUNT) * 100,
        libertaProb: (s.liberta / LEAGUE_SIM_COUNT) * 100,
        preLibertaProb: (s.preLiberta / LEAGUE_SIM_COUNT) * 100,
        sulaProb: (s.sula / LEAGUE_SIM_COUNT) * 100,
        z4Prob: (s.z4 / LEAGUE_SIM_COUNT) * 100
      })).sort((a, b) => b.avgPoints - a.avgPoints));
      setIsSimulatingLeague(false);
    }, 100);
  };

  const handleSimulateMatch = () => {
    if (!selectedHome || !selectedAway) return;
    setIsSimulating(true);
    setTimeout(() => {
      setSimulationResult(runMonteCarlo(teams[selectedHome], teams[selectedAway], globalParams.hfa, globalParams.rho, SIMULATION_COUNT));
      setIsSimulating(false);
    }, 400);
  };

  const handleResetMatch = () => {
    setSelectedHome('');
    setSelectedAway('');
    setSimulationResult(null);
  };

  const handleSimulateRound = () => {
    if (!roundGamesData.length) return;
    setIsSimulatingRound(true);
    setTimeout(() => {
        const results = {};
        roundGamesData.forEach(m => {
            const hStats = teams[m.home];
            const aStats = teams[m.away];
            if (hStats && aStats) {
                results[`${m.home}-${m.away}`] = runMonteCarlo(hStats, aStats, globalParams.hfa, globalParams.rho, 10000);
            }
        });
        setRoundResults(results);
        setIsSimulatingRound(false);
    }, 200);
  };

  const roundGamesData = useMemo(() => leagueSchedule.filter(m => Number(m.round) === selectedRound), [leagueSchedule, selectedRound]);
  const powerRanking = useMemo(() => Object.entries(teams).map(([name, stats]) => ({ name, ...stats, strength: stats.attack - stats.defense })).filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => b.strength - a.strength), [teams, searchTerm]);

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-4 text-center">
      <Activity className="w-10 h-10 text-orange-500 animate-pulse mb-4" />
      <h2 className="text-lg font-black uppercase tracking-tighter leading-tight">Calibrando Inteligência 2026</h2>
      <p className="text-slate-500 text-[10px] mt-4 font-mono uppercase tracking-[0.2em]">Optimizing Odds | Season Mapping</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-12">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 px-4 py-2.5 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="bg-slate-900 p-1.5 rounded-lg shrink-0"><Target className="text-orange-400 w-4 h-4 sm:w-5 sm:h-5" /></div>
          <div>
            <h1 className="text-xs sm:text-sm font-black tracking-tighter uppercase leading-none text-slate-800">Dixon-Coles Pro</h1>
            <p className="text-[7px] sm:text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1 italic leading-none">Época 2026</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {modelAccuracy && (
            <div className="flex flex-col items-end border-r border-slate-200 pr-2 sm:pr-4">
                <span className="text-[7px] font-black text-slate-400 uppercase leading-none">Backtesting</span>
                <span className="text-[10px] sm:text-xs font-black text-emerald-500 tracking-tight leading-tight">{modelAccuracy}% Precision</span>
            </div>
          )}
          <button onClick={fetchAllData} className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded-full border border-slate-200 shadow-sm shrink-0"><RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" /></button>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto p-3 sm:p-4 space-y-5">
        <div className="flex flex-row overflow-x-auto gap-1 p-1 bg-white rounded-xl border border-slate-200 w-full shadow-sm no-scrollbar">
          <button onClick={() => setActiveTab('match')} className={`flex-1 whitespace-nowrap px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all flex items-center justify-center gap-1.5 ${activeTab === 'match' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400'}`}><Zap className="w-3 h-3" /> Jogo</button>
          <button onClick={() => setActiveTab('round')} className={`flex-1 whitespace-nowrap px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all flex items-center justify-center gap-1.5 ${activeTab === 'round' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400'}`}><Calendar className="w-3 h-3" /> Rodada</button>
          <button onClick={() => setActiveTab('league')} className={`flex-1 whitespace-nowrap px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all flex items-center justify-center gap-1.5 ${activeTab === 'league' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400'}`}><TableIcon className="w-3 h-3" /> Liga</button>
          <button onClick={() => setActiveTab('ranking')} className={`flex-1 whitespace-nowrap px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all flex items-center justify-center gap-1.5 ${activeTab === 'ranking' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400'}`}><ListOrdered className="w-3 h-3" /> Ranking</button>
        </div>

        {/* JOGO ÚNICO */}
        {activeTab === 'match' && (
          <div className="space-y-5 animate-in fade-in duration-500">
            <section className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/40 border border-slate-200 overflow-hidden">
              <div className="bg-slate-900 p-5 text-white relative">
                <div className="flex flex-col gap-3">
                    <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-1 leading-none">Mandante</label>
                      <select value={selectedHome} onChange={(e) => setSelectedHome(e.target.value)} className="w-full bg-white/10 border border-white/20 rounded-xl p-2.5 font-black text-sm outline-none text-white appearance-none cursor-pointer leading-tight">
                        <option value="" className="text-slate-900">Selecionar...</option>
                        {Object.keys(teams).sort().map(t => <option key={t} value={t} className="text-slate-900">{t}</option>)}
                      </select>
                    </div>
                    <div className="flex justify-center text-orange-500/50 text-lg font-black italic leading-none py-0.5">VS</div>
                    <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-1 block leading-none">Visitante</label>
                      <select value={selectedAway} onChange={(e) => setSelectedAway(e.target.value)} className="w-full bg-white/10 border border-white/20 rounded-xl p-2.5 font-black text-sm outline-none text-white appearance-none cursor-pointer leading-tight">
                        <option value="" className="text-slate-900">Selecionar...</option>
                        {Object.keys(teams).sort().map(t => <option key={t} value={t} className="text-slate-900">{t}</option>)}
                      </select>
                    </div>
                </div>
                <div className="mt-6 flex gap-3">
                  <button onClick={handleSimulateMatch} disabled={isSimulating || !selectedHome || !selectedAway || selectedHome === selectedAway} className="flex-1 py-4.5 rounded-xl font-black text-white uppercase tracking-widest shadow-2xl bg-orange-600 hover:bg-orange-500 transition-all active:scale-[0.98] disabled:opacity-30 flex items-center justify-center gap-2 text-[10px]">
                    {isSimulating ? <Activity className="animate-spin w-4 h-4" /> : <Play className="fill-current w-3.5 h-3.5" />} PREVISÃO
                  </button>
                  <button onClick={handleResetMatch} className="py-4 px-5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all shadow-xl flex items-center justify-center" title="Limpar"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </section>

            {simulationResult && (
              <div className="space-y-5 animate-in slide-in-from-bottom-4 duration-500">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                          <Home className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span className="text-[9px] font-black uppercase text-slate-800 truncate">{selectedHome}</span>
                      </div>
                      <div className="flex justify-between items-center mb-1 leading-none text-[10px]"><span className="text-slate-400 font-bold uppercase">Atq:</span><span className="font-black text-emerald-600">{teams[selectedHome]?.attack.toFixed(2)}</span></div>
                      <div className="flex justify-between items-center leading-none text-[10px]"><span className="text-slate-400 font-bold uppercase">Def:</span><span className={`font-black ${teams[selectedHome]?.defense < 0 ? 'text-blue-500' : 'text-orange-500'}`}>{teams[selectedHome]?.defense.toFixed(2)}</span></div>
                  </div>
                  <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm text-right">
                      <div className="flex items-center gap-2 mb-2 justify-end">
                          <span className="text-[10px] font-black uppercase text-slate-800 truncate">{selectedAway}</span>
                          <MapPin className="w-3 h-3 text-blue-400 shrink-0" />
                      </div>
                      <div className="flex justify-between items-center mb-1 leading-none text-[10px]"><span className="text-slate-400 font-bold uppercase">Atq:</span><span className="font-black text-emerald-600">{teams[selectedAway]?.attack.toFixed(2)}</span></div>
                      <div className="flex justify-between items-center leading-none text-[10px]"><span className="text-slate-400 font-bold uppercase">Def:</span><span className={`font-black ${teams[selectedAway]?.defense < 0 ? 'text-blue-500' : 'text-orange-500'}`}>{teams[selectedAway]?.defense.toFixed(2)}</span></div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm text-center">
                    <p className="text-[8px] font-black text-slate-300 uppercase mb-1.5 truncate leading-none">{selectedHome}</p>
                    <h3 className="text-xl font-black text-slate-800 tabular-nums leading-none">{simulationResult.probs.home.toFixed(1)}%</h3>
                    <div className="mt-2 flex flex-col gap-1">
                      <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded-full uppercase leading-none">Odd: {calcOdd(simulationResult.probs.home)}</span>
                      <span className="text-[8px] font-bold text-slate-400 uppercase italic">xG: {simulationResult.expectedGoals.home.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm text-center flex flex-col justify-center">
                    <p className="text-[8px] font-black text-slate-300 uppercase mb-1.5 leading-none">Empate</p>
                    <h3 className="text-xl font-black text-slate-800 tabular-nums leading-none">{simulationResult.probs.draw.toFixed(1)}%</h3>
                  </div>
                  <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm text-center">
                    <p className="text-[8px] font-black text-slate-300 uppercase mb-1.5 truncate leading-none">{selectedAway}</p>
                    <h3 className="text-xl font-black text-slate-800 tabular-nums leading-none">{simulationResult.probs.away.toFixed(1)}%</h3>
                    <div className="mt-1.5 flex flex-col gap-1">
                      <span className="text-[8px] font-black text-blue-600 bg-blue-50 px-1 py-0.5 rounded-full uppercase leading-none">Odd: {calcOdd(simulationResult.probs.away)}</span>
                      <span className="text-[8px] font-bold text-slate-400 uppercase italic">xG: {simulationResult.expectedGoals.away.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-xl overflow-hidden p-4">
                  <div className="flex flex-col sm:flex-row justify-between items-center mb-5 gap-3 border-b border-slate-100 pb-4 text-center sm:text-left">
                    <h4 className="font-black text-slate-800 text-[11px] uppercase tracking-wider flex items-center justify-center sm:justify-start gap-1.5 leading-none"><PieChart className="w-3.5 h-3.5 text-orange-600" /> Matriz de Resultados</h4>
                    <div className="flex gap-2 w-full sm:w-auto justify-center">
                        <div className="flex-1 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 text-center leading-none">
                           <span className="text-[7px] font-black text-emerald-500 uppercase block mb-1 tracking-tighter">xPts Casa</span>
                           <span className="text-xs font-black text-slate-800 tabular-nums leading-none">{simulationResult.expectedPointsHome.toFixed(2)}</span>
                        </div>
                        <div className="flex-1 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 text-center leading-none">
                           <span className="text-[7px] font-black text-blue-500 uppercase block mb-1 tracking-tighter">xPts Fora</span>
                           <span className="text-xs font-black text-slate-800 tabular-nums leading-none">{simulationResult.expectedPointsAway.toFixed(2)}</span>
                        </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-center">
                     <div className="mb-3 text-[9px] font-black text-orange-600 uppercase tracking-[0.4em] flex items-center gap-2 shrink-0">
                        <MapPin className="w-3 h-3" /> VISITANTE →
                     </div>
                     <div className="flex gap-1 w-full justify-center">
                        <div className="[writing-mode:vertical-lr] rotate-180 text-[9px] font-black text-orange-600 uppercase tracking-[0.4em] flex items-center gap-2 shrink-0">
                           <Home className="w-3.5 h-3.5" /> MANDANTE →
                        </div>
                        <div className="w-full max-w-[450px]">
                          <div className="grid grid-cols-7 gap-0.5 pb-1">
                            <div className="col-span-1"></div>
                            {Array.from({length: 6}).map((_, i) => <div key={i} className="text-center text-[12px] sm:text-sm font-black text-slate-400 uppercase leading-none pb-1">{i}</div>)}
                            {simulationResult.matrix.map((row, hS) => (
                              <React.Fragment key={hS}>
                                <div className="flex items-center justify-end pr-2 text-[10px] font-black text-slate-400 uppercase leading-none">{hS}</div>
                                {row.map((prob, aS) => {
                                  const intensity = Math.min(prob * 10, 100);
                                  return (
                                    <div key={aS} className="aspect-square rounded-sm flex items-center justify-center transition-all cursor-help group relative border border-white/5" style={{ backgroundColor: `rgba(234, 88, 12, ${intensity / 100})`, color: intensity > 40 ? 'white' : '#9a3412' }}>
                                      <span className="text-[11px] sm:text-[14px] font-black tabular-nums leading-none">{prob.toFixed(1)}%</span>
                                    </div>
                                  );
                                })}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                     </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* RODADA */}
        {activeTab === 'round' && (
          <div className="space-y-5 animate-in fade-in duration-500">
              <section className="bg-white rounded-[1.5rem] shadow-sm border border-slate-200 p-5 md:p-8 text-center sm:text-left">
                  <div className="flex flex-col sm:flex-row items-center justify-between mb-6 gap-4">
                      <h3 className="font-black text-slate-800 text-sm sm:text-lg uppercase tracking-tight flex items-center gap-2 leading-none"><Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" /> Previsões da Rodada</h3>
                      <div className="flex items-center gap-3 w-full sm:w-auto">
                          <span className="text-[9px] font-black text-slate-400 uppercase">Jornada</span>
                          <select value={selectedRound} onChange={(e) => { setSelectedRound(Number(e.target.value)); setRoundResults({}); }} className="flex-1 sm:flex-none bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 font-bold text-xs outline-none cursor-pointer leading-none">
                              {Array.from({length: 38}).map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
                          </select>
                      </div>
                  </div>

                  <button onClick={handleSimulateRound} disabled={isSimulatingRound || !roundGamesData.length} className="w-full mb-6 py-6 bg-orange-600 hover:bg-orange-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-4 shadow-xl">
                      {isSimulatingRound ? <RefreshCw className="animate-spin w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />} SIMULAR RODADA
                  </button>

                  <div className="grid grid-cols-1 gap-3">
                      {roundGamesData.length > 0 ? roundGamesData.map((m, idx) => {
                          const result = roundResults[`${m.home}-${m.away}`];
                          return (
                              <div key={idx} className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-center justify-between group hover:bg-white hover:shadow-xl transition-all relative overflow-hidden">
                                  {/* Casa - Forçado para Esquerda */}
                                  <div className="flex-1 text-left flex flex-col gap-1 pr-1">
                                      <p className="font-black text-slate-800 uppercase leading-none truncate w-full text-left" style={{ fontSize: 'clamp(10px, 3.1vw, 14px)' }}>{m.home}</p>
                                      {result ? (
                                          <>
                                              <p className="text-[14px] sm:text-lg font-black text-emerald-600 leading-none text-left">{result.probs.home.toFixed(1)}%</p>
                                              <div className="flex flex-col leading-tight mt-1 items-start text-left">
                                                  <span className="text-[8px] sm:text-[9px] text-slate-400 font-bold uppercase italic leading-none">xG: {result.expectedGoals.home.toFixed(2)}</span>
                                                  <span className="text-[8px] sm:text-[9px] text-slate-400 font-bold uppercase italic leading-none mt-1">Odd: {calcOdd(result.probs.home)}</span>
                                              </div>
                                          </>
                                      ) : <p className="text-[8px] text-slate-300 font-black uppercase leading-none text-left">Pendente</p>}
                                  </div>

                                  {/* Centro (Empate) - Destaque */}
                                  <div className="flex flex-col items-center px-1 shrink-0 z-10">
                                      <div className="text-[8px] font-black text-slate-200 italic leading-none mb-1">VS</div>
                                      {result && (
                                        <div className="bg-slate-900 px-3 py-2 rounded-xl flex flex-col items-center shadow-lg border border-white/10 min-w-[55px]">
                                            <span className="text-[7px] font-black text-slate-400 uppercase leading-none mb-0.5 tracking-tighter">EMPATE</span>
                                            <span className="text-[12px] sm:text-sm font-black text-white leading-none tabular-nums">{result.probs.draw.toFixed(0)}%</span>
                                        </div>
                                      )}
                                  </div>

                                  {/* Fora - Forçado para Direita */}
                                  <div className="flex-1 text-right flex flex-col items-end gap-1 pl-1">
                                      <p className="font-black text-slate-800 uppercase leading-none truncate w-full text-right" style={{ fontSize: 'clamp(10px, 3.1vw, 14px)' }}>{m.away}</p>
                                      {result ? (
                                          <>
                                              <p className="text-[14px] sm:text-lg font-black text-blue-600 leading-none text-right">{result.probs.away.toFixed(1)}%</p>
                                              <div className="flex flex-col items-end leading-tight mt-1 text-right">
                                                  <span className="text-[8px] sm:text-[9px] text-slate-400 font-bold uppercase italic leading-none">xG: {result.expectedGoals.away.toFixed(2)}</span>
                                                  <span className="text-[8px] sm:text-[9px] text-slate-400 font-bold uppercase italic leading-none mt-1">Odd: {calcOdd(result.probs.away)}</span>
                                              </div>
                                          </>
                                      ) : <p className="text-[8px] text-slate-300 font-black uppercase leading-none text-right">Pendente</p>}
                                  </div>
                              </div>
                          );
                      }) : <div className="text-center py-20 text-slate-300 font-black uppercase text-xs tracking-widest border-2 border-dashed border-slate-100 rounded-2xl">Nenhum jogo encontrado</div>}
                  </div>
              </section>
          </div>
        )}

        {/* LIGA */}
        {activeTab === 'league' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <section className="bg-white rounded-[1.5rem] shadow-sm border border-slate-200 p-5 md:p-10 text-center sm:text-left">
              <div className="flex flex-col justify-between items-center gap-6 mb-8 text-center">
                <h3 className="font-black text-slate-800 text-base uppercase tracking-tight flex items-center justify-center gap-3 leading-none"><Trophy className="w-6 h-6 text-yellow-500 fill-current" /> Temporada 2026</h3>
                <button onClick={runLeagueSimulation} disabled={isSimulatingLeague || !leagueSchedule.length} className="w-full sm:w-auto px-10 py-6 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-4">
                  {isSimulatingLeague ? <RefreshCw className="animate-spin w-5 h-5" /> : <TableIcon className="w-5 h-5" />} SIMULAR TEMPORADA
                </button>
              </div>
              {leagueTable.length > 0 ? (
                <div className="overflow-x-auto rounded-3xl border border-slate-100 shadow-inner no-scrollbar">
                  <table className="w-full text-left border-collapse min-w-[360px]">
                    <thead className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase border-b border-slate-100">
                      <tr><th className="px-1 py-4 w-6 text-center">#</th><th className="px-2 py-4">EQUIPE</th><th className="px-1 py-4 text-center text-slate-800">XPTS</th><th className="px-1 py-4 text-center text-orange-600">TIT</th><th className="px-1 py-4 text-center text-emerald-600">G6</th><th className="px-1 py-4 text-center text-red-500">Z4</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[11px] sm:text-[13px] font-bold text-slate-700">
                      {leagueTable.map((row, idx) => (
                        <tr key={row.name} className="hover:bg-orange-50/20 transition-colors">
                          <td className="px-1 py-4 text-slate-300 font-black text-center text-[10px]">{idx + 1}</td>
                          <td className="px-2 py-4 text-slate-900 font-black uppercase tracking-tighter truncate max-w-[85px] leading-tight text-[11px]">{row.name}</td>
                          <td className="px-1 py-4 text-center font-mono font-black text-slate-900 bg-slate-50/50 text-[11px] leading-none">{row.avgPoints.toFixed(1)}</td>
                          <td className="px-1 py-4 text-center font-black text-orange-600 text-[11px] leading-none">{row.titleProb > 0.05 ? `${row.titleProb.toFixed(1)}%` : '-'}</td>
                          <td className="px-1 py-4 text-center font-black text-emerald-600 text-[11px] leading-none">{row.libertaProb > 0.05 ? `${row.libertaProb.toFixed(1)}%` : '-'}</td>
                          <td className="px-1 py-4 text-center font-black text-red-500 text-[11px] leading-none">{row.z4Prob > 0.05 ? `${row.z4Prob.toFixed(1)}%` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-center py-24 border-4 border-dashed border-slate-50 rounded-[3rem]"><TableIcon className="w-16 h-16 text-slate-100 mx-auto mb-6" /><p className="text-slate-300 text-[10px] font-black uppercase tracking-widest">Simulação pendente</p></div>}
            </section>
          </div>
        )}

        {/* RANKING */}
        {activeTab === 'ranking' && (
          <div className="space-y-6 animate-in fade-in duration-500">
             <section className="bg-white rounded-[1.5rem] shadow-xl border border-slate-200 overflow-hidden">
                <div className="p-6 md:p-10 bg-slate-50 border-b border-slate-200 text-center sm:text-left">
                    <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4">
                        <div className="space-y-1">
                            <h3 className="font-black text-slate-800 text-lg uppercase tracking-tight leading-none">Power Ranking Técnico</h3>
                            <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] leading-none mt-2">Dixon-Coles WMLE [-5, +5]</p>
                        </div>
                        <Award className="w-8 h-8 text-orange-500 shrink-0" />
                    </div>
                    <div className="relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-focus-within:text-orange-500 transition-all" />
                        <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Pesquisar por equipa..." className="w-full bg-white border-2 border-slate-100 rounded-2xl py-4 pl-12 pr-4 font-bold text-sm outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all shadow-sm" />
                    </div>
                </div>
                <div className="overflow-x-auto no-scrollbar px-2 sm:px-0">
                  <table className="w-full text-left border-collapse min-w-[320px]">
                    <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase border-b border-slate-100">
                        <tr><th className="px-4 py-5 sm:px-8">Equipe</th><th className="px-2 py-5 text-center">Ataque</th><th className="px-4 py-5 sm:px-8 text-center">Defesa</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {powerRanking.map((team, idx) => (
                        <tr key={team.name} className="hover:bg-orange-50/50 transition-colors">
                          <td className="px-4 py-6 sm:px-8 flex flex-col gap-1"><span className="text-[12px] sm:text-base font-black text-slate-800 uppercase tracking-tight leading-none truncate max-w-[120px]">{team.name}</span><span className="text-[8px] font-black text-slate-300 uppercase tracking-[0.2em] mt-1">Global #{idx + 1}</span></td>
                          <td className="px-2 py-6 text-center"><div className={`text-[11px] sm:text-sm font-mono font-black px-2 py-1 rounded-lg ${team.attack > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 bg-slate-50'}`}>{team.attack.toFixed(2)}</div></td>
                          <td className="px-4 py-6 sm:px-8 text-center"><div className={`text-[11px] sm:text-sm font-mono font-black px-2 py-1 rounded-lg ${team.defense < 0 ? 'text-blue-600 bg-blue-50' : 'text-orange-600 bg-orange-50'}`}>{team.defense.toFixed(2)}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-8 bg-slate-900 text-white relative text-center sm:text-left">
                   <div className="relative z-10 flex flex-col gap-6">
                      <div className="flex flex-col sm:flex-row items-center gap-4 border-b border-white/10 pb-6">
                        <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                        <div><p className="text-[11px] font-black text-emerald-400 uppercase tracking-widest leading-none mb-2">Backtesting Automatizado</p><p className="text-[10px] text-slate-400 font-medium leading-relaxed uppercase">RPS (Ranked Probability Score): {modelAccuracy || '--'}%.</p></div>
                      </div>
                      <div className="flex flex-col sm:flex-row items-center gap-4">
                        <Shield className="w-8 h-8 text-orange-500 shrink-0" />
                        <div><p className="text-[11px] font-black text-orange-600 uppercase tracking-widest leading-none mb-2">Padrão Dixon-Coles</p><p className="text-[10px] text-slate-400 font-medium leading-relaxed uppercase">Métrica em 0. Ataque alto (+) e Defesa baixa (-) são ideais.</p></div>
                      </div>
                   </div>
                </div>
             </section>
          </div>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        .animate-in { animation: fade-in 0.5s ease-out; }
      `}} />
    </div>
  );
}