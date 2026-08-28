import { Movement } from './signal.types';

export function getMovement(
  change: number,
  upThreshold: number,
  strongUpThreshold: number,
  downThreshold: number,
  strongDownThreshold: number,
): Movement {
  if (change >= strongUpThreshold) {
    return 'STRONG_UP';
  }

  if (change >= upThreshold) {
    return 'UP';
  }

  if (change <= strongDownThreshold) {
    return 'STRONG_DOWN';
  }

  if (change <= downThreshold) {
    return 'DOWN';
  }

  return 'NEUTRAL';
}
