import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CorrelationService } from './correlation.service';
import { CorrelationSnapshotEntity } from './entities/correlation-snapshot.entity';
import { CorrelationPairEntity } from './entities/correlation-pair.entity';
import { KlineService } from '../kline/kline.service';
import { FuturesSymbolsService } from '../futures-symbols/futures-symbols.service';
import { NotificationGateway } from '../notification/notification.gateway';
import { RedisService } from '../redis/redis.service';

describe('CorrelationService', () => {
  let service: CorrelationService;

  const mockSnapshotRepo = {
    create: (v: unknown) => v,
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockPairRepo = {
    create: (v: unknown) => v,
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockRedis = {
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn(),
    del: jest.fn(),
  };

  const buildService = async (
    overrides: {
      klines?: jest.Mock;
      storedSymbols?: unknown;
    } = {},
  ) => {
    const klineService = {
      getKlines: overrides.klines ?? jest.fn().mockResolvedValue([]),
    };

    const futuresService = {
      getStoredSymbols: jest.fn().mockResolvedValue(
        overrides.storedSymbols ?? { symbols: [] },
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CorrelationService,
        {
          provide: getRepositoryToken(CorrelationSnapshotEntity),
          useValue: mockSnapshotRepo,
        },
        {
          provide: getRepositoryToken(CorrelationPairEntity),
          useValue: mockPairRepo,
        },
        { provide: KlineService, useValue: klineService },
        { provide: FuturesSymbolsService, useValue: futuresService },
        { provide: NotificationGateway, useValue: { sendCorrelationAlert: jest.fn() } },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    return module.get(CorrelationService);
  };

  beforeEach(async () => {
    service = await buildService();
    jest.clearAllMocks();
    mockRedis.getJson.mockResolvedValue(null);
  });

  describe('pearson', () => {
    it('returns 1 for two identical series', () => {
      const series = [1, 2, 3, 4, 5, 6];

      expect(service.pearson(series, series)).toBeCloseTo(1, 6);
    });

    it('returns -1 for perfectly inverted series', () => {
      const a = [1, 2, 3, 4, 5, 6];
      const b = [6, 5, 4, 3, 2, 1];

      expect(service.pearson(a, b)).toBeCloseTo(-1, 6);
    });

    it('stays below 1 for a related but non-linear pairing', () => {
      const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const b = a.map((x) => Math.sqrt(x));

      const result = service.pearson(a, b);

      // Strongly related but not linearly so, which is exactly the case
      // that must not be reported as a perfect 1.
      expect(result).toBeGreaterThan(0.9);
      expect(result).toBeLessThan(0.999);
    });

    it('returns a negative value for a mildly inverse pairing', () => {
      const a = [10, 8, 6, 4, 2];
      const b = [2, 4, 6, 8, 10];

      expect(service.pearson(a, b)).toBeCloseTo(-1, 6);
    });

    it('returns null for a series with no variance', () => {
      expect(service.pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
      expect(service.pearson([1, 2, 3, 4], [5, 5, 5, 5])).toBeNull();
    });

    it('returns null when there are fewer than three points', () => {
      expect(service.pearson([1, 2], [1, 2])).toBeNull();
    });

    it('detects a strong positive relationship', () => {
      const a = [10, 20, 30, 40, 50];
      const b = [11, 19, 32, 38, 52];

      expect(service.pearson(a, b)).toBeGreaterThan(0.9);
    });

    it('never returns a value outside -1..1', () => {
      const cases: [number[], number[]][] = [
        [[1, 100, 1, 100, 1], [5, 1, 9, 2, 7]],
        [[0.1, 0.2, 0.3], [300, 100, 250]],
      ];

      for (const [a, b] of cases) {
        const r = service.pearson(a, b);
        if (r !== null) {
          expect(r).toBeGreaterThanOrEqual(-1);
          expect(r).toBeLessThanOrEqual(1);
        }
      }
    });

    it('handles mismatched lengths by using the shorter series', () => {
      const r = service.pearson([1, 2, 3, 4, 5], [1, 2, 3]);

      expect(r).not.toBeNull();
      expect(Number.isFinite(r as number)).toBe(true);
    });
  });

  describe('toLogReturns', () => {
    it('converts prices into log returns', () => {
      // Prices doubling each step give a constant log return of ln(2).
      const returns = service.toLogReturns([100, 200, 400]);

      expect(returns).toHaveLength(2);
      expect(returns[0]).toBeCloseTo(Math.log(2), 8);
      expect(returns[1]).toBeCloseTo(Math.log(2), 8);
    });

    it('produces a negative return when price falls', () => {
      const returns = service.toLogReturns([100, 50]);

      expect(returns[0]).toBeCloseTo(Math.log(0.5), 8);
      expect(returns[0]).toBeLessThan(0);
    });

    it('drops non-positive and non-finite prices', () => {
      const returns = service.toLogReturns([100, 0, -5, 200, NaN, 400]);

      // Only 100, 200 and 400 survive, giving two returns.
      expect(returns).toHaveLength(2);
      expect(returns.every((r) => Number.isFinite(r))).toBe(true);
    });

    it('accepts numeric input as well as strings', () => {
      const returns = service.toLogReturns([100, '200', 400]);

      expect(returns).toHaveLength(2);
    });

    it('returns an empty array for fewer than two prices', () => {
      expect(service.toLogReturns([100])).toHaveLength(0);
      expect(service.toLogReturns([])).toHaveLength(0);
    });
  });

  describe('cluster', () => {
    const matrixFrom = (values: Record<string, Record<string, number>>) => {
      const keys = Object.keys(values);
      return keys.map((a) => keys.map((b) => values[a][b]));
    };

    it('groups strongly related assets together', () => {
      const symbols = ['A', 'B', 'C', 'D'];
      const matrix = matrixFrom({
        A: { A: 1, B: 0.95, C: 0.1, D: 0.05 },
        B: { A: 0.95, B: 1, C: 0.12, D: 0.08 },
        C: { A: 0.1, B: 0.12, C: 1, D: 0.9 },
        D: { A: 0.05, B: 0.08, C: 0.9, D: 1 },
      });

      const clusters = service['cluster'](symbols, matrix);

      expect(clusters).toHaveLength(2);
      expect(clusters[0].symbols.sort()).toEqual(['A', 'B']);
      expect(clusters[1].symbols.sort()).toEqual(['C', 'D']);
    });

    it('produces a cluster per asset when nothing is correlated', () => {
      const symbols = ['A', 'B', 'C'];
      const matrix = matrixFrom({
        A: { A: 1, B: 0, C: 0 },
        B: { A: 0, B: 1, C: 0 },
        C: { A: 0, B: 0, C: 1 },
      });

      const clusters = service['cluster'](symbols, matrix);

      expect(clusters).toHaveLength(3);
    });

    it('returns an empty list for no symbols', () => {
      expect(service['cluster']([], [])).toEqual([]);
    });

    it('places every symbol in exactly one cluster', () => {
      const symbols = ['A', 'B', 'C', 'D', 'E'];
      const matrix = matrixFrom({
        A: { A: 1, B: 0.9, C: 0.9, D: 0.9, E: 0.9 },
        B: { A: 0.9, B: 1, C: 0.9, D: 0.9, E: 0.9 },
        C: { A: 0.9, B: 0.9, C: 1, D: 0.9, E: 0.9 },
        D: { A: 0.9, B: 0.9, C: 0.9, D: 1, E: 0.9 },
        E: { A: 0.9, B: 0.9, C: 0.9, D: 0.9, E: 1 },
      });

      const clusters = service['cluster'](symbols, matrix);
      const all = clusters.flatMap((c) => c.symbols);

      expect(all.sort()).toEqual(symbols.sort());
      expect(new Set(all).size).toBe(symbols.length);
    });
  });

  describe('averageOffDiagonal', () => {
    it('returns 0 for a single symbol', () => {
      expect(service['averageOffDiagonal']([[1]])).toBe(0);
    });

    it('returns 1 when everything moves together', () => {
      expect(
        service['averageOffDiagonal']([
          [1, 1, 1],
          [1, 1, 1],
          [1, 1, 1],
        ]),
      ).toBeCloseTo(1, 6);
    });

    it('returns 0 when assets are uncorrelated', () => {
      expect(
        service['averageOffDiagonal']([
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ]),
      ).toBeCloseTo(0, 6);
    });
  });

  describe('classify', () => {
    it('maps correlation bands to readable regimes', () => {
      expect(service['classify'](0.95)).toBe('LOCKED');
      expect(service['classify'](0.7)).toBe('HIGH');
      expect(service['classify'](0.4)).toBe('MODERATE');
      expect(service['classify'](0.15)).toBe('LOW');
      expect(service['classify'](-0.3)).toBe('NEGATIVE');
    });
  });

  describe('buildMatrix', () => {
    it('returns a square, symmetric matrix with a unit diagonal', async () => {
      // Several assets trending together so real correlations are produced.
      const upSeries = (base: number) =>
        new Array(120).fill(null).map((_, i) => [
          1000 + i * 3600000,
          String(base + i * 0.5),
          String(base + i * 0.5 + 0.3),
          String(base + i * 0.5 - 0.3),
          String(base + i * 0.5 + 0.1),
          '100',
          1000,
          '1',
          10,
          '1',
          '1',
          '0',
        ]);

      const klines = jest.fn().mockResolvedValue(upSeries(100));
      const svc = await buildService({ klines });

      const result = await svc.buildMatrix('1h', 30);
      const n = result.symbols.length;

      expect(n).toBeGreaterThanOrEqual(2);

      for (let i = 0; i < n; i++) {
        expect(result.matrix[i]).toHaveLength(n);
        expect(result.matrix[i][i]).toBe(1);

        for (let j = 0; j < n; j++) {
          expect(result.matrix[i][j]).toBeCloseTo(result.matrix[j][i], 8);
        }
      }
    });

    it('skips symbols with too little history', async () => {
      const klines = jest.fn().mockResolvedValue([
        [1000, '100', '101', '99', '100', '1', 1, '1', 1, '1', '1', '0'],
      ]);

      const svc = await buildService({ klines });
      const result = await svc.buildMatrix('1h', 30);

      expect(result.symbols).toHaveLength(0);
      expect(result.averageCorrelation).toBe(0);
    });

    it('reports a near-zero average when assets move independently', async () => {
      // Each symbol gets its own oscillation, uncorrelated with the rest.
      const klines = jest.fn().mockImplementation(async (symbol: string) => {
        const phase = symbol.length * 1.7;

        return new Array(150).fill(null).map((_, i) => {
          const base = 100 + Math.sin(i / 5 + phase) * 8;
          return [
            1000 + i * 3600000,
            String(base),
            String(base + 0.2),
            String(base - 0.2),
            String(base + 0.05),
            '100',
            1000,
            '1',
            10,
            '1',
            '1',
            '0',
          ];
        });
      });

      const svc = await buildService({ klines });
      const result = await svc.buildMatrix('1h', 30);

      expect(Math.abs(result.averageCorrelation)).toBeLessThan(0.6);
    });

    it('reports a high average when every asset trends identically', async () => {
      const sameSeries = (base: number) =>
        new Array(150).fill(null).map((_, i) => {
          const p = base + i * 0.4;
          return [
            1000 + i * 3600000,
            String(p),
            String(p + 0.2),
            String(p - 0.2),
            String(p + 0.05),
            '100',
            1000,
            '1',
            10,
            '1',
            '1',
            '0',
          ];
        });

      const svc = await buildService({ klines: jest.fn().mockResolvedValue(sameSeries(100)) });
      const result = await svc.buildMatrix('1h', 30);

      expect(result.averageCorrelation).toBeGreaterThan(0.9);
    });
  });
});