import type { SignalResult } from './signal-result';

export function aggregateSignals(signals: SignalResult[]): SignalResult[] {
  if (signals.length === 0) {
    return [];
  }

  const sortedSignals = [...signals].sort((a, b) => a.time - b.time);

  const result: SignalResult[] = [];

  let previousCode: string | null = null;

  for (const signal of sortedSignals) {
    if (signal.code === previousCode) {
      continue;
    }

    result.push(signal);

    previousCode = signal.code;
  }

  return result;
}
