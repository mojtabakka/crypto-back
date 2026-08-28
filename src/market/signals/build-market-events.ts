import type { SignalResult } from './signal-result';
import type { MarketEvent } from './market-event';

export function buildMarketEvents(signals: SignalResult[]): MarketEvent[] {
  if (signals.length === 0) {
    return [];
  }

  const sortedSignals = [...signals].sort((a, b) => a.time - b.time);

  const events: MarketEvent[] = [];

  let currentSignals: SignalResult[] = [sortedSignals[0]];

  for (let i = 1; i < sortedSignals.length; i++) {
    const previous = currentSignals[currentSignals.length - 1];

    const current = sortedSignals[i];

    const sameEvent = current.code === previous.code;

    if (sameEvent) {
      currentSignals.push(current);

      continue;
    }

    events.push(createEvent(currentSignals));

    currentSignals = [current];
  }

  events.push(createEvent(currentSignals));

  return events;
}

function createEvent(signals: SignalResult[]): MarketEvent {
  const first = signals[0];

  const last = signals[signals.length - 1];

  return {
    code: first.code,

    title: first.title,

    level: first.level,

    startTime: first.time,

    endTime: last.time,

    duration: last.time - first.time,

    signals,

    message: first.message,
  };
}
