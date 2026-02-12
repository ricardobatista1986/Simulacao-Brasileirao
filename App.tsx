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
const LEARNING_RATE = 0.01; // Ajustado para evitar explosão dos parâmetros
const XI_CANDIDATES = [0.000, 0.0005, 0.0010, 0.0015, 0.0020, 0.0025, 0.0030]; 

// Fator de escala ajustado para distribuir melhor entre -3 e +3 sem bater no teto
const UI_SCALE_FACTOR = 7; 

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
  // Removido o clamp para usar o valor real da força
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
      // Removida a limitação artificial (Clamp) para permitir que os times se distanciem
      finalTeams[n].attack = att_zeroed * UI_SCALE_FACTOR;
      finalTeams[n].defense = def_zeroed * UI_SCALE_FACTOR;
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
            if (hG > aG) currentStandings[match.home] += 3; else if (aG > hG) currentStandings[match.away] += 3; else { currentStandings[match.home] += 1; currentStandings[match.away] += 1; }
          }
        });
        const sorted = Object.entries(currentStandings).sort(([,a], [,b]) => b - a);
        sorted.forEach(([team, pts], rank) => {
          if (stats[team]) {
            stats[team].simPoints += pts;
            if (rank === 0) stats[team].title++; if (rank < 6) stats[team].liberta++; if (rank < 8) stats[team].preLiberta++; if (rank < 12) stats[team].sula++; if (rank >= sorted.length - 4) stats[team].z4++;
          }
        });
      }
      setLeagueTable(Object.entries(stats).map(([name, s]) => ({
        name, avgPoints: s.simPoints / LEAGUE_SIM_COUNT,
        titleProb: (s.title / LEAGUE_SIM_COUNT) * 100, libertaProb: (s.liberta / LEAGUE_SIM_COUNT) * 100, preLibertaProb: (s.preLiberta / LEAGUE_SIM_COUNT) * 100, sulaProb: (s.sula / LEAGUE_SIM_COUNT) * 100, z4Prob: (s.z4 / LEAGUE_SIM_COUNT) * 100
      })).sort((a, b) => b.avgPoints - a.avgPoints));
      setIsSimulatingLeague(false);
    }, 100);
  };

  const handleSimulateMatch = () => {
    if (!selectedHome || !selectedAway) return;
    setIsSimulating(true);
    setTimeout(() => { setSimulationResult(runMonteCarlo(teams[selectedHome], teams[selectedAway], globalParams.hfa, globalParams.rho, SIMULATION_COUNT)); setIsSimulating(false); }, 400);
  };

  const handleResetMatch = () => { setSelectedHome(''); setSelectedAway(''); setSimulationResult(null); };

  const handleSimulateRound = () => {
    if (!roundGamesData.length) return;
    setIsSimulatingRound(true);
    setTimeout(() => {
        const results = {};
        roundGamesData.forEach(m => { if (teams[m.home] && teams[m.away]) results[`${m.home}-${m.away}`] = runMonteCarlo(teams[m.home], teams[m.away], globalParams.hfa, globalParams.rho, 10000); });
        setRoundResults(results);
        setIsSimulatingRound(false);
    }, 200);
  };

  const roundGamesData = useMemo(() => leagueSchedule.filter(m => Number(m.round) === selectedRound), [leagueSchedule, selectedRound]);
  const powerRanking = useMemo(() => Object.entries(teams).map(([name, stats]) => ({ name, ...stats, strength: stats.attack - stats.defense })).filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => b.strength - a.strength), [teams, searchTerm]);

  if (loading) return (
    <div className="min-h-screen bg-[#f0f4f8] flex flex-col items-center justify-center text-[#2b2c34] p-4 text-center font-roboto">
      <Activity className="w-10 h-10 text-[#ff5e3a] animate-pulse mb-4" />
      <h2 className="text-lg font-black uppercase tracking-tighter leading-tight">Calibrando Inteligência 2026</h2>
      <p className="text-slate-500 text-[10px] mt-4 font-mono uppercase tracking-[0.2em]">Optimizing Odds | Season Mapping</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f0f4f8] font-roboto text-[#2b2c34] pb-8 overflow-x-hidden">
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap');
        .font-roboto { font-family: 'Roboto', sans-serif; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: fade-in 0.4s ease-out; }
      `}} />

      <nav className="bg-[#fffffe] border-b-2 border-[#2b2c34] sticky top-0 z-50 px-3 py-2 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-2">
          <div className="bg-[#ff5e3a] p-1 rounded-md shadow-[2px_2px_0px_#2b2c34]"><Target className="text-[#fffffe] w-4 h-4" /></div>
          <div>
            <h1 className="text-[11px] font-black tracking-tight uppercase leading-none">Dixon-Coles Pro</h1>
            <p className="text-[9px] font-bold text-[#ff8906] uppercase mt-0.5 italic">XI: {globalParams.xi.toFixed(4)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {modelAccuracy && (
            <div className="flex flex-col items-end border-r border-[#2b2c34]/10 pr-2">
                <span className="text-[8px] font-black text-[#2b2c34]/70 uppercase leading-none">Backtesting</span>
                <span className="text-[13px] font-black text-[#059669] tracking-tight leading-tight">{modelAccuracy}% Precision</span>
            </div>
          )}
          <button onClick={fetchAllData} className="p-1.5 bg-[#f0f4f8] rounded-full border-2 border-[#2b2c34] transition-transform active:scale-95"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto p-2 space-y-4">
        <div className="flex flex-row gap-1 p-1 bg-[#fffffe] rounded-xl border-2 border-[#2b2c34] w-full shadow-[3px_3px_0px_#2b2c34]">
          {['match', 'round', 'league', 'ranking'].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 px-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1 ${activeTab === tab ? 'bg-[#ff5e3a] text-[#fffffe]' : 'text-[#2b2c34]/60'}`}>
              {tab === 'match' ? 'JOGO' : tab === 'round' ? 'RODADA' : tab === 'league' ? 'LIGA' : 'RANKING'}
            </button>
          ))}
        </div>

        {activeTab === 'match' && (
          <div className="space-y-4 animate-in">
            <section className="bg-[#fffffe] rounded-2xl shadow-[4px_4px_0px_#2b2c34] border-2 border-[#2b2c34] p-3">
              <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-[#2b2c34]/50 uppercase ml-1">Mandante</label>
                      <select value={selectedHome} onChange={(e) => setSelectedHome(e.target.value)} className="w-full bg-[#f0f4f8] border-2 border-[#2b2c34] rounded-lg p-1.5 font-black text-[12px] outline-none text-[#2b2c34]">
                        <option value="">Escolher...</option>
                        {Object.keys(teams).sort().map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="text-[#ff5e3a] text-[11px] font-black italic pt-3">VS</div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-[#2b2c34]/50 uppercase ml-1">Visitante</label>
                      <select value={selectedAway} onChange={(e) => setSelectedAway(e.target.value)} className="w-full bg-[#f0f4f8] border-2 border-[#2b2c34] rounded-lg p-1.5 font-black text-[12px] outline-none text-[#2b2c34]">
                        <option value="">Escolher...</option>
                        {Object.keys(teams).sort().map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSimulateMatch} disabled={isSimulating || !selectedHome || !selectedAway || selectedHome === selectedAway} className="flex-1 py-3.5 rounded-xl font-black text-[#fffffe] uppercase text-[11px] bg-[#ff5e3a] shadow-[2px_2px_0px_#2b2c34] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-30">PREVISÃO</button>
                    <button onClick={handleResetMatch} className="p-3.5 rounded-xl border-2 border-[#2b2c34] bg-[#fffffe]"><Trash2 className="w-4.5 h-4.5" /></button>
                  </div>
              </div>
            </section>

            {simulationResult && (
              <div className="space-y-4 animate-in">
                <div className="grid grid-cols-2 gap-2">
                  {[ {t: selectedHome, s: teams[selectedHome], icon: <Home className="w-3.5 h-3.5"/>}, {t: selectedAway, s: teams[selectedAway], icon: <MapPin className="w-3.5 h-3.5"/>} ].map((item, idx) => (
                    <div key={idx} className="bg-[#fffffe] p-2.5 rounded-xl border-2 border-[#2b2c34] shadow-[2px_2px_0px_#2b2c34]">
                        <div className="flex items-center gap-1.5 mb-1.5"><span className="text-[#ff5e3a]">{item.icon}</span><span className="text-[11px] font-black uppercase truncate">{item.t}</span></div>
                        <div className="flex justify-between text-[11px] font-mono"><span className="text-[#2b2c34] font-black uppercase text-[9px]">ATQ:</span><span className="font-black text-[#ff5e3a]">{item.s?.attack.toFixed(2)}</span></div>
                        <div className="flex justify-between text-[11px] font-mono"><span className="text-[#2b2c34] font-black uppercase text-[9px]">DEF:</span><span className={`font-black ${item.s?.defense < 0 ? 'text-[#059669]' : 'text-[#e45858]'}`}>{item.s?.defense.toFixed(2)}</span></div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: selectedHome, val: simulationResult.probs.home, sub: `xG: ${simulationResult.expectedGoals.home.toFixed(2)}`, color: 'text-[#ff5e3a]', odd: calcOdd(simulationResult.probs.home) },
                    { label: 'Empate', val: simulationResult.probs.draw, sub: '', color: 'text-[#2b2c34]', odd: calcOdd(simulationResult.probs.draw) },
                    { label: selectedAway, val: simulationResult.probs.away, sub: `xG: ${simulationResult.expectedGoals.away.toFixed(2)}`, color: 'text-blue-600', odd: calcOdd(simulationResult.probs.away) }
                  ].map((item, i) => (
                    <div key={i} className="bg-[#fffffe] p-2.5 rounded-xl border-2 border-[#2b2c34] shadow-[2px_2px_0px_#2b2c34] text-center">
                      <p className="text-[8px] font-black text-[#2b2c34] uppercase truncate mb-1.5">{item.label}</p>
                      <h3 className={`text-lg font-black ${item.color} leading-none`}>{item.val.toFixed(1)}%</h3>
                      <div className="mt-2.5 flex flex-col gap-1">
                        <span className="text-[8px] font-black text-[#2b2c34] bg-[#f0f4f8] py-1 rounded-full border-2 border-[#2b2c34]">ODD: {item.odd}</span>
                        {item.sub && <span className="text-[8px] font-black text-[#2b2c34] uppercase italic bg-[#ff8906]/15 px-1 py-0.5 rounded leading-none">{item.sub}</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-[#fffffe] rounded-2xl border-2 border-[#2b2c34] shadow-[4px_4px_0px_#2b2c34] p-2 sm:p-4">
                  <div className="flex flex-col gap-3 border-b-2 border-[#2b2c34]/5 pb-3 mb-4 px-2">
                    <h4 className="font-black text-[#2b2c34] text-[11px] uppercase flex items-center gap-1.5 leading-none"><PieChart className="w-4 h-4 text-[#ff5e3a]" /> MATRIZ</h4>
                    <div className="flex gap-2">
                        <div className="flex-1 bg-[#f0f4f8] p-2 rounded-xl border-2 border-[#2b2c34] flex justify-between items-center px-3">
                           <span className="text-[9.5px] font-black text-[#ff5e3a] uppercase flex flex-col leading-none"><span>XPTS</span><span>CASA</span></span>
                           <span className="text-lg font-black">{simulationResult.expectedPointsHome.toFixed(2)}</span>
                        </div>
                        <div className="flex-1 bg-[#f0f4f8] p-2 rounded-xl border-2 border-[#2b2c34] flex justify-between items-center px-3">
                           <span className="text-[9.5px] font-black text-blue-600 uppercase flex flex-col leading-none"><span>XPTS</span><span>FORA</span></span>
                           <span className="text-lg font-black">{simulationResult.expectedPointsAway.toFixed(2)}</span>
                        </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-center">
                     <div className="mb-2.5 text-[9px] font-black text-[#ff5e3a] uppercase tracking-widest flex items-center gap-2"><MapPin className="w-3 h-3" /> VISITANTE →</div>
                     <div className="flex gap-2 w-full justify-center">
                        <div className="[writing-mode:vertical-lr] rotate-180 text-[9px] font-black text-[#ff5e3a] uppercase tracking-widest flex items-center gap-2 shrink-0"><Home className="w-3 h-3" /> MANDANTE →</div>
                        <div className="w-full max-w-[480px]">
                          <div className="grid grid-cols-7 gap-1">
                            <div className="col-span-1"></div>
                            {Array.from({length: 6}).map((_, i) => <div key={i} className="text-center text-[13px] font-black text-[#2b2c34]/60">{i}</div>)}
                            {simulationResult.matrix.map((row, hS) => (
                              <React.Fragment key={hS}>
                                <div className="flex items-center justify-end pr-2 text-[13px] font-black text-[#2b2c34]/60">{hS}</div>
                                {row.map((prob, aS) => {
                                  const intensity = Math.min(prob * 10, 100);
                                  return (
                                    <div key={aS} className="aspect-square rounded-md flex items-center justify-center border-2 border-[#2b2c34]/5" style={{ backgroundColor: `rgba(255, 94, 58, ${intensity / 100})`, color: intensity > 40 ? '#fffffe' : '#2b2c34' }}>
                                      <span className="text-[9.5px] sm:text-[11px] font-black tabular-nums">{prob.toFixed(1)}%</span>
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

        {activeTab === 'round' && (
          <div className="space-y-4 animate-in">
              <section className="bg-[#fffffe] rounded-2xl border-2 border-[#2b2c34] p-4 shadow-[4px_4px_0px_#2b2c34]">
                  <div className="flex items-center justify-between mb-4">
                      <h3 className="font-black text-[#2b2c34] text-[12px] uppercase flex items-center gap-1.5"><Calendar className="w-4.5 h-4.5 text-[#ff5e3a]" /> RODADA ATUAL</h3>
                      <select value={selectedRound} onChange={(e) => { setSelectedRound(Number(e.target.value)); setRoundResults({}); }} className="bg-[#f0f4f8] border-2 border-[#2b2c34] rounded-lg px-2.5 py-1.5 font-black text-[11px] outline-none">
                          {Array.from({length: 38}).map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
                      </select>
                  </div>
                  <button onClick={handleSimulateRound} disabled={isSimulatingRound || !roundGamesData.length} className="w-full h-16 mb-5 py-6 bg-[#ff5e3a] text-[#fffffe] rounded-xl font-black text-[11px] uppercase shadow-[2px_2px_0px_#2b2c34] active:translate-y-[2px] active:shadow-none transition-all flex items-center justify-center gap-3">
                      {isSimulatingRound ? <Activity className="animate-spin w-5 h-5 mx-auto" /> : <><Play className="w-5 h-5 fill-current" /> SIMULAR RODADA</>}
                  </button>
                  <div className="grid grid-cols-1 gap-3">
                      {roundGamesData.map((m, idx) => {
                          const result = roundResults[`${m.home}-${m.away}`];
                          return (
                              <div key={idx} className="bg-[#f0f4f8]/80 rounded-2xl p-4 border-2 border-[#2b2c34] flex items-center justify-between group relative overflow-hidden">
                                  <div className="flex-1 text-left min-w-0 pr-1">
                                      <p className="font-black text-[#2b2c34] uppercase truncate text-[11px] leading-none mb-1">{m.home}</p>
                                      {result ? (
                                          <>
                                              <p className="text-[14px] font-black text-[#ff5e3a]">{result.probs.home.toFixed(1)}%</p>
                                              <div className="flex flex-col text-[9px] text-[#2b2c34] font-black uppercase italic leading-tight mt-1">
                                                  <span>XG: {result.expectedGoals.home.toFixed(2)}</span>
                                                  <span>ODD: {calcOdd(result.probs.home)}</span>
                                              </div>
                                          </>
                                      ) : <p className="text-[9px] text-[#2b2c34]/50 font-black uppercase italic">Pendente</p>}
                                  </div>
                                  <div className="flex flex-col items-center px-1 shrink-0 z-10">
                                      {result && (
                                        <div className="bg-[#2b2c34] px-3 py-2 rounded-xl flex flex-col items-center shadow-xl border-2 border-[#2b2c34]">
                                            <span className="text-[7.5px] font-black text-[#fffffe]/60 uppercase leading-none mb-1">EMPATE</span>
                                            <span className="text-[13px] font-black text-[#fffffe] tabular-nums">{result.probs.draw.toFixed(0)}%</span>
                                        </div>
                                      )}
                                      {!result && <div className="text-[10px] font-black opacity-20 italic">VS</div>}
                                  </div>
                                  <div className="flex-1 text-right min-w-0 pl-1">
                                      <p className="font-black text-[#2b2c34] uppercase truncate text-[11px] leading-none mb-1">{m.away}</p>
                                      {result ? (
                                          <>
                                              <p className="text-[14px] font-black text-blue-600">{result.probs.away.toFixed(1)}%</p>
                                              <div className="flex flex-col text-[9px] text-[#2b2c34] font-black uppercase italic leading-tight mt-1">
                                                  <span>XG: {result.expectedGoals.away.toFixed(2)}</span>
                                                  <span>ODD: {calcOdd(result.probs.away)}</span>
                                              </div>
                                          </>
                                      ) : <p className="text-[9px] text-[#2b2c34]/50 font-black uppercase italic text-right">Pendente</p>}
                                  </div>
                              </div>
                          );
                      })}
                  </div>
              </section>
          </div>
        )}

        {activeTab === 'league' && (
          <div className="space-y-4 animate-in">
            <section className="bg-[#fffffe] rounded-2xl border-2 border-[#2b2c34] p-4 shadow-[4px_4px_0px_#2b2c34]">
              <div className="flex flex-col gap-3 mb-6 text-center">
                <h3 className="font-black text-[#2b2c34] text-[13px] uppercase flex items-center justify-center gap-2 leading-none"><Trophy className="w-5 h-5 text-[#ff5e3a] fill-current" /> TEMPORADA 2026</h3>
                <button onClick={runLeagueSimulation} disabled={isSimulatingLeague || !leagueSchedule.length} className="w-full h-16 py-6 bg-[#ff5e3a] text-[#fffffe] rounded-xl font-black text-[11px] uppercase shadow-[2px_2px_0px_#2b2c34] active:translate-y-[2px] active:shadow-none transition-all">
                  {isSimulatingLeague ? <Activity className="animate-spin w-5 h-5 mx-auto" /> : "SIMULAR TEMPORADA"}
                </button>
              </div>
              {leagueTable.length > 0 ? (
                <div className="overflow-x-hidden rounded-xl border-2 border-[#2b2c34]">
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead className="bg-[#f0f4f8] text-[8.5px] font-black text-[#2b2c34] uppercase border-b-2 border-[#2b2c34] tracking-tighter">
                      <tr><th className="px-1 py-3.5 w-6 text-center">#</th><th className="px-1.5 py-3.5 w-[28%]">EQUIPE</th><th className="px-1 py-3.5 text-center">XPTS</th><th className="px-1 py-3.5 text-center text-[#ff5e3a]">TIT</th><th className="px-1 py-3.5 text-center text-[#059669]">G6</th><th className="px-1 py-3.5 text-center text-[#e45858]">Z4</th></tr>
                    </thead>
                    <tbody className="divide-y divide-[#2b2c34]/5 text-[11px] font-black text-[#2b2c34]">
                      {leagueTable.map((row, idx) => (
                        <tr key={row.name} className="hover:bg-[#ff5e3a]/5 transition-colors">
                          <td className="px-1 py-3 text-[#2b2c34]/40 text-center text-[9px]">{idx + 1}</td>
                          <td className="px-1.5 py-3 uppercase truncate max-w-[65px] leading-none">{row.name}</td>
                          <td className="px-1 py-3 text-center font-mono bg-[#f0f4f8]/50 text-[12px]">{row.avgPoints.toFixed(1)}</td>
                          <td className="px-1 py-3 text-center text-[#ff5e3a]">{row.titleProb > 0.05 ? `${row.titleProb.toFixed(1)}%` : '-'}</td>
                          <td className="px-1 py-3 text-center text-[#059669]">{row.libertaProb > 0.05 ? `${row.libertaProb.toFixed(1)}%` : '-'}</td>
                          <td className="px-1 py-3 text-center text-[#e45858]">{row.z4Prob > 0.05 ? `${row.z4Prob.toFixed(1)}%` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-center py-16 text-[#2b2c34]/30 font-black uppercase text-[10px] border-4 border-dashed rounded-3xl">Aguardando Simulação</div>}
            </section>
          </div>
        )}

        {activeTab === 'ranking' && (
          <div className="space-y-4 animate-in">
             <section className="bg-[#fffffe] rounded-2xl shadow-[4px_4px_0px_#2b2c34] border-2 border-[#2b2c34] overflow-hidden">
                <div className="p-4 bg-[#f0f4f8]/50 border-b-2 border-[#2b2c34]">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-black text-[#2b2c34] text-[13px] uppercase leading-none">Power Ranking</h3>
                        <Award className="w-6 h-6 text-[#ff5e3a]" />
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#2b2c34]/40" />
                        <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Pesquisar time..." className="w-full bg-[#fffffe] border-2 border-[#2b2c34] rounded-xl py-2 pl-10 pr-4 font-black text-[12px] outline-none text-[#2b2c34] shadow-inner" />
                    </div>
                </div>
                <div className="overflow-x-hidden">
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead className="bg-[#f0f4f8] text-[9px] font-black text-[#2b2c34] uppercase border-b-2 border-[#2b2c34]">
                        <tr><th className="px-4 py-4 w-[45%]">Equipe</th><th className="px-1 py-4 text-center w-[27.5%]">Atq</th><th className="px-1 py-4 text-center w-[27.5%]">Def</th></tr>
                    </thead>
                    <tbody className="divide-y divide-[#2b2c34]/5">
                      {powerRanking.map((team, idx) => (
                        <tr key={team.name} className="hover:bg-[#ff5e3a]/5 transition-colors">
                          <td className="px-4 py-4 flex flex-col gap-1 min-w-0"><span className="text-[13px] font-black uppercase truncate w-full">{team.name}</span><span className="text-[8px] font-black opacity-40 italic leading-none">Rank #{idx + 1}</span></td>
                          <td className="px-1 py-4 text-center leading-none"><div className={`text-[12px] font-mono font-black px-2 py-1.5 rounded-xl inline-block min-w-[45px] ${team.attack > 0 ? 'text-[#fffffe] bg-[#ff5e3a] shadow-[2px_2px_0px_#2b2c34]' : 'text-[#2b2c34] bg-[#f0f4f8] border-2 border-[#2b2c34]'}`}>{team.attack.toFixed(2)}</div></td>
                          <td className="px-1 py-4 text-center leading-none"><div className={`text-[12px] font-mono font-black px-2 py-1.5 rounded-xl inline-block min-w-[45px] ${team.defense < 0 ? 'text-[#fffffe] bg-[#059669] shadow-[2px_2px_0px_#2b2c34]' : 'text-[#e45858] bg-[#e45858]/10 border-2 border-[#2b2c34]'}`}>{team.defense.toFixed(2)}</div></td>
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
