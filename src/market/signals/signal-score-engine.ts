import type { MarketAnalysis } from './market-analysis';
import type { SignalResult } from './signal-result';

export interface SignalScoreResult {
  score: number;

  marketScore: number;

  priceScore: number;

  openInterestScore: number;

  volumeScore: number;

  fundingScore: number;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateSignalScore(
  analysis: MarketAnalysis,
  signal: SignalResult,
): SignalScoreResult {
  const marketScore = analysis.score?.score ?? 0;

  const priceScore = getMovementScore(analysis.price.movement);

  const openInterestScore = getMovementScore(analysis.openInterest.movement);

  const volumeScore = getMovementScore(analysis.volume.movement);

  const fundingScore = getFundingScore(analysis);

  let score =
    priceScore * 0.35 +
    openInterestScore * 0.3 +
    volumeScore * 0.2 +
    fundingScore * 0.15;

  // =========================
  // Signal specific adjustment
  // =========================

  score = applySignalAdjustment(score, signal.code, analysis);

  return {
    score: clamp(Math.round(score)),

    marketScore,

    priceScore,

    openInterestScore,

    volumeScore,

    fundingScore,
  };
}

function getMovementScore(
  movement: 'STRONG_UP' | 'UP' | 'NEUTRAL' | 'DOWN' | 'STRONG_DOWN',
): number {
  switch (movement) {
    case 'STRONG_UP':
      return 100;

    case 'UP':
      return 75;

    case 'NEUTRAL':
      return 50;

    case 'DOWN':
      return 25;

    case 'STRONG_DOWN':
      return 0;

    default:
      return 50;
  }
}

function getFundingScore(analysis: MarketAnalysis): number {
  const { value, change } = analysis.funding;

  // Funding منفی و در حال کاهش
  // برای سناریوهای Long مناسب‌تر است.

  if (value < 0 && change < 0) {
    return 90;
  }

  // Funding منفی ولی پایدار

  if (value < 0) {
    return 75;
  }

  // Funding مثبت و در حال افزایش
  // ریسک ازدحام Long

  if (value > 0 && change > 0) {
    return 35;
  }

  // Funding مثبت ولی پایدار

  if (value > 0) {
    return 50;
  }

  return 60;
}

function applySignalAdjustment(
  score: number,
  code: string,
  analysis: MarketAnalysis,
): number {
  let adjustment = 0;

  switch (code) {
    case 'STRONG_BULLISH':
      if (analysis.price.movement === 'STRONG_UP') {
        adjustment += 5;
      }

      break;

    case 'LONG_PUMP':
      if (analysis.funding.change > 0) {
        adjustment += 5;
      }

      break;

    case 'LONG_FLUSH':
      if (analysis.volume.movement === 'STRONG_UP') {
        adjustment += 10;
      }

      break;

    case 'SEVERE_LONG_SQUEEZE':
      if (analysis.volume.movement === 'STRONG_UP') {
        adjustment += 10;
      }

      break;

    case 'SHORT_SQUEEZE':
      if (analysis.price.movement === 'STRONG_UP') {
        adjustment += 10;
      }

      break;

    case 'SHORT_BUILDING':
      if (analysis.openInterest.movement === 'STRONG_UP') {
        adjustment += 5;
      }

      break;

    case 'PUMP_DISTRIBUTION_RISK':
      if (analysis.funding.change > 0) {
        adjustment += 10;
      }

      break;
  }

  return score + adjustment;
}
