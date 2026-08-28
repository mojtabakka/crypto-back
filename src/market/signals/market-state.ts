import type { MarketAnalysis } from './market-analysis';
import type { SignalResult } from './signal-result';
import type { MarketBiasResult } from './market-bias';

export interface MarketState {
  time: number;

  score: number;

  bias: MarketBiasResult;

  analysis: MarketAnalysis;

  signals: SignalResult[];

  primarySignal: SignalResult | null;
}
