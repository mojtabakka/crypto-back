import { Test, TestingModule } from '@nestjs/testing';
import { MarketSignalService } from './market-signal.service';
import { ExchangeService } from 'src/exchange/exchange.service';
import { LiquidationService } from 'src/liquidation/liquidation.service';
import { RedisService } from 'src/redis/redis.service';
import type { MarketSnapshot } from 'src/market/signals/market-snapshot';

describe('MarketSignalService', () => {
  let service: MarketSignalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketSignalService,
        {
          provide: ExchangeService,
          useValue: {
            getFuturesKlines: jest.fn(),
            getOpenInterest: jest.fn(),
            getFundingRate: jest.fn(),
            getLiquidationOrders: jest.fn(),
          },
        },
        {
          provide: LiquidationService,
          useValue: {
            getLiquidations: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(undefined),
            getHealthy: jest.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    service = module.get<MarketSignalService>(MarketSignalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyze (signal detection integration)', () => {
    function createRampedSnapshots(
      startPrice: number,
      endPrice: number,
      startOI: number,
      endOI: number,
      startVolume: number,
      endVolume: number,
      startFunding: number,
      endFunding: number,
      count = 32,
    ): MarketSnapshot[] {
      const baseTime = 1786263300000;
      const snapshots: MarketSnapshot[] = [];

      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        snapshots.push({
          time: baseTime + i * 15 * 60 * 1000,
          price: startPrice + t * (endPrice - startPrice),
          volume: startVolume + t * (endVolume - startVolume),
          openInterest: startOI + t * (endOI - startOI),
          openInterestValue: 500000,
          fundingRate: startFunding + t * (endFunding - startFunding),
          longLiquidation: 0,
          shortLiquidation: 0,
        });
      }

      return snapshots;
    }

    it('should detect STRONG_BULLISH when price, OI, volume surge with positive funding', () => {
      const snapshots = createRampedSnapshots(
        100,
        140,
        5000,
        7500,
        1000,
        3000,
        0.0001,
        0.0002,
      );

      const result = service.analyze(snapshots);

      const allSignals = result.timeframes.flatMap((t) => t.signals);
      expect(allSignals.length).toBeGreaterThan(0);

      const hasStrongBullish = allSignals.some(
        (s) => s.code === 'STRONG_BULLISH',
      );
      expect(hasStrongBullish).toBe(true);
    });

    it('should detect LONG_WARNING when price drops but OI and volume surge with rising funding', () => {
      const snapshots = createRampedSnapshots(
        100,
        97,
        5000,
        8000,
        1000,
        3000,
        0.0001,
        0.0003,
      );

      const result = service.analyze(snapshots);

      const allSignals = result.timeframes.flatMap((t) => t.signals);
      const hasLongWarning = allSignals.some((s) => s.code === 'LONG_WARNING');
      expect(hasLongWarning).toBe(true);
    });

    it('should detect SHORT_SQUEEZE when price spikes up while OI collapses', () => {
      const snapshots = createRampedSnapshots(
        100,
        160,
        8000,
        3000,
        1000,
        3000,
        -0.006,
        -0.008,
      );

      const last = snapshots[snapshots.length - 1];
      last.shortLiquidation = 100;
      last.longLiquidation = 0;

      const result = service.analyze(snapshots);

      const allSignals = result.timeframes.flatMap((t) => t.signals);
      const hasShortSqueeze = allSignals.some(
        (s) => s.code === 'SHORT_SQUEEZE',
      );
      expect(hasShortSqueeze).toBe(true);
    });

    it('should detect SHORT_BUILDING when price crashes while OI surges', () => {
      const snapshots = createRampedSnapshots(
        100,
        50,
        5000,
        9000,
        1000,
        3000,
        -0.005,
        -0.008,
      );

      const result = service.analyze(snapshots);

      const allSignals = result.timeframes.flatMap((t) => t.signals);
      const hasShortBuilding = allSignals.some(
        (s) => s.code === 'SHORT_BUILDING',
      );
      expect(hasShortBuilding).toBe(true);
    });

    it('should detect HEALTHY_BULLISH when price and OI rise with stable funding', () => {
      const snapshots = createRampedSnapshots(
        100,
        110,
        5000,
        6000,
        1000,
        2000,
        0.0001,
        0.00005,
      );

      const result = service.analyze(snapshots);

      const allSignals = result.timeframes.flatMap((t) => t.signals);
      const hasHealthyBullish = allSignals.some(
        (s) => s.code === 'HEALTHY_BULLISH',
      );
      expect(hasHealthyBullish).toBe(true);
    });

    it('should include signals in each timeframe analysis', () => {
      const snapshots = createRampedSnapshots(
        100,
        140,
        5000,
        7500,
        1000,
        3000,
        0.0001,
        0.0002,
      );

      const result = service.analyze(snapshots);

      for (const tf of result.timeframes) {
        expect(tf).toHaveProperty('signals');
        expect(Array.isArray(tf.signals)).toBe(true);
      }
    });

    it('should include primarySignal in result', () => {
      const snapshots = createRampedSnapshots(
        100,
        140,
        5000,
        7500,
        1000,
        3000,
        0.0001,
        0.0002,
      );

      const result = service.analyze(snapshots);

      expect(result).toHaveProperty('primarySignal');
      expect(result).toHaveProperty('signals');
      expect(result.signals.length).toBeGreaterThan(0);
    });

    it('should throw when no snapshots provided', () => {
      expect(() => service.analyze([])).toThrow('No market snapshots provided');
    });
  });

  describe('golden rule integration', () => {
    function createRampedSnapshots(
      startPrice: number,
      endPrice: number,
      startOI: number,
      endOI: number,
      startVolume: number,
      endVolume: number,
      startFunding: number,
      endFunding: number,
      count = 32,
    ): MarketSnapshot[] {
      const baseTime = 1786263300000;
      const snapshots: MarketSnapshot[] = [];

      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        snapshots.push({
          time: baseTime + i * 15 * 60 * 1000,
          price: startPrice + t * (endPrice - startPrice),
          volume: startVolume + t * (endVolume - startVolume),
          openInterest: startOI + t * (endOI - startOI),
          openInterestValue: 500000,
          fundingRate: startFunding + t * (endFunding - startFunding),
          longLiquidation: 0,
          shortLiquidation: 0,
        });
      }

      return snapshots;
    }

    it('should apply the golden rule: Price + OI for positioning, Volume for participation, Funding for crowding', () => {
      const snapshots = createRampedSnapshots(
        100,
        120,
        5000,
        7000,
        1000,
        3000,
        0.0001,
        0.0002,
      );

      const result = service.analyze(snapshots);

      expect(result.timeframes.length).toBe(3);

      const tf4h = result.timeframes.find((t) => t.timeframe === '4h');
      expect(tf4h).toBeDefined();

      // Golden Rule: Price ↑ + OI ↑ → LONG_BUILDUP
      expect(tf4h!.positioning).toBe('LONG_BUILDUP');

      // Signals should be populated by the golden rule
      expect(tf4h!.signals.length).toBeGreaterThan(0);
    });

    it('should classify LONG_BUILDUP positioning when price and OI both rise', () => {
      const snapshots = createRampedSnapshots(
        100,
        110,
        5000,
        6000,
        1000,
        1500,
        0.0001,
        0.0001,
      );

      const result = service.analyze(snapshots);
      const tf4h = result.timeframes.find((t) => t.timeframe === '4h');
      expect(tf4h!.positioning).toBe('LONG_BUILDUP');
    });

    it('should classify LONG_UNWINDING positioning when price and OI both fall', () => {
      const snapshots = createRampedSnapshots(
        100,
        90,
        5000,
        4000,
        1000,
        1500,
        0.0001,
        0.0001,
      );

      const result = service.analyze(snapshots);
      const tf4h = result.timeframes.find((t) => t.timeframe === '4h');
      expect(tf4h!.positioning).toBe('LONG_UNWINDING');
    });

    it('should classify SHORT_BUILDUP positioning when price falls and OI rises', () => {
      const snapshots = createRampedSnapshots(
        100,
        90,
        5000,
        7000,
        1000,
        1500,
        -0.0001,
        -0.0001,
      );

      const result = service.analyze(snapshots);
      const tf4h = result.timeframes.find((t) => t.timeframe === '4h');
      expect(tf4h!.positioning).toBe('SHORT_BUILDUP');
    });

    it('should classify SHORT_COVERING positioning when price rises and OI falls', () => {
      const snapshots = createRampedSnapshots(
        100,
        110,
        5000,
        4000,
        1000,
        1500,
        0.0001,
        0.0001,
      );

      const result = service.analyze(snapshots);
      const tf4h = result.timeframes.find((t) => t.timeframe === '4h');
      expect(tf4h!.positioning).toBe('SHORT_COVERING');
    });
  });
});
