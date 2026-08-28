import {
  MarketSnapshot,
  Timeframe,
  TimeframeWindow,
} from './market-signal.types';

// ==========================================
// Timeframe Configuration
// ==========================================

interface TimeframeConfig {
  milliseconds: number;
  candleCount: number;
}

// ==========================================
// Timeframe Window Builder
// ==========================================

export class TimeframeWindowBuilder {
  private readonly configs: Record<Timeframe, TimeframeConfig> = {
    '15m': {
      milliseconds: 15 * 60 * 1000,

      candleCount: 1,
    },

    '1h': {
      milliseconds: 60 * 60 * 1000,

      candleCount: 4,
    },

    '4h': {
      milliseconds: 4 * 60 * 60 * 1000,

      candleCount: 16,
    },
  };

  // ==========================================
  // Build
  // ==========================================

  build(
    snapshots: MarketSnapshot[],
    timeframe: Timeframe,
  ): TimeframeWindow | null {
    if (!snapshots.length) {
      return null;
    }

    // ========================================
    // Sort
    // ========================================

    const sorted = [...snapshots].sort((a, b) => a.time - b.time);

    const config = this.configs[timeframe];

    if (!config) {
      return null;
    }

    // ========================================
    // Latest Snapshot
    // ========================================

    const latest = sorted[sorted.length - 1];

    // ========================================
    // Window Start
    // ========================================

    const windowStart = latest.time - config.milliseconds;

    // ========================================
    // Current Window
    // ========================================

    const currentSnapshots = sorted.filter(
      (snapshot) => snapshot.time > windowStart && snapshot.time <= latest.time,
    );

    /*
     * برای 15m داشتن یک Snapshot هم کافی است.
     *
     * برای 1h و 4h بهتر است حداقل
     * دو Snapshot داشته باشیم تا
     * تغییر قیمت و OI قابل محاسبه باشد.
     */

    const minimumSnapshots = timeframe === '15m' ? 1 : 2;

    if (currentSnapshots.length < minimumSnapshots) {
      return null;
    }

    // ========================================
    // First / Last
    // ========================================

    const first = currentSnapshots[0];

    const last = currentSnapshots[currentSnapshots.length - 1];

    // ========================================
    // Total Volume
    // ========================================

    const totalVolume = currentSnapshots.reduce(
      (total, snapshot) => total + snapshot.volume,

      0,
    );

    // ========================================
    // Average Volume
    // ========================================

    const averageVolume =
      currentSnapshots.length > 0 ? totalVolume / currentSnapshots.length : 0;

    // ========================================
    // Funding
    // ========================================

    const fundingRate = last.fundingRate;

    // ========================================
    // Liquidations
    // ========================================

    /*
     * فعلاً Liquidation را از Snapshot
     * دریافت نمی‌کنیم.
     *
     * مرحله بعد این قسمت را به
     * Binance Liquidation WebSocket
     * وصل می‌کنیم.
     */

    const longLiquidation = currentSnapshots.reduce(
      (total, snapshot) => total + snapshot.longLiquidation,
      0,
    );

    const shortLiquidation = currentSnapshots.reduce(
      (total, snapshot) => total + snapshot.shortLiquidation,
      0,
    );

    // ========================================
    // Return
    // ========================================

    return {
      timeframe,

      startTime: first.time,

      endTime: last.time,

      startPrice: first.price,

      endPrice: last.price,

      startOpenInterest: first.openInterest,

      endOpenInterest: last.openInterest,

      totalVolume,

      averageVolume,

      fundingRate,

      longLiquidation,

      shortLiquidation,

      snapshots: currentSnapshots,
    };
  }

  // ==========================================
  // Calculate Volume Ratio
  // ==========================================

  calculateVolumeRatio(
    snapshots: MarketSnapshot[],
    timeframe: Timeframe,
  ): number {
    if (snapshots.length < 2) {
      return 1;
    }

    // ========================================
    // Sort
    // ========================================

    const sorted = [...snapshots].sort((a, b) => a.time - b.time);

    // ========================================
    // Timeframe Duration
    // ========================================

    const timeframeDuration = this.configs[timeframe].milliseconds;

    // ========================================
    // Latest Time
    // ========================================

    const latestTime = sorted[sorted.length - 1].time;

    // ========================================
    // Current Window
    // ========================================

    const currentStart = latestTime - timeframeDuration;

    const currentSnapshots = sorted.filter(
      (snapshot) => snapshot.time > currentStart && snapshot.time <= latestTime,
    );

    if (currentSnapshots.length === 0) {
      return 1;
    }

    // ========================================
    // Current Volume
    // ========================================

    const currentVolume = currentSnapshots.reduce(
      (total, snapshot) => total + snapshot.volume,

      0,
    );

    // ========================================
    // Historical Windows
    // ========================================

    const historicalVolumes: number[] = [];

    let windowEnd = currentStart;

    while (windowEnd > sorted[0].time) {
      const windowStart = windowEnd - timeframeDuration;

      const windowSnapshots = sorted.filter(
        (snapshot) => snapshot.time > windowStart && snapshot.time <= windowEnd,
      );

      if (windowSnapshots.length === 0) {
        break;
      }

      const windowVolume = windowSnapshots.reduce(
        (total, snapshot) => total + snapshot.volume,

        0,
      );

      historicalVolumes.push(windowVolume);

      windowEnd = windowStart;

      // ====================================
      // Maximum 5 historical windows
      // ====================================

      if (historicalVolumes.length >= 5) {
        break;
      }
    }

    // ========================================
    // No Historical Data
    // ========================================

    if (historicalVolumes.length === 0) {
      return 1;
    }

    // ========================================
    // Historical Average
    // ========================================

    const historicalAverage =
      historicalVolumes.reduce(
        (total, volume) => total + volume,

        0,
      ) / historicalVolumes.length;

    if (historicalAverage <= 0) {
      return 1;
    }

    // ========================================
    // Ratio
    // ========================================

    return Number((currentVolume / historicalAverage).toFixed(4));
  }
}
