import type { MarketAnalysis } from './market-analysis';
import { SignalDetector } from './signal-detector';

function buildAnalysis(overrides: Partial<MarketAnalysis>): MarketAnalysis {
  return {
    time: Date.now(),
    price: {
      value: 100,
      change: 0,
      movement: 'NEUTRAL',
    },
    volume: {
      value: 1000,
      change: 0,
      movement: 'NEUTRAL',
    },
    openInterest: {
      value: 5000,
      change: 0,
      movement: 'NEUTRAL',
    },
    funding: {
      value: 0,
      change: 0,
    },
    liquidation: {
      long: 0,
      short: 0,
      total: 0,
      net: 0,
      change: 0,
    },
    score: {
      score: 0,
      priceScore: 0,
      openInterestScore: 0,
      volumeScore: 0,
      fundingScore: 0,
    },
    bias: {
      bias: 'NEUTRAL',
      score: 0,
      message: 'test',
    },
    ...overrides,
  };
}

describe('Signal rules', () => {
  it('detects strong bullish when price, OI, volume, and funding align', () => {
    const detector = new SignalDetector();

    const analysis = buildAnalysis({
      price: {
        value: 110,
        change: 15,
        movement: 'STRONG_UP',
      },
      openInterest: {
        value: 6000,
        change: 12,
        movement: 'STRONG_UP',
      },
      volume: {
        value: 2000,
        change: 40,
        movement: 'STRONG_UP',
      },
      funding: {
        value: 0.012,
        change: 0.004,
      },
    });

    const signals = detector.analyze(analysis);

    expect(signals.some((signal) => signal.code === 'STRONG_BULLISH')).toBe(
      true,
    );
  });

  it('detects long warning when price falls while OI and volume keep rising', () => {
    const detector = new SignalDetector();

    const analysis = buildAnalysis({
      price: {
        value: 95,
        change: -5,
        movement: 'DOWN',
      },
      openInterest: {
        value: 6200,
        change: 10,
        movement: 'UP',
      },
      volume: {
        value: 2500,
        change: 30,
        movement: 'STRONG_UP',
      },
      funding: {
        value: 0.01,
        change: 0.006,
      },
    });

    const signals = detector.analyze(analysis);

    expect(signals.some((signal) => signal.code === 'LONG_WARNING')).toBe(true);
  });

  it('detects short squeeze when price rises sharply while OI and funding collapse', () => {
    const detector = new SignalDetector();

    const analysis = buildAnalysis({
      price: {
        value: 120,
        change: 18,
        movement: 'STRONG_UP',
      },
      openInterest: {
        value: 4200,
        change: -15,
        movement: 'STRONG_DOWN',
      },
      volume: {
        value: 3000,
        change: 55,
        movement: 'STRONG_UP',
      },
      funding: {
        value: -0.006,
        change: -0.008,
      },
      liquidation: {
        long: 0,
        short: 100,
        total: 100,
        net: -100,
        change: 0,
      },
    });

    const signals = detector.analyze(analysis);

    expect(signals.some((signal) => signal.code === 'SHORT_SQUEEZE')).toBe(
      true,
    );
  });

  // ---------------------------------------------------------------
  // Priority Collapse regression tests (bug #1: rule co-firing)
  // ---------------------------------------------------------------

  it('does not co-fire LONG_FLUSH and SEVERE_LONG_SQUEEZE', () => {
    const detector = new SignalDetector();

    const analysis = buildAnalysis({
      price: {
        value: 90,
        change: -5,
        movement: 'STRONG_DOWN',
      },
      openInterest: {
        value: 4000,
        change: -10,
        movement: 'STRONG_DOWN',
      },
      volume: {
        value: 3000,
        change: 60,
        movement: 'STRONG_UP',
      },
      funding: {
        value: -0.0001,
        change: -0.0002,
      },
      liquidation: {
        long: 500,
        short: 100,
        total: 600,
        net: 400,
        change: 50,
      },
    });

    const codes = detector.analyze(analysis).map((s) => s.code);

    const hasFlush = codes.includes('LONG_FLUSH');
    const hasSevere = codes.includes('SEVERE_LONG_SQUEEZE');

    // Only the highest-scored member of the family may be emitted.
    expect(hasFlush && hasSevere).toBe(false);
    expect(hasSevere).toBe(true);
  });

  it('does not co-fire STRONG_BULLISH and HEALTHY_BULLISH', () => {
    const detector = new SignalDetector();

    const analysis = buildAnalysis({
      price: {
        value: 110,
        change: 15,
        movement: 'STRONG_UP',
      },
      openInterest: {
        value: 6000,
        change: 12,
        movement: 'STRONG_UP',
      },
      volume: {
        value: 2000,
        change: 40,
        movement: 'STRONG_UP',
      },
      funding: {
        value: 0.0001,
        change: -0.00005,
      },
      liquidation: {
        long: 100,
        short: 100,
        total: 200,
        net: 0,
        change: 0,
      },
    });

    const codes = detector.analyze(analysis).map((s) => s.code);

    const hasStrong = codes.includes('STRONG_BULLISH');
    const hasHealthy = codes.includes('HEALTHY_BULLISH');

    expect(hasStrong && hasHealthy).toBe(false);
    expect(hasStrong).toBe(true);
  });

  it('does not co-fire LONG_PUMP and PUMP_DISTRIBUTION_RISK', () => {
    const detector = new SignalDetector();

    const analysis = buildAnalysis({
      price: {
        value: 110,
        change: 15,
        movement: 'STRONG_UP',
      },
      openInterest: {
        value: 6000,
        change: 12,
        movement: 'STRONG_UP',
      },
      volume: {
        value: 2000,
        change: 60,
        movement: 'STRONG_UP',
      },
      funding: {
        value: 0.0001,
        change: 0.0002,
      },
      liquidation: {
        long: 200,
        short: 100,
        total: 300,
        net: 100,
        change: 50,
      },
    });

    const codes = detector.analyze(analysis).map((s) => s.code);

    const hasPump = codes.includes('LONG_PUMP');
    const hasDist = codes.includes('PUMP_DISTRIBUTION_RISK');

    expect(hasPump && hasDist).toBe(false);
    expect(hasPump).toBe(true);
  });
});
