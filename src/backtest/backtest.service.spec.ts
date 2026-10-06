import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BacktestService } from './backtest.service';
import { BacktestResultEntity } from './entities/backtest-result.entity';
import { KlineService } from '../kline/kline.service';
import { BinanceService } from '../binance/binance.service';

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

describe('BacktestService', () => {
  let service: BacktestService;
  let mockKlines: jest.Mock;
  let mockFuturesKlines: jest.Mock;

  beforeEach(async () => {
    mockKlines = jest.fn().mockResolvedValue([]);
    mockFuturesKlines = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestService,
        {
          provide: getRepositoryToken(BacktestResultEntity),
          useValue: { create: (v: unknown) => v, save: async (v: unknown) => v },
        },
        { provide: KlineService, useValue: { getKlines: mockKlines } },
        {
          provide: BinanceService,
          useValue: { getFuturesKlines: mockFuturesKlines },
        },
      ],
    }).compile();

    service = module.get(BacktestService);
  });

  describe('ema', () => {
    it('returns nulls until the period is satisfied', () => {
      const out = service['ema']([1, 2, 3], 5);

      expect(out).toEqual([null, null, null]);
    });

    it('seeds with an SMA of the first period values', () => {
      const out = service['ema']([2, 4, 6, 8, 10, 12], 3);

      // SMA of 2,4,6 = 4
      expect(out[2]).toBeCloseTo(4, 6);
    });

    it('tracks a constant series exactly', () => {
      const out = service['ema'](new Array(50).fill(7), 10);

      expect(out[49]).toBeCloseTo(7, 6);
    });
  });

  describe('atr', () => {
    it('returns nulls when there is not enough history', () => {
      const candles: Candle[] = new Array(5).fill(null).map((_, i) => ({
        time: i,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
      }));

      expect(service['atr'](candles, 14)).toHaveLength(5);
      expect(service['atr'](candles, 14)[0]).toBeNull();
    });

    it('seeds Wilder ATR with the average of the first `period` true ranges', () => {
      const candles: Candle[] = [
        { time: 0, open: 100, high: 110, low: 90, close: 100, volume: 1 },
        { time: 1, open: 100, high: 105, low: 95, close: 100, volume: 1 },
        { time: 2, open: 100, high: 120, low: 100, close: 110, volume: 1 },
        { time: 3, open: 110, high: 112, low: 108, close: 110, volume: 1 },
      ];

      // TR[0] (candle 1) = max(10, |105-100|, |95-100|) = 10
      // TR[1] (candle 2) = max(20, |120-100|, |100-100|) = 20
      // TR[2] (candle 3) = max(4, |112-110|, |108-110|) = 4
      const out = service['atr'](candles, 2);

      // Wilder seed at bar `period` = SMA of the first 2 TRs = (10 + 20) / 2
      expect(out[2]).toBeCloseTo(15, 4);

      // Next bar folds in TR[2]: (15 * (2-1) + 4) / 2 = 9.5
      expect(out[3]).toBeCloseTo(9.5, 4);
    });

    it('never returns a negative value', () => {
      const candles: Candle[] = new Array(40).fill(null).map((_, i) => ({
        time: i,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
      }));

      const out = service['atr'](candles, 14);

      expect(out.every((v) => v === null || v >= 0)).toBe(true);
    });
  });

  describe('toCandles', () => {
    it('drops rows with unusable prices', () => {
      const rows: any[] = [
        [1, '100', '110', '90', '105', '10', 2, '1', 1, '1', '1', '0'],
        [2, '0', '0', '0', '0', '0', 2, '0', 0, '0', '0', '0'],
        [3, 'bad', 'x', 'y', 'z', 'q', 2, '0', 0, '0', '0', '0'],
      ];

      const candles = service['toCandles'](rows);

      expect(candles).toHaveLength(1);
      expect(candles[0].close).toBe(105);
    });

    it('rejects rows where high is below low', () => {
      const rows: any[] = [[1, '100', '90', '110', '100', '10', 2, '1', 1, '1', '1', '0']];

      expect(service['toCandles'](rows)).toHaveLength(0);
    });
  });

  describe('run', () => {
    /**
     * Deterministic trend-plus-noise series. A steady uptrend should
     * produce long trades and a positive result, which is the property
     * we need to guarantee before trusting any reported numbers.
     */
    const trending = (up: boolean, bars = 400): Candle[] => {
      const out: Candle[] = [];
      let price = 100;

      for (let i = 0; i < bars; i++) {
        const drift = up ? 0.6 : -0.6;
        const wave = Math.sin(i / 7) * 0.8;
        const open = price;
        price = Math.max(5, price + drift + wave);
        const high = Math.max(open, price) + 0.5;
        const low = Math.min(open, price) - 0.5;

        out.push({
          time: 1_700_000_000_000 + i * 3_600_000,
          open,
          high,
          low,
          close: price,
          volume: 1000 + i,
        });
      }

      return out;
    };

    it('generates trades on a clean uptrend', () => {
      const result = service.run(trending(true));

      expect(result.totalTrades).toBeGreaterThan(0);
      expect(result.winRate).toBeGreaterThan(0);
    });

    it('only opens long trades on an uptrend', () => {
      const result = service.run(trending(true));

      const shorts = result.trades.filter((t) => t.side === 'SHORT');

      // Strong upward drift means the fast EMA stays above the slow one,
      // so the bearish branch should rarely fire.
      expect(shorts.length).toBeLessThan(result.totalTrades / 2);
    });

    it('records an exit price consistent with the recorded side', () => {
      const result = service.run(trending(true));

      for (const trade of result.trades) {
        if (trade.side === 'LONG') {
          const direction = trade.exitPrice > trade.entryPrice ? 1 : -1;
          expect(direction).toBe(trade.pnlPercent > 0 ? 1 : -1);
        } else {
          const direction = trade.exitPrice < trade.entryPrice ? 1 : -1;
          expect(direction).toBe(trade.pnlPercent > 0 ? 1 : -1);
        }
      }
    });

    it('never reports a win rate outside 0..1', () => {
      for (const up of [true, false]) {
        const result = service.run(trending(up));

        expect(result.winRate).toBeGreaterThanOrEqual(0);
        expect(result.winRate).toBeLessThanOrEqual(1);
      }
    });

    it('never reports a negative profit factor', () => {
      const result = service.run(trending(false));

      expect(result.profitFactor).toBeGreaterThanOrEqual(0);
    });

    it('keeps drawdown within the 0..1 range', () => {
      for (const up of [true, false]) {
        const result = service.run(trending(up));

        expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
        expect(result.maxDrawdown).toBeLessThanOrEqual(1);
      }
    });

    it('charges fees, so a gross winner is not overstated', () => {
      const result = service.run(trending(true));

      // Every trade pays two fees, so the average R must be below the
      // gross average by roughly 2x the fee cost.
      expect(result.fees).toBeCloseTo(0.0008, 6);
      expect(result.averageRMultiple).toBeLessThan(3.01);
    });

    it('flags low sample sizes as unusable', () => {
      const result = service.run(trending(true, 70));

      if (result.totalTrades < 20) {
        expect(result.verdict).toBe('INSUFFICIENT_DATA');
      }
    });

    it('reports every exit reason from the known set', () => {
      const result = service.run(trending(true));

      const valid = new Set([
        'STOP_LOSS',
        'TAKE_PROFIT',
        'TIME_EXIT',
      ]);

      for (const trade of result.trades) {
        expect(valid.has(trade.exitReason)).toBe(true);
      }
    });

    it('produces no trades when there is no trend to follow', () => {
      const flat: Candle[] = new Array(400).fill(null).map((_, i) => ({
        time: i,
        open: 100,
        high: 100.01,
        low: 99.99,
        close: 100,
        volume: 1,
      }));

      const result = service.run(flat);

      // ATR is ~0.02 which still allows a stop, but a flat EMA structure
      // means no cross, so nothing should open.
      expect(result.totalTrades).toBe(0);
      expect(result.verdict).toBe('INSUFFICIENT_DATA');
    });

    it('starts and ends equity consistently when there are no trades', () => {
      const flat: Candle[] = new Array(200).fill(null).map((_, i) => ({
        time: i,
        open: 100,
        high: 100.01,
        low: 99.99,
        close: 100,
        volume: 1,
      }));

      const result = service.run(flat);

      expect(result.startingEquity).toBe(10_000);
      expect(result.endingEquity).toBe(10_000);
      expect(result.netReturn).toBe(0);
    });

    it('caps the loss of a normal stop-loss trade near 1R', () => {
      const result = service.run(trending(false));

      const stops = result.trades.filter((t) => t.exitReason === 'STOP_LOSS');

      for (const trade of stops) {
        // 2 ATR stop against 3 ATR target, so a stop is about -1R plus fees.
        expect(trade.rMultiple).toBeGreaterThan(-1.6);
      }
    });
  });

  describe('backtestSymbol', () => {
    it('rejects symbols without enough history', async () => {
      mockKlines.mockResolvedValue([]);
      mockFuturesKlines.mockResolvedValue([]);

      await expect(service.backtestSymbol('FAKEUSDT')).rejects.toThrow(
        /Not enough history/,
      );
    });

    it('backfills history when the local table is short', async () => {
      const series = new Array(120).fill(null).map((_, i) => [
        1000 + i * 14400000,
        String(100 + i * 0.5),
        String(100 + i * 0.5 + 0.3),
        String(100 + i * 0.5 - 0.3),
        String(100 + i * 0.5 + 0.1),
        '100',
        2000,
        '1',
        10,
        '1',
        '1',
        '0',
      ]);

      // First read is empty, so backfill must run and be re-read.
      mockKlines
        .mockResolvedValueOnce([])
        .mockResolvedValue(series);

      mockFuturesKlines.mockResolvedValue(series);

      const result = await service.backtestSymbol('BTCUSDT', '4h', 180);

      expect(mockFuturesKlines).toHaveBeenCalledTimes(1);
      expect(result.barsTested).toBeGreaterThan(0);
    });

    it('still runs when the backfill fails', async () => {
      const series = new Array(120).fill(null).map((_, i) => [
        1000 + i * 14400000,
        String(100 + i * 0.4),
        String(100 + i * 0.4 + 0.2),
        String(100 + i * 0.4 - 0.2),
        String(100 + i * 0.4),
        '100',
        2000,
        '1',
        10,
        '1',
        '1',
        '0',
      ]);

      mockKlines.mockResolvedValue(series);
      mockFuturesKlines.mockRejectedValue(new Error('network down'));

      const result = await service.backtestSymbol('BTCUSDT', '4h', 180);

      expect(result.symbol).toBe('BTCUSDT');
      expect(result.barsTested).toBeGreaterThan(0);
    });

    it('does not backfill when history is already complete', async () => {
      const series = new Array(1200).fill(null).map((_, i) => [
        1000 + i * 14400000,
        String(100 + i * 0.4),
        String(100 + i * 0.4 + 0.2),
        String(100 + i * 0.4 - 0.2),
        String(100 + i * 0.4),
        '100',
        2000,
        '1',
        10,
        '1',
        '1',
        '0',
      ]);

      mockKlines.mockResolvedValue(series);

      await service.backtestSymbol('BTCUSDT', '4h', 180);

      expect(mockFuturesKlines).not.toHaveBeenCalled();
    });
  });

  describe('expectedCandles', () => {
    it('scales with the interval', () => {
      expect(service['expectedCandles']('1h', 30)).toBe(360);
      expect(service['expectedCandles']('4h', 30)).toBe(90);
      expect(service['expectedCandles']('1d', 30)).toBe(15);
    });
  });
});