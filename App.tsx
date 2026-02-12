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
 * CONFIGURAÇÕES TÉCNICAS E ESTATÍSTICAS
 */
const TRAIN_SHEET_ID = '1FGqg7rC3MmE8dYhd_7g8fXQUjgV9aarjwyTEovSATBI';
const SEASON_SHEET_ID = '1Nt0hpb81Uwzltz08UaawNGVhmJUK7Jx4iIR7i_67Hp0';
const SEASON_SHEET_TAB = 'Rodadas_com jogos faltantes';

const SIMULATION_COUNT = 10000; 
const LEAGUE_SIM_COUNT = 10000; 
const EPOCHS = 100; 
const LEARNING_RATE = 0.012; 
const XI_CANDIDATES = [0.000, 0.0005, 0.0010, 0.0015, 0.0020, 0.0025, 0.0030]; 

const UI_SCALE_FACTOR = 11; 
const MAX_RATING = 3.0; 

/**
 * UTILITÁRIOS ESTATÍSTICOS
 */
const simulatePoisson = (lambda) => {
  const safeLambda = Math.max(0.01, lambda);
  let L = Math.exp(-safeLambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L && k < 15);
  return k - 1;
};

const tauCorrection = (h, a, lambdaH, lambdaA, rho) => {
  if (h === 0 && a === 1) return 1 + (lambdaH * rho);
  if (h === 1 && a === 0) return 1 + (lambdaA * rho);
  if (h === 1 && a === 1) return 1 - rho;
  if (h === 0 && a === 0) return 1 - (lambdaH * lambdaA * rho);
  return 1;
};

const calcOdd = (prob) => (prob > 0 ? (100 / prob).toFixed(2) : '99.00');

const calculateRPS = (probs, outcome) => {
    const p = [probs.home / 100, probs.draw / 100, probs.away / 100];
    const e = [outcome === 'H' ? 1 : 0, outcome === 'D' ? 1 : 0, outcome === 'A' ? 1 : 0];
    let sum = 0;
    for (let i = 0; i < 2; i++) {
        let cumP = 0, cumE = 0;
        for (let j = 0; j <= i; j++) { cumP += p[j]; cumE += e[j]; }
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
      if (Math.random() > probAdj) { hG = simulatePoisson(lambdaH); aG = simulatePoisson(lambdaA); }
    }
    const cH = Math.min(hG, 5), cA = Math.min(aG, 5);
    scoreMatrix[cH][cA]++;
    if (hG > aG) homeWins++; else if (aG > hG) awayWins++; else draws++;
  }

  return {
    probs: { home: (homeWins / iterations) * 100, draw: (draws / iterations) * 100, away: (awayWins / iterations) * 100 },
    matrix: scoreMatrix.map(row => row.map(count => (count / iterations) * 100)),
    expectedGoals: { home: lambdaH, away: lambdaA },
    expectedPointsHome: (homeWins * 3 + draws * 1) / iterations,
    expectedPointsAway: (awayWins * 3 + draws * 1) / iterations
  };
};

const simulateMatchResult = (homeTeam, awayTeam, globalHfa, rho) => {
  const attH = (homeTeam?.attack || 0) / UI_SCALE_FACTOR, defH = (homeTeam?.defense || 0) / UI_SCALE_FACTOR;
  const attA = (awayTeam?.attack || 0) / UI_SCALE_FACTOR, defA = (awayTeam?.defense || 0) / UI_SCALE_FACTOR;
  const hfa_eff = ((globalHfa + (homeTeam?.hfa_raw || 0)) / 2);
  const lambdaH = Math.exp(attH + defA + hfa_eff), lambdaA = Math.exp(attA + defH);
  let hG = simulatePoisson(lambdaH), aG = simulatePoisson(lambdaA);
  if (hG <= 1 && aG <= 1) {
    const probAdj = tauCorrection(hG, aG, lambdaH, lambdaA, rho);
    if (Math.random() > probAdj) { hG = simulatePoisson(lambdaH); aG = simulatePoisson(lambdaA); }
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

  const getInsensitive = (obj, key) => {
    const foundKey = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
    return foundKey ? obj[foundKey] : undefined;
  };

  const trainModel = (matches, xi) => {
    const teamStats = {};
    const allTeams = new Set([...matches.map(m => m.home), ...matches.map(m => m.away)]);
    allTeams.forEach(t => teamStats[t] = { attack_raw: 0, defense_raw: 0, hfa_raw: 0 });
    let currentHfa = 0.25, currentRho = 0.00;
    const now = new Date();
    const weightedMatches = matches.map(m => ({...m, weight: Math.exp(-xi * Math.max(0, (now - m.matchDate) / (1000 * 60 * 60 * 24)))}));
    for (let e = 0; e < EPOCHS; e++) {
      weightedMatches.forEach(match => {
        const h = teamStats[match.home], a = teamStats[match.away];
        const lambdaH = Math.exp(h.attack_raw + a.defense_raw + (currentHfa + h.hfa_raw)/2);
        const lambdaA = Math.exp(a.attack_raw + h.defense_raw);
        const errorH = match.hPond - lambdaH, errorA = match.aPond - lambdaA;
        h.attack_raw += LEARNING_RATE * errorH * match.weight;
        a.attack_raw += LEARNING_RATE * errorA * match.weight;
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
    return { teamStats, hfa: currentHfa, rho: Math.max(-0.15, Math.min(0.15, currentRho)) };
  };

  const processTrainingData = (matches) => {
    const processed = matches.map(m => {
      const home = getInsensitive(m, 'home'), away = getInsensitive(m, 'away');
      const hG = getInsensitive(m, 'hgoals') || 0, aG = getInsensitive(m, 'agoals') || 0;
      const hxG = getInsensitive(m, 'hxg') || hG, axG = getInsensitive(m, 'axg') || aG;
      const matchDate = new Date(getInsensitive(m, 'data'));
      return { home, away, matchDate, hPond: 0.7 * hxG + 0.3 * hG, aPond: 0.7 * axG + 0.3 * aG, hG, aG };
    }).filter(m => m.home && m.away && !isNaN(m.matchDate));
    processed.sort((a, b) => a.matchDate - b.matchDate);
    const splitIdx = Math.floor(processed.length * 0.85);
    const trainSet = processed.slice(0, splitIdx);
    const validationSet = processed.slice(splitIdx);
    let bestXi = 0.0019, minRps = Infinity;
    XI_CANDIDATES.forEach(xi => {
      const model = trainModel(trainSet, xi);
      let totalRps = 0;
      validationSet.forEach(m => {
          const tH = { ...model.teamStats[m.home], attack: model.teamStats[m.home].attack_raw * UI_SCALE_FACTOR, defense: model.teamStats[m.home].defense_raw * UI_SCALE_FACTOR };
          const tA = { ...model.teamStats[m.away], attack: model.teamStats[m.away].attack_raw * UI_SCALE_FACTOR, defense: model.teamStats[m.away].defense_raw * UI_SCALE_FACTOR };
          const sim = runMonteCarlo(tH, tA, model.hfa, model.rho, 2000);
          const outcome = m.hG > m.aG ? 'H' : (m.hG < m.aG ? 'A' : 'D');
          totalRps += calculateRPS(sim.probs, outcome);
      });
      const avgRps = totalRps / validationSet.length;
      if (avgRps < minRps) { minRps = avgRps; bestXi = xi; }
    });
    const finalModel = trainModel(processed, bestXi);
    const finalTeams = finalModel.teamStats, tCount = Object.keys(finalTeams).length;
    const avgAtt = Object.values(finalTeams).reduce((s, t) => s + t.attack_raw, 0) / tCount;
    const avgDef = Object.values(finalTeams).reduce((s, t) => s + t.defense_raw, 0) / tCount;
    Object.keys(finalTeams).forEach(n => {
      const att_zeroed = finalTeams[n].attack_raw - avgAtt, def_zeroed = finalTeams[n].defense_raw - avgDef;
      finalTeams[n].attack = Math.max(-MAX_RATING, Math.min(MAX_RATING, att_zeroed * UI_SCALE_FACTOR));
      finalTeams[n].defense = Math.max(-MAX_RATING, Math.min(MAX_RATING, def_zeroed * UI_SCALE_FACTOR));
      finalTeams[n].hfa_raw = finalTeams[n].hfa_raw;
    });
    setTeams(finalTeams);
    setGlobalParams({ hfa: finalModel.hfa, rho: finalModel.rho, xi: bestXi });
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

  const handleResetMatch = () => { setSelectedHome(''); setSelectedAway(''); setSimulationResult(null); };

  const handleSimulateRound = () => {
    if (!roundGamesData.length) return;
    setIsSimulatingRound(true);
    setTimeout(() => {
        const results = {};
        roundGamesData.forEach(m => {
            if (teams[m.home] && teams[m.away]) results[`${m.home}-${m.away}`] = runMonteCarlo(teams[m.home], teams[m.away], globalParams.hfa, globalParams.rho, 10000);
        });
        setRoundResults(results);
        setIsSimulatingRound(false);
    }, 200);
  };

  const roundGamesData = useMemo(() => leagueSchedule.filter(m => Number(m.round) === selectedRound), [leagueSchedule, selectedRound]);
  const powerRanking = useMemo(() => Object.entries(teams).map(([name, stats]) => ({ name, ...stats, strength: stats.attack - stats.defense })).filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => b.strength - a.strength), [teams, searchTerm]);

  if (loading) return (
    <div className="min-h-screen bg-[#f0f4f8] flex flex-col items-center justify-center text-[#2b2c34] p-4 text-center font-roboto">
      <Activity className="w-12 h-12 text-[#ff5e3a] animate-pulse mb-4" />
      <h2 className="text-xl font-black uppercase tracking-tighter leading-tight">Sincronizando Modelos...</h2>
      <p className="text-[#2b2c34]/60 text-[10px] mt-4 font-mono uppercase tracking-[0.2em]">Otimizando via WMLE | Backtesting Ativo</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f0f4f8] font-roboto text-[#2b2c34] pb-12">
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap');
        .font-roboto { font-family: 'Roboto', sans-serif; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #ff5e3a33; border-radius: 10px; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: fade-in 0.5s ease-out; }
      `}} />

      {/* HEADER VIBRANT SUNSET & ICE */}
      <nav className="bg-[#fffffe] border-b-2 border-[#2b2c34] sticky top-0 z-50 px-4 py-3 flex justify-between items-center shadow-lg">
        <div className="flex items-center gap-2">
          <div className="bg-[#ff5e3a] p-1.5 rounded-lg shrink-0 shadow-[4px_4px_0px_#2b2c34]"><Target className="text-[#fffffe] w-5 h-5" /></div>
          <div>
            <h1 className="text-sm font-black tracking-tight uppercase leading-none text-[#2b2c34]">Dixon-Coles Pro</h1>
            <p className="text-[11px] font-black text-[#ff8906] uppercase mt-1 italic">XI: {globalParams.xi.toFixed(4)}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {modelAccuracy && (
            <div className="flex flex-col items-end border-r-2 border-[#2b2c34]/10 pr-3">
                <span className="text-[8px] font-black text-[#2b2c34]/70 uppercase leading-none">Backtesting</span>
                <span className="text-[13px] font-black text-[#059669] tracking-tight leading-tight">{modelAccuracy}% Precision</span>
            </div>
          )}
          <button onClick={fetchAllData} className="p-2 bg-[#f0f4f8] hover:bg-[#ff5e3a] group rounded-full border-2 border-[#2b2c34] transition-colors"><RefreshCw className="w-4 h-4 text-[#2b2c34] group-hover:text-[#fffffe]" /></button>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto p-3 sm:p-4 space-y-6">
        {/* TABS NEO-BRUTALIST - FONT INCREASED */}
        <div className="flex flex-row overflow-x-auto gap-2 p-1.5 bg-[#fffffe] rounded-2xl border-2 border-[#2b2c34] w-full shadow-[6px_6px_0px_#2b2c34] no-scrollbar">
          {['match', 'round', 'league', 'ranking'].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 whitespace-nowrap px-4 py-3 rounded-xl text-[12px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activeTab === tab ? 'bg-[#ff5e3a] text-[#fffffe] shadow-[2px_2px_0px_#2b2c34]' : 'text-[#2b2c34] hover:text-[#ff5e3a]'}`}>
              {tab === 'match' && <Zap className="w-4 h-4" />}
              {tab === 'round' && <Calendar className="w-4 h-4" />}
              {tab === 'league' && <TableIcon className="w-4 h-4" />}
              {tab === 'ranking' && <ListOrdered className="w-4 h-4" />}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* JOGO ÚNICO */}
        {activeTab === 'match' && (
          <div className="space-y-6 animate-in">
            <section className="bg-[#fffffe] rounded-[2rem] shadow-[8px_8px_0px_#2b2c34] border-2 border-[#2b2c34] overflow-hidden">
              <div className="p-6">
                <div className="flex flex-col gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-black text-[#2b2c34] uppercase tracking-[0.2em] ml-2 leading-none">Mandante</label>
                      <select value={selectedHome} onChange={(e) => setSelectedHome(e.target.value)} className="w-full bg-[#f0f4f8] border-2 border-[#2b2c34] rounded-2xl p-3 font-bold text-sm outline-none appearance-none leading-tight focus:bg-[#fffffe] transition-all text-[#2b2c34]">
                        <option value="">Selecionar...</option>
                        {Object.keys(teams).sort().map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="flex justify-center text-[#ff5e3a] text-lg font-black italic leading-none py-1">VS</div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-black text-[#2b2c34] uppercase tracking-[0.2em] ml-2 block leading-none">Visitante</label>
                      <select value={selectedAway} onChange={(e) => setSelectedAway(e.target.value)} className="w-full bg-[#f0f4f8] border-2 border-[#2b2c34] rounded-2xl p-3 font-bold text-sm outline-none appearance-none leading-tight focus:bg-[#fffffe] transition-all text-[#2b2c34]">
                        <option value="">Selecionar...</option>
                        {Object.keys(teams).sort().map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                </div>
                <div className="mt-8 flex gap-3">
                  <button onClick={handleSimulateMatch} disabled={isSimulating || !selectedHome || !selectedAway || selectedHome === selectedAway} className="flex-1 h-16 rounded-2xl font-black text-[#fffffe] uppercase tracking-[0.2em] bg-[#ff5e3a] hover:bg-[#ff5e3a]/90 transition-all active:scale-[0.98] disabled:opacity-30 flex items-center justify-center gap-3 text-xs shadow-[4px_4px_0px_#2b2c34]">
                    {isSimulating ? <Activity className="animate-spin w-5 h-5" /> : <Play className="fill-current w-4 h-4" />} PREVISÃO
                  </button>
                  <button onClick={handleResetMatch} className="py-4 px-6 rounded-2xl bg-[#fffffe] hover:bg-[#f0f4f8] text-[#2b2c34] transition-all border-2 border-[#2b2c34] shadow-[4px_4px_0px_#2b2c34] flex items-center justify-center" title="Limpar"><Trash2 className="w-5 h-5" /></button>
                </div>
              </div>
            </section>

            {simulationResult && (
              <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#fffffe] p-4 rounded-3xl border-2 border-[#2b2c34] shadow-[4px_4px_0px_#2b2c34]">
                      <div className="flex items-center gap-2 mb-3">
                          <Home className="w-4 h-4 text-[#ff5e3a] shrink-0" />
                          <span className="text-[11px] font-black uppercase text-[#2b2c34] truncate">{selectedHome}</span>
                      </div>
                      <div className="flex justify-between items-center mb-1.5 leading-none text-[13px] font-mono"><span className="text-[#2b2c34] font-black uppercase text-[11px]">ATQ:</span><span className="font-black text-[#ff5e3a]">{teams[selectedHome]?.attack.toFixed(2)}</span></div>
                      <div className="flex justify-between items-center leading-none text-[13px] font-mono"><span className="text-[#2b2c34] font-black uppercase text-[11px]">DEF:</span><span className={`font-black ${teams[selectedHome]?.defense < 0 ? 'text-[#059669]' : 'text-[#e45858]'}`}>{teams[selectedHome]?.defense.toFixed(2)}</span></div>
                  </div>
                  <div className="bg-[#fffffe] p-4 rounded-3xl border-2 border-[#2b2c34] shadow-[4px_4px_0px_#2b2c34] text-right">
                      <div className="flex items-center gap-2 mb-3 justify-end">
                          <span className="text-[11px] font-black uppercase text-[#2b2c34] truncate">{selectedAway}</span>
                          <MapPin className="w-4 h-4 text-[#ff5e3a] shrink-0" />
                      </div>
                      <div className="flex justify-between items-center mb-1.5 leading-none text-[13px] font-mono"><span className="text-[#2b2c34] font-black uppercase text-[11px]">ATQ:</span><span className="font-black text-[#ff5e3a]">{teams[selectedAway]?.attack.toFixed(2)}</span></div>
                      <div className="flex justify-between items-center leading-none text-[13px] font-mono"><span className="text-[#2b2c34] font-black uppercase text-[11px]">DEF:</span><span className={`font-black ${teams[selectedAway]?.defense < 0 ? 'text-[#059669]' : 'text-[#e45858]'}`}>{teams[selectedAway]?.defense.toFixed(2)}</span></div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: selectedHome, val: simulationResult.probs.home, sub: `xG: ${simulationResult.expectedGoals.home.toFixed(2)}`, color: 'text-[#ff5e3a]', odd: calcOdd(simulationResult.probs.home) },
                    { label: 'Empate', val: simulationResult.probs.draw, sub: '---', color: 'text-[#2b2c34]', odd: calcOdd(simulationResult.probs.draw) },
                    { label: selectedAway, val: simulationResult.probs.away, sub: `xG: ${simulationResult.expectedGoals.away.toFixed(2)}`, color: 'text-blue-600', odd: calcOdd(simulationResult.probs.away) }
                  ].map((item, i) => (
                    <div key={i} className="bg-[#fffffe] p-4 rounded-[2rem] border-2 border-[#2b2c34] shadow-[4px_4px_0px_#2b2c34] text-center">
                      <p className="text-[10px] font-black text-[#2b2c34] uppercase mb-2 truncate tracking-widest leading-none">{item.label}</p>
                      <h3 className={`text-2xl font-black ${item.color} tabular-nums leading-none`}>{item.val.toFixed(1)}%</h3>
                      <div className="mt-3 flex flex-col gap-1.5 leading-none">
                        <span className="text-[11px] font-black text-[#2b2c34] bg-[#f0f4f8] px-2 py-1 rounded-full uppercase border-2 border-[#2b2c34]">ODD: {item.odd}</span>
                        {item.sub !== '---' && <span className="text-[10px] font-black text-[#2b2c34] uppercase italic bg-[#ff8906]/10 px-1 py-0.5 rounded">{item.sub}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-[#fffffe] rounded-[2.5rem] border-2 border-[#2b2c34] shadow-[8px_8px_0px_#2b2c34] p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4 border-b-2 border-[#2b2c34]/5 pb-6">
                    <h4 className="font-black text-[#2b2c34] text-[13px] uppercase tracking-[0.2em] flex items-center gap-2"><PieChart className="w-5 h-5 text-[#ff5e3a]" /> MATRIZ DE PROBABILIDADES</h4>
                    <div className="flex gap-4 w-full sm:w-auto">
                        <div className="flex-1 bg-[#f0f4f8] px-4 py-2.5 rounded-2xl border-2 border-[#2b2c34] text-center leading-none flex flex-row items-center gap-3">
                           <span className="text-[10px] font-black text-[#ff5e3a] uppercase block text-left">XPTS<br/>CASA</span>
                           <span className="text-xl font-black text-[#2b2c34] tabular-nums">{simulationResult.expectedPointsHome.toFixed(2)}</span>
                        </div>
                        <div className="flex-1 bg-[#f0f4f8] px-4 py-2.5 rounded-2xl border-2 border-[#2b2c34] text-center leading-none flex flex-row items-center gap-3">
                           <span className="text-[10px] font-black text-blue-600 uppercase block text-left">XPTS<br/>FORA</span>
                           <span className="text-xl font-black text-[#2b2c34] tabular-nums">{simulationResult.expectedPointsAway.toFixed(2)}</span>
                        </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-center overflow-x-auto no-scrollbar">
                     <div className="mb-4 text-[10px] font-black text-[#ff5e3a] uppercase tracking-[0.5em]">VISITANTE →</div>
                     <div className="flex gap-2 w-full justify-center">
                        <div className="[writing-mode:vertical-lr] rotate-180 text-[10px] font-black text-[#ff5e3a] uppercase tracking-[0.5em]">MANDANTE →</div>
                        <div className="w-full max-w-[480px]">
                          <div className="grid grid-cols-7 gap-1">
                            <div className="col-span-1"></div>
                            {Array.from({length: 6}).map((_, i) => <div key={i} className="text-center text-[12px] font-black text-[#2b2c34]/50">{i}</div>)}
                            {simulationResult.matrix.map((row, hS) => (
                              <React.Fragment key={hS}>
                                <div className="flex items-center justify-end pr-3 text-[12px] font-black text-[#2b2c34]/50">{hS}</div>
                                {row.map((prob, aS) => {
                                  const intensity = Math.min(prob * 10, 100);
                                  return (
                                    <div key={aS} className="aspect-square rounded-lg flex items-center justify-center border-2 border-[#2b2c34]/5 transition-transform hover:scale-105" style={{ backgroundColor: `rgba(255, 94, 58, ${intensity / 100})`, color: intensity > 40 ? '#fffffe' : '#2b2c34' }}>
                                      <span className="text-[11px] sm:text-[14px] font-black tabular-nums">{prob.toFixed(1)}%</span>
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
          <div className="space-y-6 animate-in">
              <section className="bg-[#fffffe] rounded-[2.5rem] border-2 border-[#2b2c34] p-6 md:p-10 shadow-[8px_8px_0px_#2b2c34]">
                  <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4">
                      <h3 className="font-black text-[#2b2c34] text-lg uppercase tracking-tight flex items-center gap-2 leading-none text-center sm:text-left"><Calendar className="w-5 h-5 text-[#ff5e3a]" /> RODADA ATUAL</h3>
                      <div className="flex items-center gap-3 w-full sm:w-auto">
                          <span className="text-[11px] font-black text-[#2b2c34] uppercase tracking-widest">JORNADA</span>
                          <select value={selectedRound} onChange={(e) => { setSelectedRound(Number(e.target.value)); setRoundResults({}); }} className="flex-1 sm:flex-none bg-[#f0f4f8] border-2 border-[#2b2c34] rounded-xl px-4 py-2.5 font-bold text-sm outline-none focus:bg-[#fffffe] text-[#2b2c34]">
                              {Array.from({length: 38}).map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
                          </select>
                      </div>
                  </div>

                  <button onClick={handleSimulateRound} disabled={isSimulatingRound || !roundGamesData.length} className="w-full h-16 mb-8 py-5 bg-[#ff5e3a] hover:bg-[#ff5e3a]/90 text-[#fffffe] rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-4 shadow-[4px_4px_0px_#2b2c34]">
                      {isSimulatingRound ? <Activity className="animate-spin w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />} SIMULAR RODADA
                  </button>

                  <div className="grid grid-cols-1 gap-4">
                      {roundGamesData.length > 0 ? roundGamesData.map((m, idx) => {
                          const result = roundResults[`${m.home}-${m.away}`];
                          return (
                              <div key={idx} className="bg-[#f0f4f8]/80 rounded-3xl p-5 border-2 border-[#2b2c34] flex items-center justify-between group hover:bg-[#fffffe] transition-all relative overflow-hidden">
                                  <div className="flex-1 text-left flex flex-col gap-1.5 pr-2">
                                      <p className="font-black text-[#2b2c34] uppercase leading-none truncate w-full" style={{ fontSize: 'clamp(11px, 3.2vw, 15px)' }}>{m.home}</p>
                                      {result ? (
                                          <>
                                              <p className="text-[15px] sm:text-xl font-black text-[#ff5e3a] leading-none">{result.probs.home.toFixed(1)}%</p>
                                              <div className="flex flex-col leading-tight mt-1 text-[11px] text-[#2b2c34] font-black uppercase italic">
                                                  <span>XG: {result.expectedGoals.home.toFixed(2)}</span>
                                                  <span>ODD: {calcOdd(result.probs.home)}</span>
                                              </div>
                                          </>
                                      ) : <p className="text-[10px] text-[#2b2c34] font-black uppercase italic">Pendente</p>}
                                  </div>

                                  <div className="flex flex-col items-center px-2 shrink-0 z-10">
                                      <div className="text-[10px] font-black text-[#2b2c34] italic mb-2 tracking-widest opacity-30">VS</div>
                                      {result && (
                                        <div className="bg-[#2b2c34] px-4 py-2.5 rounded-xl flex flex-col items-center shadow-xl min-w-[65px] border-2 border-[#2b2c34]">
                                            <span className="text-[7.5px] font-black text-[#fffffe]/70 uppercase leading-none mb-1 tracking-tighter">EMPATE</span>
                                            <span className="text-[15px] sm:text-lg font-black text-[#fffffe] leading-none tabular-nums">{result.probs.draw.toFixed(0)}%</span>
                                        </div>
                                      )}
                                  </div>

                                  <div className="flex-1 text-right flex flex-col items-end gap-1.5 pl-2">
                                      <p className="font-black text-[#2b2c34] uppercase leading-none truncate w-full" style={{ fontSize: 'clamp(11px, 3.2vw, 15px)' }}>{m.away}</p>
                                      {result ? (
                                          <>
                                              <p className="text-[15px] sm:text-xl font-black text-blue-600 leading-none">{result.probs.away.toFixed(1)}%</p>
                                              <div className="flex flex-col items-end leading-tight mt-1 text-[11px] text-[#2b2c34] font-black uppercase italic">
                                                  <span>XG: {result.expectedGoals.away.toFixed(2)}</span>
                                                  <span>ODD: {calcOdd(result.probs.away)}</span>
                                              </div>
                                          </>
                                      ) : <p className="text-[10px] text-[#2b2c34] font-black uppercase italic text-right">Pendente</p>}
                                  </div>
                              </div>
                          );
                      }) : <div className="text-center py-20 text-[#2b2c34]/30 font-black uppercase text-xs tracking-[0.3em] border-4 border-dashed border-[#2b2c34]/5 rounded-[2.5rem]">Aguardando simulação</div>}
                  </div>
              </section>
          </div>
        )}

        {/* LIGA */}
        {activeTab === 'league' && (
          <div className="space-y-6 animate-in">
            <section className="bg-[#fffffe] rounded-[2.5rem] border-2 border-[#2b2c34] p-6 md:p-10 shadow-[8px_8px_0px_#2b2c34]">
              <div className="flex flex-col justify-between items-center gap-6 mb-10 text-center">
                <div className="space-y-2">
                  <h3 className="font-black text-[#2b2c34] text-xl uppercase tracking-widest flex items-center justify-center gap-3 leading-none"><Trophy className="w-7 h-7 text-[#ff5e3a] fill-current" /> TEMPORADA 2026</h3>
                  <p className="text-[#2b2c34] text-[12px] font-black uppercase tracking-[0.4em]">Engine de Monte Carlo</p>
                </div>
                <button onClick={runLeagueSimulation} disabled={isSimulatingLeague || !leagueSchedule.length} className="w-full h-16 sm:w-auto px-12 py-5 bg-[#ff5e3a] text-[#fffffe] rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-[4px_4px_0px_#2b2c34] transition-all active:scale-95 flex items-center justify-center gap-4">
                  {isSimulatingLeague ? <Activity className="animate-spin w-6 h-6" /> : <TableIcon className="w-6 h-6" />} SIMULAR TEMPORADA
                </button>
              </div>
              {leagueTable.length > 0 ? (
                <div className="overflow-x-auto rounded-[2rem] border-2 border-[#2b2c34] shadow-[4px_4px_0px_#2b2c34] no-scrollbar">
                  <table className="w-full text-left border-collapse min-w-[380px]">
                    <thead className="bg-[#f0f4f8] text-[11px] font-black text-[#2b2c34] uppercase border-b-2 border-[#2b2c34]">
                      <tr><th className="px-3 py-5 w-8 text-center opacity-50">#</th><th className="px-3 py-5">EQUIPE</th><th className="px-2 py-5 text-center tracking-wider">XPTS</th><th className="px-2 py-5 text-center text-[#ff5e3a] tracking-widest">TIT</th><th className="px-2 py-5 text-center text-[#059669]">G6</th><th className="px-2 py-5 text-center text-[#e45858]">Z4</th></tr>
                    </thead>
                    <tbody className="divide-y-2 divide-[#2b2c34]/5 text-[12px] sm:text-[14px] font-bold text-[#2b2c34]">
                      {leagueTable.map((row, idx) => (
                        <tr key={row.name} className="hover:bg-[#ff5e3a]/5 transition-colors">
                          <td className="px-2 py-4 text-[#2b2c34]/60 font-black text-center text-[11px]">{idx + 1}</td>
                          <td className="px-3 py-4 font-black uppercase tracking-tighter truncate max-w-[90px]">{row.name}</td>
                          <td className="px-2 py-4 text-center font-mono font-black bg-[#f0f4f8]/50 text-[14px]">{row.avgPoints.toFixed(1)}</td>
                          <td className="px-2 py-4 text-center font-black text-[#ff5e3a] text-[14px]">{row.titleProb > 0.05 ? `${row.titleProb.toFixed(1)}%` : '-'}</td>
                          <td className="px-2 py-4 text-center font-black text-[#059669] text-[14px]">{row.libertaProb > 0.05 ? `${row.libertaProb.toFixed(1)}%` : '-'}</td>
                          <td className="px-2 py-4 text-center font-black text-[#e45858] text-[14px]">{row.z4Prob > 0.05 ? `${row.z4Prob.toFixed(1)}%` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-center py-24 border-4 border-dashed border-[#2b2c34]/5 rounded-[3rem] text-[#2b2c34]/20 uppercase font-black text-[10px] tracking-[0.5em]">Simulação Pendente</div>}
            </section>
          </div>
        )}

        {/* RANKING */}
        {activeTab === 'ranking' && (
          <div className="space-y-6 animate-in">
             <section className="bg-[#fffffe] rounded-[2.5rem] shadow-[8px_8px_0px_#2b2c34] border-2 border-[#2b2c34] overflow-hidden">
                <div className="p-6 md:p-10 bg-[#f0f4f8]/50 border-b-2 border-[#2b2c34]">
                    <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4">
                        <div className="space-y-1">
                            <h3 className="font-black text-[#2b2c34] text-xl uppercase tracking-tighter leading-none">Power Ranking Técnico</h3>
                            <p className="text-[12px] text-[#2b2c34] font-black uppercase tracking-[0.3em] leading-none mt-3">Escala [-3.00, +3.00]</p>
                        </div>
                        <Award className="w-12 h-12 text-[#ff5e3a] drop-shadow-[4px_4px_0px_#2b2c34]" />
                    </div>
                    <div className="relative group">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#2b2c34] group-focus-within:text-[#ff5e3a] transition-all" />
                        <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Filtrar time..." className="w-full bg-[#fffffe] border-2 border-[#2b2c34] rounded-2xl py-4 pl-14 pr-6 font-bold text-sm outline-none focus:border-[#ff5e3a] transition-all shadow-inner text-[#2b2c34]" />
                    </div>
                </div>
                <div className="overflow-x-auto no-scrollbar px-2 sm:px-0">
                  <table className="w-full text-left border-collapse min-w-[340px]">
                    <thead className="bg-[#f0f4f8] text-[11px] font-black text-[#2b2c34] uppercase border-b-2 border-[#2b2c34]">
                        <tr><th className="px-6 py-6 w-[50%]">Equipe</th><th className="px-3 py-6 text-center w-[25%]">Ataque</th><th className="px-6 py-6 text-center w-[25%]">Defesa</th></tr>
                    </thead>
                    <tbody className="divide-y-2 divide-[#2b2c34]/5 text-[11px] sm:text-xs">
                      {powerRanking.map((team, idx) => (
                        <tr key={team.name} className="hover:bg-[#ff5e3a]/5 transition-colors">
                          <td className="px-6 py-6 flex flex-col gap-1.5"><span className="text-[15px] sm:text-[18px] font-black text-[#2b2c34] uppercase tracking-tight leading-none truncate max-w-[140px]">{team.name}</span><span className="text-[10px] font-black text-[#2b2c34] uppercase leading-none tracking-widest italic opacity-40">Rank #{idx + 1}</span></td>
                          <td className="px-3 py-6 text-center leading-none"><div className={`text-[13px] sm:text-sm font-mono font-black px-3 py-1.5 rounded-xl inline-block min-w-[55px] ${team.attack > 0 ? 'text-[#fffffe] bg-[#ff5e3a] shadow-[2px_2px_0px_#2b2c34]' : 'text-[#2b2c34] bg-[#f0f4f8] border-2 border-[#2b2c34]'}`}>{team.attack.toFixed(2)}</div></td>
                          <td className="px-6 py-6 text-center leading-none"><div className={`text-[13px] sm:text-sm font-mono font-black px-3 py-1.5 rounded-xl inline-block min-w-[55px] ${team.defense < 0 ? 'text-[#fffffe] bg-[#059669] shadow-[2px_2px_0px_#2b2c34]' : 'text-[#e45858] bg-[#e45858]/10 border-2 border-[#2b2c34]'}`}>{team.defense.toFixed(2)}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
             </section>
          </div>
        )}
      </main>
    </div>
  );
}
