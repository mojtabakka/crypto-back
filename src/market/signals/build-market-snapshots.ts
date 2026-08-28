import type { BinanceKline } from '../dto/binance-kline.type';
import type { BinanceFundingRate } from '../types/binance-funding-rate.type';
import type { BinanceLiquidationOrder } from '../types/binance-liquidation.type';
import type { BinanceOpenInterest } from '../types/binance-open-interest.type';

import type { MarketSnapshot } from './market-snapshot';

// ==========================================
// Snapshot Builder
// ==========================================

export function buildMarketSnapshots(
  klines: BinanceKline[],
  openInterest: BinanceOpenInterest[],
  funding: BinanceFundingRate[],
  liquidations: BinanceLiquidationOrder[],
): MarketSnapshot[] {
  const sortedOI = [...openInterest].sort((a, b) => a.timestamp - b.timestamp);

  const sortedFunding = [...funding].sort(
    (a, b) => a.fundingTime - b.fundingTime,
  );

  let oiIndex = 0;
  let fundingIndex = 0;

  let latestOI: BinanceOpenInterest | null = null;
  let latestFunding: BinanceFundingRate | null = null;

  // ==========================================
  // Helper: Get liquidations within candle range
  // ==========================================

  const getLiquidationsForCandle = (
    startTime: number,
    endTime: number,
  ): { long: number; short: number } => {
    let long = 0;
    let short = 0;

    for (const order of liquidations) {
      const time = order.lastUpdateTime;

      // خارج از محدوده Candle
      if (time < startTime || time >= endTime) {
        continue;
      }

      const quantity = Number(order.executedQty);
      const price = Number(order.averagePrice || order.price);

      const value = quantity * price;

      // SELL → Long position liquidation
      if (order.side === 'SELL') {
        long += value;
      }

      // BUY → Short position liquidation
      if (order.side === 'BUY') {
        short += value;
      }
    }

    return { long, short };
  };

  const snapshots: MarketSnapshot[] = [];

  for (const kline of klines) {
    const candleTime = kline[0];

    const close = Number(kline[4]);
    const volume = Number(kline[5]);

    // =====================================
    // Last Open Interest before this candle
    // =====================================

    while (
      oiIndex < sortedOI.length &&
      sortedOI[oiIndex].timestamp <= candleTime
    ) {
      latestOI = sortedOI[oiIndex];
      oiIndex++;
    }

    // =====================================
    // Last Funding Rate before this candle

    // (with nearest fallback to avoid skipping)
    // ==========================================

    while (
      fundingIndex < sortedFunding.length &&
      sortedFunding[fundingIndex].fundingTime <= candleTime
    ) {
      latestFunding = sortedFunding[fundingIndex];
      fundingIndex++;
    }

    // اگر هنوز Funding نداریم، نزدیک‌ترین را بگیریم
    if (!latestFunding && sortedFunding.length > 0) {
      latestFunding = sortedFunding[0];
    }

    // اگر هنوز Open Interest نداریم، نزدیک‌ترین را بگیریم
    if (!latestOI && sortedOI.length > 0) {
      latestOI = sortedOI[0];
    }

    // اگر هر دو نداریم، Snapshot ساخته نمی‌شود
    if (!latestOI) {
      continue;
    }

    // =====================================
    // Candle End Time
    // =====================================

    const nextIndex = klines.indexOf(kline) + 1;
    const nextKline = klines[nextIndex];

    const candleEndTime = nextKline
      ? Number(nextKline[0])
      : candleTime + 15 * 60 * 1000;

    // =====================================
    // Liquidations
    // =====================================

    const liquidation = getLiquidationsForCandle(candleTime, candleEndTime);

    snapshots.push({
      time: candleTime,

      price: close,

      volume,

      openInterest: Number(latestOI.sumOpenInterest),

      openInterestValue: Number(latestOI.sumOpenInterestValue),

      fundingRate: latestFunding ? Number(latestFunding.fundingRate) : 0,

      longLiquidation: liquidation.long,

      shortLiquidation: liquidation.short,
    });
  }

  return snapshots;
}
