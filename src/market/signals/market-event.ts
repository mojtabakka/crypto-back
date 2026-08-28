import type { SignalResult } from './signal-result';

export interface MarketEvent {
  code: string;

  title: string;

  level: 'BULLISH' | 'BEARISH' | 'WARNING';

  startTime: number;
  endTime: number;

  duration: number;

  signals: SignalResult[];

  peakScore?: number;

  message: string;
}
