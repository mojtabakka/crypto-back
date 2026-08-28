import type { MarketAnalysis } from './market-analysis';
import type { TimeframeWindow } from './market-signal.types';
import type { MarketSnapshot } from './market-snapshot';

import { calculateChange } from '../utils/change.util';
import { getMovement } from './signal.engine';
import { SIGNAL_THRESHOLDS } from './signal.thresholds';
import { calculateMarketScore } from './score-engine';
import { calculateMarketBias } from './market-bias';

export function convertToMarketAnalysis(
  window: TimeframeWindow,
  snapshots: MarketSnapshot[],
  volumeRatio: number,
): MarketAnalysis {
  const windowSnapshots = window.snapshots;

  const firstSnapshot =
    windowSnapshots.length > 0 ? windowSnapshots[0] : snapshots[0];

  const lastSnapshot =
    windowSnapshots.length > 0
      ? windowSnapshots[windowSnapshots.length - 1]
      : snapshots[snapshots.length - 1];

  const priceChangePct = calculateChange(window.startPrice, window.endPrice);

  const oiChangePct = calculateChange(
    window.startOpenInterest,
    window.endOpenInterest,
  );

  const volumeChangePct = (volumeRatio - 1) * 100;

  const fundingChange =
    firstSnapshot && lastSnapshot
      ? calculateChange(firstSnapshot.fundingRate, lastSnapshot.fundingRate)
      : 0;

  const liquidationTotal = window.longLiquidation + window.shortLiquidation;

  const previousLiquidationTotal = firstSnapshot
    ? firstSnapshot.longLiquidation + firstSnapshot.shortLiquidation
    : 0;

  const liquidationChange = calculateChange(
    previousLiquidationTotal,
    liquidationTotal,
  );

  const priceMovement = getMovement(
    priceChangePct,
    SIGNAL_THRESHOLDS.price.up,
    SIGNAL_THRESHOLDS.price.strongUp,
    SIGNAL_THRESHOLDS.price.down,
    SIGNAL_THRESHOLDS.price.strongDown,
  );

  const oiMovement = getMovement(
    oiChangePct,
    SIGNAL_THRESHOLDS.openInterest.up,
    SIGNAL_THRESHOLDS.openInterest.strongUp,
    SIGNAL_THRESHOLDS.openInterest.down,
    SIGNAL_THRESHOLDS.openInterest.strongDown,
  );

  const volumeMovement = getMovement(
    volumeChangePct,
    SIGNAL_THRESHOLDS.volume.up,
    SIGNAL_THRESHOLDS.volume.strongUp,
    SIGNAL_THRESHOLDS.volume.down,
    SIGNAL_THRESHOLDS.volume.strongDown,
  );

  const baseAnalysis = {
    time: lastSnapshot ? lastSnapshot.time : Date.now(),

    price: {
      value: window.endPrice,
      change: priceChangePct,
      movement: priceMovement,
    },

    volume: {
      value: window.totalVolume,
      change: volumeChangePct,
      movement: volumeMovement,
    },

    openInterest: {
      value: window.endOpenInterest,
      change: oiChangePct,
      movement: oiMovement,
    },

    funding: {
      value: window.fundingRate,
      change: fundingChange,
    },

    liquidation: {
      long: window.longLiquidation,
      short: window.shortLiquidation,
      total: liquidationTotal,
      net: window.longLiquidation - window.shortLiquidation,
      change: liquidationChange,
    },
  };

  return {
    ...baseAnalysis,
    score: calculateMarketScore(baseAnalysis),
    bias: calculateMarketBias(baseAnalysis),
  };
}
