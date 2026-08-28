import type { MarketAnalysis } from './market-analysis';
import type { SignalResult } from './signal-result';
import type { MarketState } from './market-state';

export function buildMarketStates(
  analyses: MarketAnalysis[],
  signals: SignalResult[],
): MarketState[] {
  return analyses.map((analysis) => {
    // Signals مربوط به همین Analysis
    const analysisSignals = signals.filter(
      (signal) => signal.time === analysis.time,
    );

    // مهم‌ترین Signal
    //
    // چون SignalDetector قبلاً
    // بر اساس score مرتب کرده،
    // اولین Signal مهم‌ترین Signal است.
    const primarySignal =
      analysisSignals.length > 0 ? analysisSignals[0] : null;

    return {
      time: analysis.time,

      score: analysis.score.score,

      bias: analysis.bias,

      analysis,

      signals: analysisSignals,

      primarySignal,
    };
  });
}
