import type { BinanceKline } from 'src/market/dto/binance-kline.type';
import type { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import type { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

import type { MarketSnapshot } from '../signals/market-snapshot';
import { BinanceLiquidationOrder } from '../types/binance-liquidation.type';

// ==========================================
// Mapper
// ==========================================

export function mapMarketSnapshots(
  klines: BinanceKline[],
  openInterest: BinanceOpenInterest[],
  fundingRates: BinanceFundingRate[],
  liquidations: BinanceLiquidationOrder[],
): MarketSnapshot[] {
  return klines.map((kline, index) => {
    // ========================================
    // Kline
    // ========================================

    const time = Number(kline[0]);

    const price = Number(kline[4]);

    const volume = Number(kline[5]);

    // ========================================
    // Candle Range
    // ========================================

    const nextKline = klines[index + 1];

    const candleEndTime = nextKline
      ? Number(nextKline[0])
      : time + 15 * 60 * 1000;

    // ========================================
    // Open Interest
    // ========================================

    const oi = findLatestOpenInterest(openInterest, time);

    // ========================================
    // Funding
    // ========================================

    const funding = findLatestFundingRate(fundingRates, time);

    // ========================================
    // Liquidation
    // ========================================

    const liquidation = calculateLiquidations(
      liquidations,
      time,
      candleEndTime,
    );

    // ========================================
    // Snapshot
    // ========================================

    return {
      time,

      price,

      volume,

      openInterest: oi ? Number(oi.sumOpenInterest) : 0,

      openInterestValue: oi ? Number(oi.sumOpenInterestValue) : 0,

      fundingRate: funding ? Number(funding.fundingRate) : 0,

      longLiquidation: liquidation.longLiquidation,

      shortLiquidation: liquidation.shortLiquidation,
    };
  });
}

// ==========================================
// Find Latest Open Interest
// ==========================================

function findLatestOpenInterest(
  data: BinanceOpenInterest[],
  targetTime: number,
): BinanceOpenInterest | null {
  let latest: BinanceOpenInterest | null = null;

  for (const item of data) {
    const timestamp = Number(item.timestamp);

    if (
      timestamp <= targetTime &&
      (!latest || timestamp > Number(latest.timestamp))
    ) {
      latest = item;
    }
  }

  // Fallback: nearest open interest if none found at or before target time
  if (!latest && data.length > 0) {
    return data.reduce((nearest, item) => {
      const candidateDiff = Math.abs(Number(item.timestamp) - targetTime);

      const nearestDiff = Math.abs(Number(nearest.timestamp) - targetTime);

      return candidateDiff < nearestDiff ? item : nearest;
    }, data[0]);
  }

  return latest;
}

// ==========================================
// Find Latest Funding Rate
// ==========================================

function findLatestFundingRate(
  data: BinanceFundingRate[],
  targetTime: number,
): BinanceFundingRate | null {
  let latest: BinanceFundingRate | null = null;

  for (const item of data) {
    const timestamp = Number(item.fundingTime);

    if (
      timestamp <= targetTime &&
      (!latest || timestamp > Number(latest.fundingTime))
    ) {
      latest = item;
    }
  }

  if (latest) {
    return latest;
  }

  if (!data.length) {
    return null;
  }

  return data.reduce((nearest, item) => {
    const candidateDiff = Math.abs(Number(item.fundingTime) - targetTime);

    const nearestDiff = Math.abs(Number(nearest.fundingTime) - targetTime);

    return candidateDiff < nearestDiff ? item : nearest;
  }, data[0]);
}

// ==========================================
// Calculate Liquidations
// ==========================================

function calculateLiquidations(
  data: BinanceLiquidationOrder[],
  startTime: number,
  endTime: number,
): {
  longLiquidation: number;
  shortLiquidation: number;
} {
  let longLiquidation = 0;

  let shortLiquidation = 0;

  for (const item of data) {
    const time = Number(item.lastUpdateTime);

    // خارج از محدوده Candle
    if (time < startTime || time >= endTime) {
      continue;
    }

    const quantity = Number(item.executedQty);

    const price = Number(item.averagePrice || item.price);

    const liquidationValue = quantity * price;

    // SELL liquidation
    // → Long position liquidation

    if (item.side === 'SELL') {
      longLiquidation += liquidationValue;
    }

    // BUY liquidation
    // → Short position liquidation

    if (item.side === 'BUY') {
      shortLiquidation += liquidationValue;
    }
  }

  return {
    longLiquidation,

    shortLiquidation,
  };
}
