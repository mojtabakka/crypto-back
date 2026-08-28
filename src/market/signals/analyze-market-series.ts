import type { MarketSnapshot } from './market-snapshot';
import { analyzeMarket } from './analyze-market';
import type { MarketAnalysis } from './market-analysis';

export function analyzeMarketSeries(
  snapshots: MarketSnapshot[],
): MarketAnalysis[] {
  const analyses: MarketAnalysis[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const previous = snapshots[i - 1];
    const current = snapshots[i];

    const analysis = analyzeMarket(current, previous);

    analyses.push(analysis);
  }

  return analyses;
}
