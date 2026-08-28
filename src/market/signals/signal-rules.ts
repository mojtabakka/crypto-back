import type { MarketAnalysis } from './market-analysis';
import type { SignalCode } from './signal-code';

/**
 * 1️⃣ روند صعودی قوی
 *
 * Price ↑↑
 * OI ↑↑
 * Volume ↑
 * Funding مثبت
 */
export function detectStrongBullish(
  analysis: MarketAnalysis,
): SignalCode | null {
  const { price, openInterest, volume, funding, liquidation } = analysis;

  const priceUp = price.movement === 'STRONG_UP';

  const oiUp = openInterest.movement === 'STRONG_UP';

  const volumeUp = volume.movement === 'UP' || volume.movement === 'STRONG_UP';

  const fundingOkay = funding.value >= 0;

  const liquidationNotExtreme =
    liquidation.long <= liquidation.short * 1.5 || liquidation.total === 0;

  if (priceUp && oiUp && volumeUp && fundingOkay && liquidationNotExtreme) {
    return 'STRONG_BULLISH';
  }

  return null;
}

/**
 * 2️⃣ صعود سالم‌تر
 *
 * Price ↑
 * OI ↑
 * Volume ↑
 * Funding ثابت یا کاهشی
 */
export function detectHealthyBullish(
  analysis: MarketAnalysis,
): SignalCode | null {
  const { price, openInterest, volume, funding } = analysis;

  const priceUp = price.movement === 'UP' || price.movement === 'STRONG_UP';

  const oiUp =
    openInterest.movement === 'UP' || openInterest.movement === 'STRONG_UP';

  const volumeUp = volume.movement === 'UP' || volume.movement === 'STRONG_UP';

  const fundingStableOrDown = funding.change <= 0;

  if (priceUp && oiUp && volumeUp && fundingStableOrDown) {
    return 'HEALTHY_BULLISH';
  }

  return null;
}

/**
 * 3️⃣ پامپ / لانگ‌محور
 *
 * Price ↑↑
 * OI ↑↑
 * Volume ↑↑
 * Funding ↑
 */
export function detectLongPump(analysis: MarketAnalysis): SignalCode | null {
  const { price, openInterest, volume, funding, liquidation } = analysis;

  const priceUp = price.movement === 'STRONG_UP';

  const oiUp = openInterest.movement === 'STRONG_UP';

  const volumeUp = volume.movement === 'STRONG_UP';

  const fundingUp = funding.change > 0;

  const longDominant = liquidation.long >= liquidation.short;

  if (priceUp && oiUp && volumeUp && fundingUp && longDominant) {
    return 'LONG_PUMP';
  }

  return null;
}

/**
 * 4️⃣ اصلاح عادی
 *
 * Price ↓
 * OI ↓
 * Volume ↓
 * Funding ↓
 */
export function detectNormalCorrection(
  analysis: MarketAnalysis,
): SignalCode | null {
  const { price, openInterest, volume, funding, liquidation } = analysis;

  const priceDown =
    price.movement === 'DOWN' || price.movement === 'STRONG_DOWN';

  const oiDown =
    openInterest.movement === 'DOWN' || openInterest.movement === 'STRONG_DOWN';

  const volumeDown = volume.change < 0;

  const fundingDown = funding.change < 0;

  const liquidationCooling =
    liquidation.short <= liquidation.long || liquidation.change <= 0;

  if (priceDown && oiDown && volumeDown && fundingDown && liquidationCooling) {
    return 'NORMAL_CORRECTION';
  }

  return null;
}

/**
 * 5️⃣ ریزش با تخلیه لانگ
 *
 * Price ↓↓
 * OI ↓↓
 * Volume ↑
 * Funding ↓
 */
export function detectLongFlush(analysis: MarketAnalysis): SignalCode | null {
  const { price, openInterest, volume, funding, liquidation } = analysis;

  const priceDown = price.movement === 'STRONG_DOWN';

  const oiDown = openInterest.movement === 'STRONG_DOWN';

  const volumeUp = volume.movement === 'UP' || volume.movement === 'STRONG_UP';

  const fundingDown = funding.change < 0;

  const longLiquidationShock = liquidation.long > liquidation.short;

  if (priceDown && oiDown && volumeUp && fundingDown && longLiquidationShock) {
    return 'LONG_FLUSH';
  }

  return null;
}

/**
 * 6️⃣ هشدار برای لانگ‌ها
 *
 * Price ↓
 * OI ↑
 * Volume ↑
 * Funding ↑
 */
export function detectLongWarning(analysis: MarketAnalysis): SignalCode | null {
  const { price, openInterest, volume, funding, liquidation } = analysis;

  const priceDown =
    price.movement === 'DOWN' || price.movement === 'STRONG_DOWN';

  const oiUp =
    openInterest.movement === 'UP' || openInterest.movement === 'STRONG_UP';

  const volumeUp = volume.movement === 'UP' || volume.movement === 'STRONG_UP';

  const fundingUp = funding.change > 0;

  const longPressure = liquidation.long >= liquidation.short;

  if (priceDown && oiUp && volumeUp && fundingUp && longPressure) {
    return 'LONG_WARNING';
  }

  return null;
}

/**
 * 7️⃣ ریزش شدید / Long Squeeze
 *
 * Price ↓↓↓
 * OI ↓↓↓
 * Volume ↑↑
 *
 * فعلاً Liquidation نداریم.
 */
export function detectSevereLongSqueeze(
  analysis: MarketAnalysis,
): SignalCode | null {
  const { price, openInterest, volume, liquidation } = analysis;

  const priceDown = price.movement === 'STRONG_DOWN';

  const oiDown = openInterest.movement === 'STRONG_DOWN';

  const volumeUp = volume.movement === 'STRONG_UP';

  const liquidationShock =
    liquidation.long > liquidation.short && liquidation.change > 0;

  if (priceDown && oiDown && volumeUp && liquidationShock) {
    return 'SEVERE_LONG_SQUEEZE';
  }

  return null;
}

/**
 * 8️⃣ Short Squeeze
 *
 * Price ↑↑
 * OI ↓↓
 * Volume ↑↑
 * Funding ↓ / منفی
 */
export function detectShortSqueeze(
  analysis: MarketAnalysis,
): SignalCode | null {
  const { price, openInterest, volume, funding, liquidation } = analysis;

  const priceUp = price.movement === 'STRONG_UP';

  const oiDown = openInterest.movement === 'STRONG_DOWN';

  const volumeUp = volume.movement === 'STRONG_UP';

  const fundingDown = funding.change < 0 || funding.value < 0;

  const shortLiquidationDominance = liquidation.short > liquidation.long;

  if (
    priceUp &&
    oiDown &&
    volumeUp &&
    fundingDown &&
    shortLiquidationDominance
  ) {
    return 'SHORT_SQUEEZE';
  }

  return null;
}

/**
 * 9️⃣ Short Building
 *
 * Price ↓↓
 * OI ↑↑
 * Volume ↑
 * Funding ↓ / منفی
 */
export function detectShortBuilding(
  analysis: MarketAnalysis,
): SignalCode | null {
  const { price, openInterest, volume, funding, liquidation } = analysis;

  const priceDown = price.movement === 'STRONG_DOWN';

  const oiUp = openInterest.movement === 'STRONG_UP';

  const volumeUp = volume.movement === 'UP' || volume.movement === 'STRONG_UP';

  const fundingDown = funding.change < 0 || funding.value < 0;

  const shortLiquidationPressure = liquidation.short >= liquidation.long;

  if (
    priceDown &&
    oiUp &&
    volumeUp &&
    fundingDown &&
    shortLiquidationPressure
  ) {
    return 'SHORT_BUILDING';
  }

  return null;
}

/**
 * 🔟 پامپ با احتمال تخلیه
 *
 * Price ↑↑
 * OI ↑↑
 * Volume ↑
 * Funding ↑
 */
export function detectPumpDistributionRisk(
  analysis: MarketAnalysis,
): SignalCode | null {
  const { price, openInterest, volume, funding, liquidation } = analysis;

  const priceUp = price.movement === 'STRONG_UP';

  const oiUp = openInterest.movement === 'STRONG_UP';

  const volumeUp = volume.movement === 'UP' || volume.movement === 'STRONG_UP';

  const fundingStrongUp = funding.change > 0;

  const longCrowding =
    liquidation.long >= liquidation.short && liquidation.change > 0;

  if (priceUp && oiUp && volumeUp && fundingStrongUp && longCrowding) {
    return 'PUMP_DISTRIBUTION_RISK';
  }

  return null;
}
