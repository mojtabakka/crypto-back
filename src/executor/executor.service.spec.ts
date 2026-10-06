import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExecutorService } from './executor.service';
import {
  PositionEntity,
  TradeSide,
  TradeStatus,
} from './entities/position.entity';
import { ExecutorSettingsEntity } from './entities/executor-settings.entity';
import { MarketScannerService } from '../market-scanner/market-scanner.service';
import { KlineService } from '../kline/kline.service';
import { BinanceService } from '../binance/binance.service';
import { NotificationGateway } from '../notification/notification.gateway';
import { RedisService } from '../redis/redis.service';

describe('ExecutorService', () => {
  let service: ExecutorService;

  const mockPositionRepo = {
    create: (v: unknown) => v,
    save: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };

  /** Mirrors the column defaults the real database applies on insert. */
  const withDefaults = (values: any) => ({
    enabled: false,
    mode: 'PAPER',
    symbols: 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT',
    riskPerTrade: 0.01,
    leverage: 10,
    startingEquity: 10000,
    atrStopMultiple: 2,
    atrTargetMultiple: 3,
    minSignalScore: 60,
    trailingStop: true,
    breakEven: true,
    maxConcurrentPositions: 3,
    ...values,
  });

  const mockSettingsRepo = {
    create: (v: any) => ({ id: 1, ...withDefaults(v) }),
    save: jest.fn(async (s: any) => withDefaults(s)),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
  };

  const mockScanner = { scanMarket: jest.fn() };
  const mockKline = { getKlines: jest.fn() };
  const mockBinance = { getTickerPrice: jest.fn() };
  const mockNotify = {
    sendTradeExecuted: jest.fn(),
    sendTradeClosed: jest.fn(),
  };

  const mockRedis = {
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn(),
    del: jest.fn(),
  };

  const defaultSettings = {
    username: 'admin',
    enabled: true,
    mode: 'PAPER',
    symbols: 'BTCUSDT,ETHUSDT',
    riskPerTrade: 0.01,
    leverage: 10,
    startingEquity: 10000,
    atrStopMultiple: 2,
    atrTargetMultiple: 3,
    minSignalScore: 60,
    trailingStop: false,
    breakEven: false,
    maxConcurrentPositions: 3,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutorService,
        {
          provide: getRepositoryToken(PositionEntity),
          useValue: mockPositionRepo,
        },
        {
          provide: getRepositoryToken(ExecutorSettingsEntity),
          useValue: mockSettingsRepo,
        },
        { provide: MarketScannerService, useValue: mockScanner },
        { provide: KlineService, useValue: mockKline },
        { provide: BinanceService, useValue: mockBinance },
        { provide: NotificationGateway, useValue: mockNotify },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ExecutorService);
    jest.clearAllMocks();
    mockRedis.getJson.mockResolvedValue(null);

    mockSettingsRepo.findOne.mockResolvedValue(withDefaults(defaultSettings));
    mockSettingsRepo.save.mockImplementation(async (s: any) => withDefaults(s));
    mockPositionRepo.save.mockImplementation(async (p: any) => ({ id: 1, ...p }));
    mockPositionRepo.count.mockResolvedValue(0);
    mockPositionRepo.find.mockResolvedValue([]);
    mockPositionRepo.findOne.mockResolvedValue(null);
  });

  describe('calculateQuantity', () => {
    it('sizes the position so the stop costs exactly the risk budget', () => {
      // Risk $100 with a $10 stop means 10 units.
      const qty = service['calculateQuantity'](10000, 0.01, 100, 10);

      expect(qty).toBeCloseTo(10, 6);
    });

    it('buys fewer units when the stop is wider', () => {
      const tight = service['calculateQuantity'](10000, 0.01, 100, 5);
      const wide = service['calculateQuantity'](10000, 0.01, 100, 20);

      expect(wide).toBeLessThan(tight);
      expect(wide * 20).toBeCloseTo(tight * 5, 6);
    });

    it('returns 0 for a degenerate stop distance', () => {
      expect(service['calculateQuantity'](10000, 0.01, 100, 0)).toBe(0);
      expect(service['calculateQuantity'](10000, 0.01, 0, 10)).toBe(0);
    });
  });

  describe('getAtr', () => {
    it('returns a positive value with enough candles', async () => {
      const rows = new Array(50).fill(null).map((_, i) => [
        1000 + i * 3600000,
        '100',
        '102',
        '98',
        '101',
        '10',
        2000,
        '1',
        10,
        '1',
        '1',
        '0',
      ]);

      mockKline.getKlines.mockResolvedValue(rows);

      const atr = await service.getAtr('BTCUSDT');

      expect(atr).not.toBeNull();
      expect(atr as number).toBeGreaterThan(0);
    });

    it('returns null when there is not enough history', async () => {
      mockKline.getKlines.mockResolvedValue([]);

      expect(await service.getAtr('BTCUSDT')).toBeNull();
    });
  });

  describe('openPosition', () => {
    const enoughHistory = () =>
      new Array(50).fill(null).map((_, i) => [
        1000 + i * 3600000,
        '100',
        '102',
        '98',
        '101',
        '10',
        2000,
        '1',
        10,
        '1',
        '1',
        '0',
      ]);

    it('creates a long position with a stop below entry', async () => {
      mockBinance.getTickerPrice.mockResolvedValue({ symbol: 'BTCUSDT', price: 100 });
      mockKline.getKlines.mockResolvedValue(enoughHistory());

      const position = await service.openPosition('admin', {
        symbol: 'BTCUSDT',
        side: TradeSide.LONG,
        score: 80,
        signal: 'STRONG_BULLISH',
      });

      const entry = parseFloat(String(position.entryPrice));
      const stop = parseFloat(String(position.stopLoss));
      const target = parseFloat(String(position.takeProfit));

      expect(position.side).toBe(TradeSide.LONG);
      expect(stop).toBeLessThan(entry);
      expect(target).toBeGreaterThan(entry);
      expect(position.mode).toBe('PAPER');
      expect(position.status).toBe(TradeStatus.OPEN);
    });

    it('creates a short position with a stop above entry', async () => {
      mockBinance.getTickerPrice.mockResolvedValue({ symbol: 'BTCUSDT', price: 100 });
      mockKline.getKlines.mockResolvedValue(enoughHistory());

      const position = await service.openPosition('admin', {
        symbol: 'BTCUSDT',
        side: TradeSide.SHORT,
        score: 80,
        signal: 'STRONG_BEARISH',
      });

      const entry = parseFloat(String(position.entryPrice));
      const stop = parseFloat(String(position.stopLoss));
      const target = parseFloat(String(position.takeProfit));

      expect(stop).toBeGreaterThan(entry);
      expect(target).toBeLessThan(entry);
    });

    it('places the target further from entry than the stop (3R vs 2R)', async () => {
      mockBinance.getTickerPrice.mockResolvedValue({ symbol: 'BTCUSDT', price: 100 });
      mockKline.getKlines.mockResolvedValue(enoughHistory());

      const position = await service.openPosition('admin', {
        symbol: 'BTCUSDT',
        side: TradeSide.LONG,
        score: 80,
        signal: 'X',
      });

      const entry = parseFloat(String(position.entryPrice));
      const stopDistance = entry - parseFloat(String(position.stopLoss));
      const targetDistance = parseFloat(String(position.takeProfit)) - entry;

      expect(targetDistance).toBeGreaterThan(stopDistance);
      expect(targetDistance / stopDistance).toBeCloseTo(1.5, 4);
    });

    it('does not open a second position on the same symbol', async () => {
      mockBinance.getTickerPrice.mockResolvedValue({ symbol: 'BTCUSDT', price: 100 });
      mockKline.getKlines.mockResolvedValue(enoughHistory());
      mockPositionRepo.findOne.mockResolvedValue({ id: 5, symbol: 'BTCUSDT' });

      const result = await service.openPosition('admin', {
        symbol: 'BTCUSDT',
        side: TradeSide.LONG,
        score: 80,
        signal: 'X',
      });

      expect(result.id).toBe(5);
    });

    it('refuses to exceed the concurrent position cap', async () => {
      mockBinance.getTickerPrice.mockResolvedValue({ symbol: 'BTCUSDT', price: 100 });
      mockKline.getKlines.mockResolvedValue(enoughHistory());
      mockPositionRepo.findOne.mockResolvedValue(null);
      mockPositionRepo.count.mockResolvedValue(3);

      await expect(
        service.openPosition('admin', {
          symbol: 'BTCUSDT',
          side: TradeSide.LONG,
          score: 80,
          signal: 'X',
        }),
      ).rejects.toThrow(/concurrent positions/);
    });

    it('refuses when no price can be resolved', async () => {
      mockBinance.getTickerPrice.mockResolvedValue(null);

      await expect(
        service.openPosition('admin', {
          symbol: 'BTCUSDT',
          side: TradeSide.LONG,
          score: 80,
          signal: 'X',
        }),
      ).rejects.toThrow(/Could not resolve a price/);
    });

    it('refuses when there is no history to size the stop', async () => {
      mockBinance.getTickerPrice.mockResolvedValue({ symbol: 'BTCUSDT', price: 100 });
      mockKline.getKlines.mockResolvedValue([]);

      await expect(
        service.openPosition('admin', {
          symbol: 'BTCUSDT',
          side: TradeSide.LONG,
          score: 80,
          signal: 'X',
        }),
      ).rejects.toThrow(/Not enough price history/);
    });
  });

  describe('closePosition', () => {
    const openLong = () => ({
      id: 1,
      username: 'admin',
      symbol: 'BTCUSDT',
      side: TradeSide.LONG,
      status: TradeStatus.OPEN,
      entryPrice: '100',
      quantity: '10',
      stopLoss: '98',
      takeProfit: '106',
      openedAt: 1_000,
    });

    it('computes a positive PnL for a long that gained', async () => {
      mockPositionRepo.findOne.mockResolvedValue(openLong());

      const closed = await service.closePosition('admin', 1, 104, 'TAKE_PROFIT');

      expect(closed.status).toBe(TradeStatus.CLOSED);
      expect(parseFloat(String(closed.pnlPercent))).toBeCloseTo(4, 2);
      expect(parseFloat(String(closed.pnlUsd))).toBeCloseTo(40, 2);
    });

    it('computes a negative PnL for a long that lost', async () => {
      mockPositionRepo.findOne.mockResolvedValue(openLong());

      const closed = await service.closePosition('admin', 1, 98, 'STOP_LOSS');

      expect(parseFloat(String(closed.pnlPercent))).toBeCloseTo(-2, 2);
    });

    it('inverts the calculation for shorts', async () => {
      mockPositionRepo.findOne.mockResolvedValue({
        ...openLong(),
        side: TradeSide.SHORT,
      });

      const closed = await service.closePosition('admin', 1, 96, 'TAKE_PROFIT');

      expect(parseFloat(String(closed.pnlPercent))).toBeCloseTo(4, 2);
    });

    it('is a no-op when the position is already closed', async () => {
      const alreadyClosed = { ...openLong(), status: TradeStatus.CLOSED };
      mockPositionRepo.findOne.mockResolvedValue(alreadyClosed);

      const result = await service.closePosition('admin', 1, 104, 'X');

      expect(result).toBe(alreadyClosed);
      expect(mockNotify.sendTradeClosed).not.toHaveBeenCalled();
    });

    it('throws for a position that is not the caller"s', async () => {
      mockPositionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.closePosition('navid', 1, 104, 'X'),
      ).rejects.toThrow('Position not found');
    });
  });

  describe('manageOpenPositions', () => {
    it('closes a long when the stop is hit', async () => {
      mockPositionRepo.find.mockResolvedValue([
        {
          id: 1,
          username: 'admin',
          symbol: 'BTCUSDT',
          side: TradeSide.LONG,
          status: TradeStatus.OPEN,
          entryPrice: '100',
          quantity: '10',
          stopLoss: '98',
          takeProfit: '110',
          originalStopLoss: '98',
          breakEvenArmed: 0,
          highestFavorablePrice: '0',
          lowestFavorablePrice: '0',
          openedAt: 1_000,
        },
      ]);
      mockPositionRepo.findOne.mockResolvedValueOnce({
        id: 1,
        username: 'admin',
        symbol: 'BTCUSDT',
        side: TradeSide.LONG,
        status: TradeStatus.OPEN,
        entryPrice: '100',
        quantity: '10',
        stopLoss: '98',
        takeProfit: '110',
        breakEvenArmed: 0,
        openedAt: 1_000,
      });
      mockBinance.getTickerPrice.mockResolvedValue({ symbol: 'BTCUSDT', price: 97 });
      mockKline.getKlines.mockResolvedValue([]);

      await service.manageOpenPositions();

      expect(mockNotify.sendTradeClosed).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'STOP_LOSS', exitPrice: 98 }),
      );
    });

    it('closes a long when the target is hit', async () => {
      mockPositionRepo.find.mockResolvedValue([
        {
          id: 1,
          username: 'admin',
          symbol: 'BTCUSDT',
          side: TradeSide.LONG,
          status: TradeStatus.OPEN,
          entryPrice: '100',
          quantity: '10',
          stopLoss: '98',
          takeProfit: '110',
          originalStopLoss: '98',
          breakEvenArmed: 0,
          highestFavorablePrice: '0',
          lowestFavorablePrice: '0',
          openedAt: 1_000,
        },
      ]);
      mockPositionRepo.findOne.mockResolvedValueOnce({
        id: 1,
        username: 'admin',
        symbol: 'BTCUSDT',
        side: TradeSide.LONG,
        status: TradeStatus.OPEN,
        entryPrice: '100',
        quantity: '10',
        stopLoss: '98',
        takeProfit: '110',
        breakEvenArmed: 0,
        openedAt: 1_000,
      });
      mockBinance.getTickerPrice.mockResolvedValue({ symbol: 'BTCUSDT', price: 112 });
      mockKline.getKlines.mockResolvedValue([]);

      await service.manageOpenPositions();

      expect(mockNotify.sendTradeClosed).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'TAKE_PROFIT' }),
      );
    });

    it('holds the position when price stays between stop and target', async () => {
      mockPositionRepo.find.mockResolvedValue([
        {
          id: 1,
          username: 'admin',
          symbol: 'BTCUSDT',
          side: TradeSide.LONG,
          status: TradeStatus.OPEN,
          entryPrice: '100',
          quantity: '10',
          stopLoss: '98',
          takeProfit: '110',
          originalStopLoss: '98',
          breakEvenArmed: 0,
          highestFavorablePrice: '0',
          lowestFavorablePrice: '0',
          openedAt: 1_000,
        },
      ]);
      mockBinance.getTickerPrice.mockResolvedValue({ symbol: 'BTCUSDT', price: 104 });
      mockKline.getKlines.mockResolvedValue([]);

      await service.manageOpenPositions();

      expect(mockNotify.sendTradeClosed).not.toHaveBeenCalled();
    });

    it('does nothing when there are no open positions', async () => {
      mockPositionRepo.find.mockResolvedValue([]);

      await service.manageOpenPositions();

      expect(mockBinance.getTickerPrice).not.toHaveBeenCalled();
    });

    it('keeps the position open when the price is unavailable', async () => {
      mockPositionRepo.find.mockResolvedValue([
        {
          id: 1,
          username: 'admin',
          symbol: 'BTCUSDT',
          side: TradeSide.LONG,
          status: TradeStatus.OPEN,
          stopLoss: '98',
          takeProfit: '110',
        },
      ]);
      mockBinance.getTickerPrice.mockResolvedValue(null);

      await service.manageOpenPositions();

      expect(mockNotify.sendTradeClosed).not.toHaveBeenCalled();
    });
  });

  describe('tick', () => {
    it('does nothing when the executor is disabled', async () => {
      mockSettingsRepo.findOne.mockResolvedValue({
        ...defaultSettings,
        enabled: false,
      });

      const result = await service.tick('admin');

      expect(result.opened).toBe(0);
      expect(result.skipped).toContain('disabled');
    });

    it('reports skipped symbols instead of throwing', async () => {
      mockPositionRepo.find.mockResolvedValue([]);
      mockScanner.scanMarket.mockResolvedValue({
        longs: [
          { symbol: 'BTCUSDT', score: 80, signal: 'STRONG_BULLISH' },
        ],
        shorts: [],
        allRanked: [],
        scanned: 1,
        duration: 1,
        timestamp: '',
      });
      mockPositionRepo.findOne.mockResolvedValue(null);
      mockBinance.getTickerPrice.mockResolvedValue(null);
      mockPositionRepo.count.mockResolvedValue(0);

      const result = await service.tick('admin');

      expect(result.opened).toBe(0);
      expect(result.skipped.some((s) => s.includes('BTCUSDT'))).toBe(true);
    });
  });

  describe('scanForEntries', () => {
    it('returns nothing when the scanner fails', async () => {
      mockScanner.scanMarket.mockRejectedValue(new Error('scanner down'));

      expect(await service.scanForEntries('admin')).toEqual([]);
    });

    it('ignores signals below the score threshold', async () => {
      mockScanner.scanMarket.mockResolvedValue({
        longs: [{ symbol: 'BTCUSDT', score: 20, signal: 'WEAK' }],
        shorts: [],
        allRanked: [],
        scanned: 1,
        duration: 1,
        timestamp: '',
      });

      expect(await service.scanForEntries('admin')).toEqual([]);
    });

    it('ignores symbols outside the configured list', async () => {
      mockScanner.scanMarket.mockResolvedValue({
        longs: [{ symbol: 'DOGEUSDT', score: 90, signal: 'STRONG_BULLISH' }],
        shorts: [],
        allRanked: [],
        scanned: 1,
        duration: 1,
        timestamp: '',
      });

      expect(await service.scanForEntries('admin')).toEqual([]);
    });

    it('returns qualifying signals marked as long', async () => {
      mockScanner.scanMarket.mockResolvedValue({
        longs: [{ symbol: 'BTCUSDT', score: 85, signal: 'STRONG_BULLISH' }],
        shorts: [],
        allRanked: [],
        scanned: 1,
        duration: 1,
        timestamp: '',
      });

      const result = await service.scanForEntries('admin');

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].side).toBe(TradeSide.LONG);
      expect(result[0].score).toBe(85);
    });

    it('returns qualifying signals marked as short', async () => {
      mockScanner.scanMarket.mockResolvedValue({
        longs: [],
        shorts: [{ symbol: 'ETHUSDT', score: 90, signal: 'SEVERE_LONG_SQUEEZE' }],
        allRanked: [],
        scanned: 1,
        duration: 1,
        timestamp: '',
      });

      const result = await service.scanForEntries('admin');

      expect(result[0].side).toBe(TradeSide.SHORT);
    });
  });

  describe('getPerformance', () => {
    it('returns a zeroed summary when nothing has closed', async () => {
      mockPositionRepo.find.mockResolvedValue([]);
      mockPositionRepo.count.mockResolvedValue(0);

      const result = await service.getPerformance('admin');

      expect(result.totalTrades).toBe(0);
      expect(result.currentEquity).toBe(10_000);
      expect(result.netPnlUsd).toBe(0);
    });

    it('computes win rate and profit factor from closed trades', async () => {
      mockPositionRepo.find.mockResolvedValue([
        { pnlPercent: '4', pnlUsd: '40', exitReason: 'TAKE_PROFIT', signal: 'A' },
        { pnlPercent: '2', pnlUsd: '20', exitReason: 'TAKE_PROFIT', signal: 'A' },
        { pnlPercent: '-1', pnlUsd: '-10', exitReason: 'STOP_LOSS', signal: 'B' },
      ]);

      const result = await service.getPerformance('admin');

      expect(result.totalTrades).toBe(3);
      expect(result.winRate).toBeCloseTo(2 / 3, 4);
      expect(result.profitFactor).toBeCloseTo(6, 4);
      expect(result.netPnlUsd).toBeCloseTo(50, 2);
      expect(result.byExitReason.TAKE_PROFIT).toBe(2);
      expect(result.bySignal.A).toBe(2);
    });
  });

  describe('settings', () => {
    it('creates defaults on first access', async () => {
      mockSettingsRepo.findOne.mockResolvedValue(null);

      const settings = await service.getSettings('newuser');

      expect(settings.username).toBe('newuser');
      expect(settings.mode).toBe('PAPER');
      expect(settings.enabled).toBe(false);
    });

    it('ignores fields that are not user editable', async () => {
      mockSettingsRepo.findOne.mockResolvedValue({ ...defaultSettings });

      await service.updateSettings('admin', {
        riskPerTrade: 0.02,
        username: 'hacker',
        mode: 'LIVE',
      });

      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          riskPerTrade: 0.02,
          username: 'admin',
          mode: 'PAPER',
        }),
      );
    });
  });
});