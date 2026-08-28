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
    // 2. تبدیل Code به SignalResult
    // =========================================

    const signals: SignalResult[] = [];

    for (const code of codes) {
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
