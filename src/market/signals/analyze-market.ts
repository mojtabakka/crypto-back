import type { MarketSnapshot } from './market-snapshot';

import { calculateChange } from '../utils/change.util';

import { getMovement } from './signal.engine';

import type { BaseMarketAnalysis, MarketAnalysis } from './market-analysis';

import { calculateMarketScore } from './score-engine';

import { calculateMarketBias } from './market-bias';

export function analyzeMarket(
  current: MarketSnapshot,
  previous: MarketSnapshot,
): MarketAnalysis {
  // =========================
  // 1. Calculate Changes
  // =========================

  const priceChange = calculateChange(previous.price, current.price);

  const volumeChange = calculateChange(previous.volume, current.volume);

  const oiChange = calculateChange(previous.openInterest, current.openInterest);

  const fundingChange = calculateChange(
    previous.fundingRate,
    current.fundingRate,
  );

  const liquidationTotalPrevious =
    previous.longLiquidation + previous.shortLiquidation;

  const liquidationTotalCurrent =
    current.longLiquidation + current.shortLiquidation;

  const liquidationChange = calculateChange(
    liquidationTotalPrevious,
    liquidationTotalCurrent,
  );

  // =========================
  // 2. Build Base Analysis
  // =========================

  const analysisWithoutScore: BaseMarketAnalysis = {
    time: current.time,

    // =========================
    // Price
    // =========================

    price: {
      value: current.price,

      change: priceChange,

      movement: getMovement(priceChange, 1, 3, -1, -3),
    },

    // =========================
    // Volume
    // =========================

    volume: {
      value: current.volume,

      change: volumeChange,

      movement: getMovement(volumeChange, 20, 50, -20, -50),
    },

    // =========================
    // Open Interest
    // =========================

    openInterest: {
      value: current.openInterest,

      change: oiChange,

      movement: getMovement(oiChange, 2, 5, -2, -5),
    },

    // =========================
    // Funding
    // =========================

    funding: {
      value: current.fundingRate,

      change: fundingChange,
    },

    liquidation: {
      long: current.longLiquidation,

      short: current.shortLiquidation,

      total: liquidationTotalCurrent,

      net: current.longLiquidation - current.shortLiquidation,

      change: liquidationChange,
    },
  };

  // =========================
  // 3. Calculate Score
  // =========================

  const score = calculateMarketScore(analysisWithoutScore);

  // =========================
  // 4. Calculate Bias
  // =========================

  const bias = calculateMarketBias(analysisWithoutScore);

  // =========================
  // 5. Final Market Analysis
  // =========================

  const analysis: MarketAnalysis = {
    ...analysisWithoutScore,

    score,

    bias,
  };

  return analysis;
}
