import {
  Positioning,
  Signal,
  Timeframe,
  TimeframeAnalysis,
} from './market-signal.types';

import { ScoreNormalizer } from './score-normalizer';

// ==========================================
// Liquidation Data
// ==========================================

interface LiquidationData {
  longLiquidation: number;
  shortLiquidation: number;
}

// ==========================================
// Timeframe Analyzer
// ==========================================

export class TimeframeAnalyzer {
  // ==========================================
  // Dependencies
  // ==========================================

  private readonly scoreNormalizer = new ScoreNormalizer();

  // ==========================================
  // Analyze
  // ==========================================

  analyze(
    timeframe: Timeframe,

    priceChange: number,

    oiChange: number,

    volumeRatio: number,

    fundingRate: number,

    liquidation: LiquidationData,
  ): TimeframeAnalysis {
    // ========================================
    // Positioning
    // ========================================

    const positioning = this.detectPositioning(priceChange, oiChange);

    // ========================================
    // Price + OI Score
    // ========================================

    const priceOiScore = this.calculatePriceOiScore(priceChange, oiChange);

    // ========================================
    // Volume Score
    // ========================================

    const volumeScore = this.calculateVolumeScore(volumeRatio, positioning);

    // ========================================
    // Funding Score
    // ========================================

    const fundingScore = this.calculateFundingScore(fundingRate);

    // ========================================
    // Liquidation Score
    // ========================================

    const liquidationScore = this.calculateLiquidationScore(liquidation);

    // ========================================
    // Raw Score
    // ========================================

    const rawScore = this.calculateFinalScore(
      priceOiScore,
      volumeScore,
      fundingScore,
      liquidationScore,
    );

    // ========================================
    // Normalize Score
    // ========================================

    const score = this.scoreNormalizer.normalize(rawScore);

    // ========================================
    // Signal
    // ========================================

    const signal = this.getSignal(score);

    // ========================================
    // Result
    // ========================================

    return {
      timeframe,

      priceChange,

      oiChange,

      volumeRatio,

      fundingRate,

      longLiquidation: liquidation.longLiquidation,

      shortLiquidation: liquidation.shortLiquidation,

      positioning,

      priceOiScore,

      volumeScore,

      fundingScore,

      liquidationScore,

      score,

      signal,

      signals: [],
    };
  }

  // ==========================================
  // Positioning
  // ==========================================

  private detectPositioning(
    priceChange: number,
    oiChange: number,
  ): Positioning {
    /*
     * Price ↑ + OI ↑
     *
     * New long positions are being built.
     */

    if (priceChange > 0 && oiChange > 0) {
      return 'LONG_BUILDUP';
    }

    /*
     * Price ↓ + OI ↑
     *
     * New short positions are being built.
     */

    if (priceChange < 0 && oiChange > 0) {
      return 'SHORT_BUILDUP';
    }

    /*
     * Price ↑ + OI ↓
     *
     * Shorts are closing.
     */

    if (priceChange > 0 && oiChange < 0) {
      return 'SHORT_COVERING';
    }

    /*
     * Price ↓ + OI ↓
     *
     * Long positions are closing.
     */

    if (priceChange < 0 && oiChange < 0) {
      return 'LONG_UNWINDING';
    }

    return 'NEUTRAL';
  }

  // ==========================================
  // Price + OI Score
  // ==========================================

  private calculatePriceOiScore(priceChange: number, oiChange: number): number {
    const priceMagnitude = this.calculateMagnitudeScore(
      priceChange,
      0.05,
      0.2,
      0.5,
      1.0,
    );

    const oiMagnitude = this.calculateMagnitudeScore(
      oiChange,
      0.1,
      0.5,
      1.0,
      2.0,
    );

    const positioning = this.detectPositioning(priceChange, oiChange);

    switch (positioning) {
      // ========================================
      // Long Buildup
      // ========================================

      case 'LONG_BUILDUP':
        return Math.min(Math.abs(priceMagnitude) + Math.abs(oiMagnitude), 60);

      // ========================================
      // Short Buildup
      // ========================================

      case 'SHORT_BUILDUP':
        return -Math.min(Math.abs(priceMagnitude) + Math.abs(oiMagnitude), 60);

      // ========================================
      // Short Covering
      // ========================================

      case 'SHORT_COVERING':
        return Math.min(Math.abs(priceMagnitude) + Math.abs(oiMagnitude), 60);

      // ========================================
      // Long Unwinding
      // ========================================

      case 'LONG_UNWINDING':
        return -Math.min(Math.abs(priceMagnitude) + Math.abs(oiMagnitude), 60);

      // ========================================
      // Neutral
      // ========================================

      default:
        return 0;
    }
  }

  private calculateMagnitudeScore(
    change: number,
    level1: number,
    level2: number,
    level3: number,
    level4: number,
  ): number {
    const direction = change > 0 ? 1 : change < 0 ? -1 : 0;

    const magnitude = Math.abs(change);

    if (magnitude < level1) {
      return 0;
    }

    if (magnitude < level2) {
      return direction * 10;
    }

    if (magnitude < level3) {
      return direction * 20;
    }

    if (magnitude < level4) {
      return direction * 25;
    }

    return direction * 30;
  }

  // ==========================================
  // Volume Score
  // ==========================================

  private calculateVolumeScore(
    volumeRatio: number,
    positioning: Positioning,
  ): number {
    let score = 0;

    // ========================================
    // Volume Strength
    // ========================================

    if (volumeRatio >= 3) {
      score = 20;
    } else if (volumeRatio >= 2) {
      score = 15;
    } else if (volumeRatio >= 1.5) {
      score = 10;
    } else if (volumeRatio >= 1.2) {
      score = 5;
    } else if (volumeRatio >= 0.8) {
      score = 0;
    } else if (volumeRatio >= 0.5) {
      score = -5;
    } else {
      score = -10;
    }

    // ========================================
    // Apply Direction
    // ========================================

    switch (positioning) {
      case 'LONG_BUILDUP':
      case 'SHORT_COVERING':
        return score;

      case 'SHORT_BUILDUP':
      case 'LONG_UNWINDING':
        return -score;

      default:
        return 0;
    }
  }

  // ==========================================
  // Funding Score
  // ==========================================

  private calculateFundingScore(fundingRate: number): number {
    /*
     * Funding example:
     *
     * 0.0001 = 0.01%
     *
     * We convert it to percentage first.
     */

    const rate = fundingRate * 100;

    // ----------------------------------------
    // Positive Funding
    // ----------------------------------------

    /*
     * Extremely positive funding
     *
     * Too many longs
     * ↓
     * Long squeeze risk
     * ↓
     * Bearish pressure
     */

    if (rate > 0.03) {
      return -10;
    }

    /*
     * Moderately positive funding
     */

    if (rate > 0.01) {
      return -5;
    }

    // ----------------------------------------
    // Negative Funding
    // ----------------------------------------

    /*
     * Extremely negative funding
     *
     * Too many shorts
     * ↓
     * Short squeeze potential
     * ↓
     * Bullish pressure
     */

    if (rate < -0.03) {
      return 10;
    }

    /*
     * Moderately negative funding
     */

    if (rate < -0.01) {
      return 5;
    }

    return 0;
  }

  // ==========================================
  // Liquidation Score
  // ==========================================

  private calculateLiquidationScore(data: LiquidationData): number {
    const total = data.longLiquidation + data.shortLiquidation;

    /*
     * No liquidation data
     */

    if (total <= 0) {
      return 0;
    }

    const longRatio = data.longLiquidation / total;

    const shortRatio = data.shortLiquidation / total;

    // ----------------------------------------
    // Long Liquidation
    // ----------------------------------------

    /*
     * Heavy long liquidation
     *
     * Longs are getting liquidated
     * ↓
     * Bearish pressure
     */

    if (longRatio >= 0.8) {
      return -15;
    }

    // ----------------------------------------
    // Short Liquidation
    // ----------------------------------------

    /*
     * Heavy short liquidation
     *
     * Shorts are getting liquidated
     * ↓
     * Bullish pressure
     */

    if (shortRatio >= 0.8) {
      return 15;
    }

    return 0;
  }

  // ==========================================
  // Final Raw Score
  // ==========================================

  private calculateFinalScore(
    priceOiScore: number,
    volumeScore: number,
    fundingScore: number,
    liquidationScore: number,
  ): number {
    return priceOiScore + volumeScore + fundingScore + liquidationScore;
  }

  // ==========================================
  // Signal
  // ==========================================

  private getSignal(score: number): Signal {
    /*
     * Score is normalized between
     *
     * -100 ... +100
     */

    if (score >= 70) {
      return 'STRONG_LONG';
    }

    if (score >= 40) {
      return 'LONG';
    }

    if (score <= -70) {
      return 'STRONG_SHORT';
    }

    if (score <= -40) {
      return 'SHORT';
    }

    return 'NEUTRAL';
  }
}
