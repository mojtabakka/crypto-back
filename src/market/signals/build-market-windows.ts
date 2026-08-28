import type { MarketSnapshot } from './market-snapshot';

export interface MarketWindow {
  startTime: number;
  endTime: number;

  previous: MarketSnapshot;
  current: MarketSnapshot;

  snapshots: MarketSnapshot[];
}

export function buildMarketWindows(
  snapshots: MarketSnapshot[],
  size: number,
): MarketWindow[] {
  if (snapshots.length < size + 1) {
    return [];
  }

  const windows: MarketWindow[] = [];

  for (let i = size; i < snapshots.length; i++) {
    const windowSnapshots = snapshots.slice(i - size, i + 1);

    const previous = snapshots[i - size];

    const current = snapshots[i];

    windows.push({
      startTime: previous.time,

      endTime: current.time,

      previous,

      current,

      snapshots: windowSnapshots,
    });
  }

  return windows;
}
