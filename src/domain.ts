// Contratos compartidos del recorrido local. Las fechas son UTC en milisegundos.
export interface HistoricalMatch {
  competition?:'LaLiga'|'Champions'; neutral?:boolean; stage?:string;
  id: string; season: string; date: string; kickoffAt: number | null;
  home: string; away: string; homeGoals: number | null; awayGoals: number | null;
  status: 'scheduled' | 'finished' | 'postponed' | 'unknown';
  source: string; captureId: string; availableAt: number;
}
export interface NewsItem {
  id: string; title: string; text: string; url: string; source: string;
  publishedAt: number | null; receivedAt: number; captureId: string; teams: string[];
  scope: 'metadata' | 'excerpt' | 'full'; duplicateOf?: string;
}
export interface ExtractedFact {
  kind: 'injury' | 'doubt' | 'suspension' | 'rotation' | 'minutes' | 'lineup' | 'other';
  team: string; player: string | null; evidence: string; newsId: string;
  status: 'reported' | 'rumour' | 'official';
}
export interface NewsAnalysis {
  status: 'available' | 'unavailable' | 'invalid' | 'empty'; checkedAt: number;
  model: string; facts: ExtractedFact[]; warnings: string[];
}
export interface CoverageRow {
  source: string; season: string; matches: number; scored: number;
  missingPastResults: number; missingKickoff: number; latestResult: string | null; warnings: string[];
}
export interface DataSnapshot {
  competition?:'LaLiga'|'Champions';
  version: 1; updatedAt: number; matches: HistoricalMatch[]; coverage: CoverageRow[];
  news: NewsItem[]; newsAnalysis: NewsAnalysis; errors: string[];
}
export type MarketKind = '1x2' | 'double_chance' | 'dnb' | 'asian_handicap' | 'european_handicap' | 'total_goals' | 'team_goals' | 'btts';
export interface MarketSelection {
  kind: MarketKind; side: 'home' | 'draw' | 'away' | 'home_draw' | 'home_away' | 'draw_away' | 'over' | 'under' | 'yes' | 'no';
  line: number | null; team?: 'home' | 'away';
}
