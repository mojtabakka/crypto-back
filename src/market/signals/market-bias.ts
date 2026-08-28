import type { BaseMarketAnalysis } from './market-analysis';

// =====================================================
// Market Bias
// =====================================================

export type MarketBias =
  'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';

// =====================================================
// Market Bias Result
// =====================================================

export interface MarketBiasResult {
  bias: MarketBias;
  score: number;
  message: string;
}

// =====================================================
// Calculate Market Bias
// =====================================================

export function calculateMarketBias(
  analysis: BaseMarketAnalysis,
): MarketBiasResult {
  const { price, openInterest, volume, funding } = analysis;

  let score = 0;

  // =================================================
  // Price
  // =================================================

  switch (price.movement) {
    case 'STRONG_UP':
      score += 2;
      break;

    case 'UP':
      score += 1;
      break;

    case 'NEUTRAL':
      break;

    case 'DOWN':
      score -= 1;
      break;

    case 'STRONG_DOWN':
      score -= 2;
      break;
  }

  // =================================================
  // Open Interest
  // =================================================

  switch (openInterest.movement) {
    case 'STRONG_UP':
      score += 2;
      break;

    case 'UP':
      score += 1;
      break;

    case 'NEUTRAL':
      break;

    case 'DOWN':
      score -= 1;
      break;

    case 'STRONG_DOWN':
      score -= 2;
      break;
  }

  // =================================================
  // Volume
  // =================================================

  switch (volume.movement) {
    case 'STRONG_UP':
      score += 1;
      break;

    case 'UP':
      score += 0.5;
      break;

    case 'NEUTRAL':
      break;

    case 'DOWN':
      score -= 0.5;
      break;

    case 'STRONG_DOWN':
      score -= 1;
      break;
  }

  // =================================================
  // Funding
  // =================================================

  if (funding.value < 0) {
    score += 0.5;
  } else if (funding.value > 0) {
    score -= 0.5;
  }

  // =================================================
  // Final Bias
  // =================================================

  if (score >= 4) {
    return {
      bias: 'STRONG_BULLISH',
      score,
      message: 'ساختار بازار به‌شدت صعودی است.',
    };
  }

  if (score >= 2) {
    return {
      bias: 'BULLISH',
      score,
      message: 'ساختار بازار تمایل صعودی دارد.',
    };
  }

  if (score <= -4) {
    return {
      bias: 'STRONG_BEARISH',
      score,
      message: 'ساختار بازار به‌شدت نزولی است.',
    };
  }

  if (score <= -2) {
    return {
      bias: 'BEARISH',
      score,
      message: 'ساختار بازار تمایل نزولی دارد.',
    };
  }

  return {
    bias: 'NEUTRAL',
    score,
    message: 'ساختار بازار فعلاً خنثی است.',
  };
}
