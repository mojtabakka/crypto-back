import { MarketRange } from '../dto/market-range.dto';

export function getRangeMilliseconds(range: MarketRange): number {
  switch (range) {
    case '24h':
      return 24 * 60 * 60 * 1000;

    case '48h':
      return 48 * 60 * 60 * 1000;

    case '72h':
      return 72 * 60 * 60 * 1000;

    case '7d':
      return 7 * 24 * 60 * 60 * 1000;

    default:
      return 24 * 60 * 60 * 1000;
  }
}
