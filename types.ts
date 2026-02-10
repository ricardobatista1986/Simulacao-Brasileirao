export interface TeamStats {
  attack: number;
  defense: number;
  attack_raw: number;
  defense_raw: number;
  hfa_raw: number;
  strength?: number;
}

export interface MatchData {
  home: string;
  away: string;
  hGoals?: number | null;
  aGoals?: number | null;
  hxg?: number | null;
  axg?: number | null;
  matchDate?: Date;
  hPond?: number;
  aPond?: number;
  played?: boolean;
  weight?: number;
  // Dynamic keys from CSV parsing
  [key: string]: any;
}

export interface SimulationResult {
  probs: {
    home: number;
    draw: number;
    away: number;
  };
  matrix: number[][];
  expectedGoals: {
    home: number;
    away: number;
  };
  expectedPointsHome: number;
  expectedPointsAway: number;
}

export interface LeagueRow {
  name: string;
  avgPoints: number;
  titleProb: number;
  g4Prob: number;
  z4Prob: number;
}

export interface GlobalParams {
  hfa: number;
  rho: number;
  xi: number;
}

export interface LeagueStat {
  points: number;
  title: number;
  g4: number;
  z4: number;
  simPoints: number;
}

export interface TrainingResult {
    teamStats: Record<string, TeamStats>;
    hfa: number;
    rho: number;
    error: number;
}