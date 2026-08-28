import type { SignalResult } from './signal-result';

const SIGNAL_PRIORITY: Record<string, number> = {
  // =========================================
  // Extreme / High Risk
  // =========================================

  SEVERE_LONG_SQUEEZE: 100,

  SHORT_SQUEEZE: 95,

  LONG_FLUSH: 90,

  // =========================================
  // Strong bearish
  // =========================================

  SHORT_BUILDING: 80,

  LONG_WARNING: 75,

  // =========================================
  // Strong bullish
  // =========================================

  STRONG_BULLISH: 70,

  LONG_PUMP: 68,

  HEALTHY_BULLISH: 55,

  // =========================================
  // Normal market behavior
  // =========================================

  NORMAL_CORRECTION: 40,

  // =========================================
  // Pump distribution
  // =========================================

  PUMP_DISTRIBUTION_RISK: 65,
};

/**
 * Return priority of a signal.
 *
 * اگر Signal ناشناخته باشد،
 * اولویت پیش‌فرض 0 خواهد بود.
 */
export function getSignalPriority(signal: SignalResult): number {
  return SIGNAL_PRIORITY[signal.code] ?? 0;
}

/**
 * Sort signals from strongest
 * to weakest.
 */
export function sortSignalsByPriority(signals: SignalResult[]): SignalResult[] {
  return [...signals].sort(
    (a, b) => getSignalPriority(b) - getSignalPriority(a),
  );
}

/**
 * Get the most important signal.
 */
export function getPrimarySignal(signals: SignalResult[]): SignalResult | null {
  if (signals.length === 0) {
    return null;
  }

  const sorted = sortSignalsByPriority(signals);

  return sorted[0];
}
