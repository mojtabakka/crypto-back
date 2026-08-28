import {
  MultiTimeframeAnalysis,
  Signal,
  TimeframeAnalysis,
} from './market-signal.types';

import { getPrimarySignal } from './signal-priority';
import type { SignalResult } from './signal-result';

export class MultiTimeframeAnalyzer {
  // ==========================================
  // Timeframe Weights
  // ==========================================

  private readonly weights = {
    '15m': 0.2,
    '1h': 0.3,
    '4h': 0.5,
  } as const;

  // ==========================================
  // Main Analysis
  // ==========================================

  analyze(analyses: TimeframeAnalysis[]): MultiTimeframeAnalysis {
    if (!analyses.length) {
      return {
        timeframes: [],
        finalScore: 0,
        finalSignal: 'NEUTRAL',
        confidence: 0,
        signals: [],
        primarySignal: null,
      };
    }

    // ==========================================
    // Calculate Weighted Score
    // ==========================================

    let finalScore = 0;

    for (const analysis of analyses) {
      const weight = this.weights[analysis.timeframe];

      if (weight === undefined) {
        continue;
      }

      finalScore += analysis.score * weight;
    }

    // ==========================================
    // Final Signal
    // ==========================================

    const finalSignal = this.getSignal(finalScore);

    // ==========================================
    // Confidence
    // ==========================================

    const confidence = this.calculateConfidence(analyses, finalSignal);

    // ==========================================
    // Aggregate Signals
    // ==========================================

    const allSignals: SignalResult[] = [];

    for (const analysis of analyses) {
      allSignals.push(...analysis.signals);
    }

    const primarySignal = getPrimarySignal(allSignals);

    return {
      timeframes: analyses,

      finalScore: Number(finalScore.toFixed(2)),

      finalSignal,

      confidence,

      signals: allSignals,

      primarySignal,
    };
  }

  // ==========================================
  // Signal
  // ==========================================

  private getSignal(score: number): Signal {
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

  // ==========================================
  // Confidence
  // ==========================================

  private calculateConfidence(
    analyses: TimeframeAnalysis[],
    finalSignal: Signal,
  ): number {
    // ------------------------------------------
    // Neutral
    // ------------------------------------------

    if (finalSignal === 'NEUTRAL') {
      return 0;
    }

    // ------------------------------------------
    // Determine direction
    // ------------------------------------------

    const direction = finalSignal.includes('LONG') ? 1 : -1;

    // ------------------------------------------
    // Weighted Alignment
    // ------------------------------------------

    let alignedWeight = 0;
    let totalWeight = 0;

    for (const analysis of analyses) {
      const weight = this.weights[analysis.timeframe];

      if (weight === undefined) {
        continue;
      }

      totalWeight += weight;

      const isAligned =
        direction === 1 ? analysis.score > 0 : analysis.score < 0;

      if (isAligned) {
        alignedWeight += weight;
      }
    }

    if (totalWeight === 0) {
      return 0;
    }

    return Number(((alignedWeight / totalWeight) * 100).toFixed(2));
  }
}
