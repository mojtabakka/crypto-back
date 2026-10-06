import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
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

const INTERVAL = '1h';

/** Timeframes tried, in order, when sizing a position with ATR. */
const ATR_INTERVALS = ['1h', '4h', '1d'];

/**
 * A full market scan touches every listed symbol and takes roughly four
 * minutes. The cache window must comfortably exceed that, otherwise every
 * request triggers another scan and the feature becomes unusable.
 */
const SCAN_CACHE_TTL = 15 * 60;

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);
  private isTickRunning = false;

  constructor(
    @InjectRepository(PositionEntity)
    private readonly positionRepository: Repository<PositionEntity>,
    @InjectRepository(ExecutorSettingsEntity)
    private readonly settingsRepository: Repository<ExecutorSettingsEntity>,
    private readonly marketScannerService: MarketScannerService,
    private readonly klineService: KlineService,
    private readonly binanceService: BinanceService,
    private readonly notificationGateway: NotificationGateway,
    private readonly redisService: RedisService,
  ) {}

  private async scanMarketCached(limit: number) {
    const key = `executor:scan:${limit}`;

    const cached = await this.redisService.getJson<any>(key);
    if (cached) return cached;

    const result = await this.marketScannerService.scanMarket(limit);

    await this.redisService.setJson(key, result, SCAN_CACHE_TTL);

    return result;
  }

  /**
   * Settings are created on first access so a new user does not have to
   * configure anything before the executor can run.
   */
  async getSettings(username: string): Promise<ExecutorSettingsEntity> {
    const existing = await this.settingsRepository.findOne({ where: { username } });

    if (existing) return existing;

    return this.settingsRepository.save(
      this.settingsRepository.create({ username }),
    );
  }

  async updateSettings(
    username: string,
    updates: Partial<ExecutorSettingsEntity>,
  ): Promise<ExecutorSettingsEntity> {
    const settings = await this.getSettings(username);

    const allowed: (keyof ExecutorSettingsEntity)[] = [
      'enabled',
      'symbols',
      'riskPerTrade',
      'leverage',
      'startingEquity',
      'atrStopMultiple',
      'atrTargetMultiple',
      'minSignalScore',
      'trailingStop',
      'breakEven',
      'maxConcurrentPositions',
    ];

    for (const key of allowed) {
      const value = updates[key];
      if (value !== undefined && value !== null) {
        (settings as any)[key] = value;
      }
    }

    return this.settingsRepository.save(settings);
  }

  private parseSymbols(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  /**
   * Average True Range from stored candles, matching the backtest
   * implementation so sizing is consistent across both features.
   *
   * The kline table is not guaranteed to hold every interval, so this
   * falls back through coarser timeframes rather than refusing to size a
   * position. A stop derived from 4h volatility is still a valid stop.
   */
  async getAtr(symbol: string, period = 14): Promise<number | null> {
    const endTime = Date.now();

    for (const interval of ATR_INTERVALS) {
      // Ask for more than needed so the smoothing has room to settle.
      const lookbackDays = interval === '1d' ? 120 : interval === '4h' ? 60 : 14;
      const startTime = endTime - lookbackDays * 24 * 60 * 60 * 1000;

      const rows = await this.klineService.getKlines(
        symbol,
        interval,
        startTime,
        endTime,
      );

      const atr = this.atrFromRows(rows ?? [], period);

      if (atr !== null) {
        this.logger.log(
          `ATR(${period}) for ${symbol} from ${interval}: ${atr.toFixed(8)}`,
        );
        return atr;
      }
    }

    this.logger.warn(`No usable candles for ${symbol} at any known interval`);

    return null;
  }

  private atrFromRows(rows: (string | number)[][], period: number): number | null {
    const highs: number[] = [];
    const lows: number[] = [];
    const closes: number[] = [];

    for (const row of rows) {
      const high = parseFloat(String(row[2]));
      const low = parseFloat(String(row[3]));
      const close = parseFloat(String(row[4]));

      if (
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        close <= 0
      ) {
        continue;
      }

      highs.push(high);
      lows.push(low);
      closes.push(close);
    }

    if (closes.length < period + 1) return null;

    const trs: number[] = [];

    for (let i = 1; i < closes.length; i++) {
      const prevClose = closes[i - 1];
      trs.push(
        Math.max(
          highs[i] - lows[i],
          Math.abs(highs[i] - prevClose),
          Math.abs(lows[i] - prevClose),
        ),
      );
    }

    let atr = 0;
    for (let i = 0; i < period; i++) atr += trs[i];
    atr = atr / period;

    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }

    return atr > 0 ? atr : null;
  }

  /**
   * Position size derived from a fixed risk budget.
   *
   * riskAmount / stopDistance gives the quantity, so every trade risks the
   * same fraction of equity regardless of the asset's volatility or price.
   */
  private calculateQuantity(
    equity: number,
    riskPerTrade: number,
    entryPrice: number,
    stopDistance: number,
  ): number {
    const riskAmount = equity * riskPerTrade;

    if (stopDistance <= 0 || entryPrice <= 0) return 0;

    return riskAmount / stopDistance;
  }

  async currentEquity(username: string): Promise<number> {
    const settings = await this.getSettings(username);

    const closed = await this.positionRepository.find({
      where: { username, status: TradeStatus.CLOSED },
    });

    const realised = closed.reduce(
      (sum, p) => sum + parseFloat(String(p.pnlUsd ?? '0')),
      0,
    );

    return parseFloat(String(settings.startingEquity)) + realised;
  }

  /**
   * Looks for new entry opportunities among the user's symbols.
   * Only signals at or above the configured score threshold qualify.
   */
  async scanForEntries(username: string) {
    const settings = await this.getSettings(username);
    const symbols = this.parseSymbols(settings.symbols);

    if (symbols.length === 0) return [];

    const candidates: {
      symbol: string;
      side: TradeSide;
      score: number;
      signal: string;
      reason: string;
    }[] = [];

    try {
      const result = await this.scanMarketCached(60);

      const wanted = new Set(symbols);

      for (const item of [...result.longs, ...result.shorts]) {
        if (!wanted.has(item.symbol)) continue;

        const score = Math.abs(item.score);

        if (score < settings.minSignalScore) continue;

        candidates.push({
          symbol: item.symbol,
          side: result.longs.includes(item) ? TradeSide.LONG : TradeSide.SHORT,
          score,
          signal: item.signal,
          reason: `${item.signal} score ${score.toFixed(0)}`,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Scanner unavailable for entries: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  async openPosition(
    username: string,
    input: {
      symbol: string;
      side: TradeSide | string;
      score: number;
      signal: string;
    },
  ): Promise<PositionEntity> {
    const settings = await this.getSettings(username);
    const symbol = input.symbol.toUpperCase();
    const side =
      String(input.side).toUpperCase() === 'SHORT' ? TradeSide.SHORT : TradeSide.LONG;

    // One position per symbol per user; the unique index enforces it too.
    const existing = await this.positionRepository.findOne({
      where: { username, symbol, status: TradeStatus.OPEN },
    });

    if (existing) {
      this.logger.log(`Skipping ${symbol}: position already open for ${username}`);
      return existing;
    }

    const openCount = await this.positionRepository.count({
      where: { username, status: TradeStatus.OPEN },
    });

    if (openCount >= settings.maxConcurrentPositions) {
      throw new BadRequestException(
        `Maximum of ${settings.maxConcurrentPositions} concurrent positions reached.`,
      );
    }

    const ticker = await this.binanceService.getTickerPrice(symbol);

    if (!ticker) {
      throw new ServiceUnavailableException(
        `Could not resolve a price for ${symbol}. Try again shortly.`,
      );
    }

    const atr = await this.getAtr(symbol);

    if (!atr) {
      throw new BadRequestException(
        `Not enough price history to size a position on ${symbol}. Wait for candle data to accumulate.`,
      );
    }

    const entryPrice = ticker.price;
    const stopDistance = atr * settings.atrStopMultiple;
    const targetDistance = atr * settings.atrTargetMultiple;

    if (stopDistance <= 0 || entryPrice <= 0) {
      throw new BadRequestException(`Invalid stop distance for ${symbol}.`);
    }

    const equity = await this.currentEquity(username);
    const quantity = this.calculateQuantity(
      equity,
      parseFloat(String(settings.riskPerTrade)),
      entryPrice,
      stopDistance,
    );

    if (quantity <= 0) {
      throw new BadRequestException(`Computed position size is zero for ${symbol}.`);
    }

    const stopLoss =
      side === TradeSide.LONG ? entryPrice - stopDistance : entryPrice + stopDistance;

    const takeProfit =
      side === TradeSide.LONG ? entryPrice + targetDistance : entryPrice - targetDistance;

    const position = this.positionRepository.create({
      username,
      symbol,
      side,
      status: TradeStatus.OPEN,
      mode: 'PAPER',
      signal: String(input.signal ?? 'MANUAL'),
      entryPrice,
      quantity,
      leverage: settings.leverage,
      stopLoss,
      takeProfit,
      originalStopLoss: stopLoss,
      breakEvenArmed: 0,
      highestFavorablePrice: 0,
      lowestFavorablePrice: 0,
      exitPrice: null,
      exitReason: null,
      pnlPercent: null,
      pnlUsd: null,
      openedAt: Date.now(),
      closedAt: null,
    });

    const saved = await this.positionRepository.save(position);

    this.notificationGateway.sendTradeExecuted({
      username,
      symbol,
      side,
      entryPrice,
      quantity,
      reason: saved.signal,
      leverage: settings.leverage,
    });

    this.logger.log(
      `Opened ${side} ${symbol} for ${username} @ ${entryPrice} qty ${quantity.toFixed(6)} stop ${stopLoss.toFixed(8)}`,
    );

    return saved;
  }

  async closePosition(
    username: string,
    positionId: number,
    exitPrice: number,
    reason: string,
  ): Promise<PositionEntity> {
    const position = await this.positionRepository.findOne({
      where: { id: positionId, username },
    });

    if (!position) throw new NotFoundException('Position not found');

    if (position.status === TradeStatus.CLOSED) return position;

    const entry = parseFloat(String(position.entryPrice));
    const quantity = parseFloat(String(position.quantity));

    const pnlPercent =
      position.side === TradeSide.LONG
        ? ((exitPrice - entry) / entry) * 100
        : ((entry - exitPrice) / entry) * 100;

    position.exitPrice = exitPrice;
    position.exitReason = reason;
    position.pnlPercent = Number(pnlPercent.toFixed(4));
    position.pnlUsd = Number((((exitPrice - entry) * quantity) * (position.side === TradeSide.LONG ? 1 : -1)).toFixed(2));
    position.status = TradeStatus.CLOSED;
    position.closedAt = Date.now();

    const saved = await this.positionRepository.save(position);

    this.notificationGateway.sendTradeClosed({
      username,
      symbol: position.symbol,
      side: position.side,
      entryPrice: entry,
      exitPrice,
      pnlPercent,
      reason,
      durationMs: (position.closedAt ?? 0) - position.openedAt,
    });

    this.logger.log(
      `Closed ${position.side} ${position.symbol} for ${username} @ ${exitPrice} (${pnlPercent.toFixed(2)}%) reason ${reason}`,
    );

    return saved;
  }

  async getPositions(username: string, status?: TradeStatus) {
    const positions = await this.positionRepository.find({
      where: status ? { username, status } : { username },
      order: { openedAt: 'DESC' },
      take: 100,
    });

    return positions.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      status: p.status,
      mode: p.mode,
      signal: p.signal,
      entryPrice: parseFloat(String(p.entryPrice)),
      quantity: parseFloat(String(p.quantity)),
      leverage: p.leverage,
      stopLoss: parseFloat(String(p.stopLoss)),
      takeProfit: parseFloat(String(p.takeProfit)),
      currentStopLoss: parseFloat(String(p.stopLoss)),
      breakEvenArmed: p.breakEvenArmed,
      exitPrice: p.exitPrice === null ? null : parseFloat(String(p.exitPrice)),
      exitReason: p.exitReason,
      pnlPercent: p.pnlPercent === null ? null : parseFloat(String(p.pnlPercent)),
      pnlUsd: p.pnlUsd === null ? null : parseFloat(String(p.pnlUsd)),
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      durationMs: p.closedAt ? p.closedAt - p.openedAt : Date.now() - p.openedAt,
    }));
  }

  /**
   * Manages exits for every open position: stop, target, trailing stop and
   * break-even. Runs on its own cadence so exits do not wait for entries.
   */
  async manageOpenPositions(): Promise<void> {
    const open = await this.positionRepository.find({
      where: { status: TradeStatus.OPEN },
    });

    if (open.length === 0) return;

    const bySymbol = new Map<string, typeof open>();
    for (const p of open) {
      const list = bySymbol.get(p.symbol) ?? [];
      list.push(p);
      bySymbol.set(p.symbol, list);
    }

    for (const [symbol, positions] of bySymbol) {
      const ticker = await this.binanceService.getTickerPrice(symbol);

      if (!ticker) {
        this.logger.warn(`No price for ${symbol}; skipping exit checks this tick`);
        continue;
      }

      const price = ticker.price;

      for (const position of positions) {
        await this.evaluateExit(position, price);
      }
    }
  }

  private async evaluateExit(position: PositionEntity, price: number) {
    const settings = await this.getSettings(position.username);

    const entry = parseFloat(String(position.entryPrice));
    const isLong = position.side === TradeSide.LONG;

    // Track excursions so trailing decisions have something to reference.
    const favorable =
      isLong ? price - entry : entry - price;

    if (isLong) {
      const current = parseFloat(String(position.highestFavorablePrice));
      position.highestFavorablePrice = Math.max(current, favorable);
    } else {
      const current = parseFloat(String(position.lowestFavorablePrice));
      position.lowestFavorablePrice = Math.min(current, favorable);
    }

    // Break-even: once the trade has cleared 1R, remove the risk.
    if (
      settings.breakEven &&
      position.breakEvenArmed === 0 &&
      parseFloat(String(position.takeProfit)) !== 0
    ) {
      const oneR = Math.abs(entry - parseFloat(String(position.originalStopLoss)));

      if (favorable >= oneR) {
        position.breakEvenArmed = 1;
        position.stopLoss = isLong
          ? entry * 1.001
          : entry * 0.999;

        this.logger.log(
          `Break-even armed on ${position.symbol} for ${position.username}`,
        );
      }
    }

    // Trailing stop: keep the stop just behind the best excursion seen.
    if (settings.trailingStop) {
      const atrStop = await this.getAtr(position.symbol);

      if (atrStop) {
        const trailDistance = atrStop * settings.atrStopMultiple;
        const best = isLong
          ? entry + parseFloat(String(position.highestFavorablePrice))
          : entry - Math.abs(parseFloat(String(position.lowestFavorablePrice)));

        const trailStop = isLong ? best - trailDistance : best + trailDistance;

        const currentStop = parseFloat(String(position.stopLoss));

        const improved = isLong
          ? trailStop > currentStop
          : trailStop < currentStop;

        // Only ratchet the stop forward, never loosen it.
        if (improved && (isLong ? best > entry : best < entry)) {
          position.stopLoss = trailStop;
        }
      }
    }

    const stop = parseFloat(String(position.stopLoss));
    const target = parseFloat(String(position.takeProfit));

    let exitPrice: number | null = null;
    let reason = '';

    if (isLong) {
      if (price <= stop) {
        exitPrice = stop;
        reason = position.breakEvenArmed === 1 ? 'BREAKEVEN_STOP' : 'STOP_LOSS';
      } else if (price >= target) {
        exitPrice = target;
        reason = 'TAKE_PROFIT';
      }
    } else {
      if (price >= stop) {
        exitPrice = stop;
        reason = position.breakEvenArmed === 1 ? 'BREAKEVEN_STOP' : 'STOP_LOSS';
      } else if (price <= target) {
        exitPrice = target;
        reason = 'TAKE_PROFIT';
      }
    }

    if (exitPrice === null) {
      // Persist the moved stop so it survives restarts.
      await this.positionRepository.save(position);
      return;
    }

    await this.closePosition(position.username, position.id, exitPrice, reason);
  }

  /**
   * Full cycle: exits first, then entries. Exits run before entries so
   * capital freed by a closed trade can be reused immediately.
   */
  async tick(username: string): Promise<{
    opened: number;
    exited: number;
    skipped: string[];
  }> {
    const settings = await this.getSettings(username);
    const result = { opened: 0, exited: 0, skipped: [] as string[] };

    if (!settings.enabled) {
      result.skipped.push('disabled');
      return result;
    }

    const closedBefore = await this.positionRepository.count({
      where: { username, status: TradeStatus.CLOSED },
    });

    await this.manageOpenPositions();

    const closedAfter = await this.positionRepository.count({
      where: { username, status: TradeStatus.CLOSED },
    });

    result.exited = closedAfter - closedBefore;

    const candidates = await this.scanForEntries(username);

    for (const candidate of candidates) {
      try {
        const existing = await this.positionRepository.findOne({
          where: {
            username,
            symbol: candidate.symbol,
            status: Not(TradeStatus.CLOSED),
          },
        });

        if (existing) {
          result.skipped.push(`${candidate.symbol}: already open`);
          continue;
        }

        await this.openPosition(username, candidate);
        result.opened++;
      } catch (error) {
        result.skipped.push(
          `${candidate.symbol}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return result;
  }

  /**
   * Runs every enabled user's tick. Guarded so a slow cycle cannot
   * overlap the next one.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledTick() {
    if (this.isTickRunning) return;

    const enabled = await this.settingsRepository.find({
      where: { enabled: true },
    });

    if (enabled.length === 0) return;

    this.isTickRunning = true;

    try {
      for (const settings of enabled) {
        const outcome = await this.tick(settings.username);

        if (outcome.opened > 0 || outcome.exited > 0) {
          this.logger.log(
            `${settings.username}: opened ${outcome.opened}, exited ${outcome.exited}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Scheduled tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isTickRunning = false;
    }
  }

  async getPerformance(username: string) {
    const closed = await this.positionRepository.find({
      where: { username, status: TradeStatus.CLOSED },
      order: { closedAt: 'ASC' },
    });

    const open = await this.positionRepository.count({
      where: { username, status: TradeStatus.OPEN },
    });

    if (closed.length === 0) {
      const equity = await this.currentEquity(username);
      return {
        username,
        mode: 'PAPER',
        startingEquity: equity,
        currentEquity: equity,
        totalTrades: 0,
        openPositions: open,
        winRate: 0,
        profitFactor: 0,
        netPnlPercent: 0,
        netPnlUsd: 0,
        averageWin: 0,
        averageLoss: 0,
        bestTrade: null,
        worstTrade: null,
        byExitReason: {} as Record<string, number>,
        bySignal: {} as Record<string, number>,
      };
    }

    const wins = closed.filter((p) => parseFloat(String(p.pnlPercent ?? '0')) > 0);
    const losses = closed.filter((p) => parseFloat(String(p.pnlPercent ?? '0')) <= 0);

    const grossProfit = wins.reduce(
      (sum, p) => sum + parseFloat(String(p.pnlUsd ?? '0')),
      0,
    );
    const grossLoss = Math.abs(
      losses.reduce((sum, p) => sum + parseFloat(String(p.pnlUsd ?? '0')), 0),
    );

    const byExitReason: Record<string, number> = {};
    const bySignal: Record<string, number> = {};

    for (const p of closed) {
      const reason = p.exitReason ?? 'UNKNOWN';
      byExitReason[reason] = (byExitReason[reason] ?? 0) + 1;

      const signal = String(p.signal ?? 'UNKNOWN').slice(0, 40);
      bySignal[signal] = (bySignal[signal] ?? 0) + 1;
    }

    const settings = await this.getSettings(username);
    const starting = parseFloat(String(settings.startingEquity));
    const equity = await this.currentEquity(username);

    const pnls = closed.map((p) => parseFloat(String(p.pnlPercent ?? '0')));
    const best = pnls.reduce((a, b) => (b > a ? b : a), -Infinity);
    const worst = pnls.reduce((a, b) => (b < a ? b : a), Infinity);

    return {
      username,
      mode: 'PAPER',
      startingEquity: starting,
      currentEquity: Number(equity.toFixed(2)),
      totalTrades: closed.length,
      openPositions: open,
      winRate: closed.length > 0 ? wins.length / closed.length : 0,
      profitFactor:
        grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0,
      netPnlUsd: Number((equity - starting).toFixed(2)),
      netPnlPercent: starting > 0 ? (equity - starting) / starting : 0,
      averageWin:
        wins.length > 0
          ? wins.reduce((s, p) => s + parseFloat(String(p.pnlPercent ?? '0')), 0) /
            wins.length
          : 0,
      averageLoss:
        losses.length > 0
          ? losses.reduce((s, p) => s + parseFloat(String(p.pnlPercent ?? '0')), 0) /
            losses.length
          : 0,
      bestTrade: closed.length > 0 ? Number(best.toFixed(4)) : null,
      worstTrade: closed.length > 0 ? Number(worst.toFixed(4)) : null,
      byExitReason,
      bySignal,
    };
  }

  async closePositionById(
    username: string,
    positionId: number,
    reason = 'MANUAL_CLOSE',
  ): Promise<PositionEntity> {
    const position = await this.positionRepository.findOne({
      where: { id: positionId, username },
    });

    if (!position) throw new NotFoundException('Position not found');

    if (position.status === TradeStatus.CLOSED) return position;

    const ticker = await this.binanceService.getTickerPrice(position.symbol);

    if (!ticker) {
      throw new ServiceUnavailableException(
        `Could not resolve a price for ${position.symbol}. Try again shortly.`,
      );
    }

    return this.closePosition(username, positionId, ticker.price, reason);
  }

  async closeAllPositions(username: string, reason = 'MANUAL_CLOSE') {
    const open = await this.positionRepository.find({
      where: { username, status: TradeStatus.OPEN },
    });

    let closed = 0;

    for (const position of open) {
      const ticker = await this.binanceService.getTickerPrice(position.symbol);

      if (!ticker) continue;

      await this.closePosition(username, position.id, ticker.price, reason);
      closed++;
    }

    return { closed };
  }
}