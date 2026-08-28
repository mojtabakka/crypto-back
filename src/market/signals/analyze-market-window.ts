import type { MarketWindow } from './build-market-windows';
import type { MarketAnalysis } from './market-analysis';

import { analyzeMarket } from './analyze-market';

export function analyzeMarketWindow(window: MarketWindow): MarketAnalysis {
  return analyzeMarket(window.current, window.previous);
}
