import type { MarketAnalysis } from './market-analysis';
import type { SignalResult } from './signal-result';
import type { SignalCode } from './signal-code';

import {
  detectStrongBullish,
  detectHealthyBullish,
  detectLongPump,
  detectNormalCorrection,
  detectLongFlush,
  detectLongWarning,
  detectSevereLongSqueeze,
  detectShortSqueeze,
  detectShortBuilding,
  detectPumpDistributionRisk,
} from './signal-rules';

import { SIGNAL_REGISTRY } from './signal-registry';
import { Logger } from '@nestjs/common';

export class SignalDetector {
  private readonly logger = new Logger(SignalDetector.name);

  /**
   * تمام Ruleهای تشخیص Signal
   */
  private readonly rules = [
    detectStrongBullish,

    detectHealthyBullish,

    detectLongPump,

    detectNormalCorrection,

    detectLongFlush,

    detectLongWarning,

    detectSevereLongSqueeze,

    detectShortSqueeze,

    detectShortBuilding,

    detectPumpDistributionRisk,
  ];

  /**
   * خانواده‌های سیگنال که predicateهایشان به صورت ساختاری
   * روی هم overlap دارند (subset/superset). در هر خانواده فقط
   * عضو با بالاترین score emit می‌شود تا از سیگنال‌های متناقض
   * (co-firing) جلوگیری شود.
   *
   * - bullish-trend: STRONG_BULLISH (70) ⊃ HEALTHY_BULLISH (55)
   * - pump:          LONG_PUMP (68) ⊃ PUMP_DISTRIBUTION_RISK (65)
   * - flush:         SEVERE_LONG_SQUEEZE (100) ⊃ LONG_FLUSH (90)
   */
  private readonly signalFamilies: SignalCode[][] = [
    ['STRONG_BULLISH', 'HEALTHY_BULLISH'],
    ['LONG_PUMP', 'PUMP_DISTRIBUTION_RISK'],
    ['LONG_FLUSH', 'SEVERE_LONG_SQUEEZE'],
  ];

  /**
   * Analyze
   *
   * MarketAnalysis
   *      ↓
   * Signal Rules
   *      ↓
   * SignalCode
   *      ↓
   * Signal Registry
   *      ↓
   * SignalResult
   */
  analyze(analysis: MarketAnalysis): SignalResult[] {
    const codes: SignalCode[] = [];

    // =========================================
    // 1. اجرای Ruleها
    // =========================================

    for (const rule of this.rules) {
      const code = rule(analysis);

      if (code) {
        codes.push(code);
      }
    }

    // =========================================
    // 1.5. Priority Collapse (جلوگیری از co-firing)
    // =========================================
    //
    // برخی predicateها به صورت ساختاری روی هم overlap دارند
    // (subset/superset). اگر چند عضو یک خانواده همزمان fire
    // کنند، فقط عضو با بالاترین score را نگه می‌داریم تا
    // سیگنال‌های متناقض به کلاینت ارسال نشوند.

    // کدهایی که در هیچ خانوادهٔ collapse‌شده نبودند، دست‌نخورده می‌مانند.
    const finalCodes = codes.filter((code) => {
      // اگر code در یک خانواده بود و winner نبود → حذف
      for (const family of this.signalFamilies) {
        if (family.includes(code)) {
          const present = family.filter((c) => codes.includes(c));
          if (present.length > 1) {
            const winner = present.reduce((best, current) =>
              SIGNAL_REGISTRY[best].score >= SIGNAL_REGISTRY[current].score
                ? best
                : current,
            );
            return code === winner;
          }
        }
      }
      return true;
    });

    // =========================================
    // 2. تبدیل Code به SignalResult
    // =========================================

    const signals: SignalResult[] = [];

    for (const code of finalCodes) {
      const definition = SIGNAL_REGISTRY[code];

      if (!definition) {
        this.logger.warn(`Signal definition not found: ${code}`);

        continue;
      }

      signals.push({
        time: analysis.time,

        code: definition.code,

        title: definition.title,

        level: definition.level,

        score: definition.score,

        message: definition.message,
      });
    }

    // =========================================
    // 3. مرتب‌سازی بر اساس Score
    // =========================================

    signals.sort((a, b) => b.score - a.score);

    return signals;
  }

  /**
   * دریافت مهم‌ترین Signal
   */
  getPrimarySignal(analysis: MarketAnalysis): SignalResult | null {
    const signals = this.analyze(analysis);

    if (signals.length === 0) {
      return null;
    }

    return signals[0];
  }
}
