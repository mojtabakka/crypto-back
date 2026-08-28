export type SignalLevel = 'BULLISH' | 'BEARISH' | 'WARNING';

export interface SignalResult {
  time: number;

  code: string;

  title: string;

  level: SignalLevel;

  score: number;

  message: string;
}
