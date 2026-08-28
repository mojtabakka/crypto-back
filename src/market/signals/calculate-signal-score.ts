import type { MarketAnalysis } from './market-analysis';

export function calculateSignalScore(analysis: MarketAnalysis): number {
  let score = 0;

  // =========================
  // Price
  // =========================

  if (analysis.price.movement === 'STRONG_UP') {
    score += 2;
  } else if (analysis.price.movement === 'UP') {
    score += 1;
  } else if (analysis.price.movement === 'STRONG_DOWN') {
    score -= 2;
  } else if (analysis.price.movement === 'DOWN') {
    score -= 1;
  }

  // =========================
  // Open Interest
  // =========================

  if (analysis.openInterest.movement === 'STRONG_UP') {
    score += 2;
  } else if (analysis.openInterest.movement === 'UP') {
    score += 1;
  } else if (analysis.openInterest.movement === 'STRONG_DOWN') {
    score -= 2;
  } else if (analysis.openInterest.movement === 'DOWN') {
    score -= 1;
  }

  // =========================
  // Volume
  // =========================

  if (analysis.volume.movement === 'STRONG_UP') {
    score += 2;
  } else if (analysis.volume.movement === 'UP') {
    score += 1;
  } else if (analysis.volume.movement === 'STRONG_DOWN') {
    score -= 2;
  } else if (analysis.volume.movement === 'DOWN') {
    score -= 1;
  }

  // =========================
  // Funding
  // =========================

  if (analysis.funding.change > 0) {
    score += 1;
  } else if (analysis.funding.change < 0) {
    score -= 1;
  }

  return score;
}
