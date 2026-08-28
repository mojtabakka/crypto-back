import type { BaseMarketAnalysis } from './market-analysis';

export interface ScoreResult {
  score: number;

  priceScore: number;
  openInterestScore: number;
  volumeScore: number;
  fundingScore: number;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Price
 * وزن: 30
 */
function calculatePriceScore(analysis: BaseMarketAnalysis): number {
  switch (analysis.price.movement) {
    case 'STRONG_UP':
      return 30;

    case 'UP':
      return 20;

    case 'NEUTRAL':
      return 10;

    case 'DOWN':
      return 5;

    case 'STRONG_DOWN':
      return 0;

    default:
      return 0;
  }
}

/**
 * Open Interest
 * وزن: 30
 */
function calculateOpenInterestScore(analysis: BaseMarketAnalysis): number {
  switch (analysis.openInterest.movement) {
    case 'STRONG_UP':
      return 30;

    case 'UP':
      return 20;

    case 'NEUTRAL':
      return 10;

    case 'DOWN':
      return 5;

    case 'STRONG_DOWN':
      return 0;

    default:
      return 0;
  }
}

/**
 * Volume
 * وزن: 25
 */
function calculateVolumeScore(analysis: BaseMarketAnalysis): number {
  switch (analysis.volume.movement) {
    case 'STRONG_UP':
      return 25;

    case 'UP':
      return 18;

    case 'NEUTRAL':
      return 10;

    case 'DOWN':
      return 5;

    case 'STRONG_DOWN':
      return 0;

    default:
      return 0;
  }
}

/**
 * Funding
 * وزن: 15
 */
function calculateFundingScore(analysis: BaseMarketAnalysis): number {
  const { value, change } = analysis.funding;

  // Funding منفی
  if (value < 0) {
    if (change < 0) {
      return 15;
    }

    return 12;
  }

  // Funding مثبت
  if (value > 0) {
    if (change > 0) {
      return 5;
    }

    return 8;
  }

  return 10;
}

/**
 * محاسبه Score نهایی بازار
 */
export function calculateMarketScore(
  analysis: BaseMarketAnalysis,
): ScoreResult {
  const priceScore = calculatePriceScore(analysis);

  const openInterestScore = calculateOpenInterestScore(analysis);

  const volumeScore = calculateVolumeScore(analysis);

  const fundingScore = calculateFundingScore(analysis);

  const score = priceScore + openInterestScore + volumeScore + fundingScore;

  return {
    score: clamp(score),

    priceScore,

    openInterestScore,

    volumeScore,

    fundingScore,
  };
}
