import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BacktestResultEntity } from './entities/backtest-result.entity';
import { KlineService } from '../kline/kline.service';
import { BinanceService } from '../binance/binance.service';

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  pnlPercent: number;
  rMultiple: number;
  exitReason: string;
  barsHeld: number;
}

export interface BacktestSummary {
  symbol: string;
  interval: string;
  strategy: string;
  lookbackDays: number;
  barsTested: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  netReturn: number;
  buyAndHoldReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  averageRMultiple: number;
  averageHoldMs: number;
  verdict: string;
  notes: string;
  trades: BacktestTrade[];
  fees: number;
  startingEquity: number;
  endingEquity: number;
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StrategyConfig {
  name: string;
  /** Fast/slow EMA window for the trend filter. */
  fast: number;
  slow: number;
  /** ATR window used to size stops. */
  atrPeriod: number;
  /** Stop distance as a multiple of ATR. */
  atrStop: number;
  /** Take-profit distance as a multiple of ATR. */
  atrTarget: number;
  riskPerTrade: number;
  maxBarsInTrade: number;
}

const CONFIG: StrategyConfig = {
  name: 'EMA_TREND_ATR',
  fast: 21,
  slow: 55,
  atrPeriod: 14,
  atrStop: 2,
  atrTarget: 3,
  riskPerTrade: 0.01,
  maxBarsInTrade: 80,
};

/** Binance futures taker fee, charged on both entry and exit. */
const FEE_RATE = 0.0004;
/** Assumed slippage against the trader on each fill. */
const SLIPPAGE_RATE = 0.0002;

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(
    @InjectRepository(BacktestResultEntity)
    private readonly resultRepository: Repository<BacktestResultEntity>,
    private readonly klineService: KlineService,
    private readonly binanceService: BinanceService,
  ) {}

  /**
   * Exponential moving average. Seeded with an SMA of the first `period`
   * values so the series does not start biased toward the first close.
   */
  private ema(values: number[], period: number): (number | null)[] {
    if (values.length < period) return values.map(() => null);

    const multiplier = 2 / (period + 1);
    const out: (number | null)[] = new Array(values.length).fill(null);

    let seed = 0;
    for (let i = 0; i < period; i++) seed += values[i];

    let prev = seed / period;
    out[period - 1] = prev;

    for (let i = period; i < values.length; i++) {
      prev = (values[i] - prev) * multiplier + prev;
      out[i] = prev;
    }

    return out;
  }

  /**
   * Average True Range: the volatility measure that gives stops a
   * meaning tied to current market noise rather than a fixed percentage.
   */
  private atr(candles: Candle[], period: number): (number | null)[] {
    if (candles.length < period + 1) return candles.map(() => null);

    const tr: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const prevClose = candles[i - 1].close;

      tr.push(
        Math.max(
          current.high - current.low,
          Math.abs(current.high - prevClose),
          Math.abs(current.low - prevClose),
        ),
      );
    }

    const out: (number | null)[] = [null, ...tr.map(() => null)];

    // Wilder smoothing, which is the convention for ATR. The first value
    // is the simple average of the first `period` true ranges; each later
    // bar folds in its own true range, indexed from tr[j-1] because tr[0]
    // belongs to candle 1.
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];

    let prev = sum / period;
    out[period] = prev;

    for (let j = period + 1; j < candles.length; j++) {
      const trValue = tr[j - 1];
      if (trValue === undefined) break;
      prev = (prev * (period - 1) + trValue) / period;
      out[j] = prev;
    }

    return out;
  }

  private toCandles(rows: (string | number)[][]): Candle[] {
    const candles: Candle[] = [];

    for (const row of rows) {
      const open = parseFloat(String(row[1]));
      const high = parseFloat(String(row[2]));
      const low = parseFloat(String(row[3]));
      const close = parseFloat(String(row[4]));
      const volume = parseFloat(String(row[5]));

      if (
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        close <= 0 ||
        high < low
      ) {
        continue;
      }

      candles.push({
        time: Number(row[0]),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      });
    }

    return candles;
  }

  /**
   * Single-pass simulation over the candle series.
   *
   * Entries use the close of the signal bar and are filled on the open of
   * the next bar, which avoids the classic mistake of assuming a fill at a
   * price you only learn after the bar closed.
   */
  run(candles: Candle[], config: StrategyConfig = CONFIG): BacktestSummary {
    const closes = candles.map((c) => c.close);
    const fast = this.ema(closes, config.fast);
    const slow = this.ema(closes, config.slow);
    const atr = this.atr(candles, config.atrPeriod);

    const trades: BacktestTrade[] = [];

    let i = config.slow;
    let inTrade = false;
    let side: 'LONG' | 'SHORT' = 'LONG';
    let entryPrice = 0;
    let entryIndex = 0;
    let entryTime = 0;
    let stop = 0;
    let target = 0;
    let atrAtEntry = 0;

    const riskPerUnit = config.riskPerTrade;

    while (i < candles.length) {
      const fastValue = fast[i];
      const slowValue = slow[i];
      const atrValue = atr[i];

      if (inTrade) {
        const current = candles[i];

        // Stop and target are checked against the bar's extremes. When both
        // are touched in the same bar the stop wins, which is the
        // pessimistic assumption a real trader must plan for.
        let exitPrice: number | null = null;
        let exitReason = '';

        if (side === 'LONG') {
          if (current.low <= stop) {
            exitPrice = stop;
            exitReason = 'STOP_LOSS';
          } else if (current.high >= target) {
            exitPrice = target;
            exitReason = 'TAKE_PROFIT';
          }
        } else {
          if (current.high >= stop) {
            exitPrice = stop;
            exitReason = 'STOP_LOSS';
          } else if (current.low <= target) {
            exitPrice = target;
            exitReason = 'TAKE_PROFIT';
          }
        }

        const barsHeld = i - entryIndex;

        if (exitPrice === null && barsHeld >= config.maxBarsInTrade) {
          exitPrice = current.close;
          exitReason = 'TIME_EXIT';
        }

        if (exitPrice !== null) {
          trades.push(
            this.closeTrade(
              side,
              entryPrice,
              exitPrice,
              entryTime,
              current.time,
              atrAtEntry,
              exitReason,
              barsHeld,
            ),
          );

          inTrade = false;
          i++;
          continue;
        }

        i++;
        continue;
      }

      if (fastValue === null || slowValue === null || atrValue === null) {
        i++;
        continue;
      }

      const bullishCross = candles[i].close > fastValue && fastValue > slowValue;
      const bearishCross = candles[i].close < fastValue && fastValue < slowValue;

      if (bullishCross || bearishCross) {
        // Fill at the open of the following bar.
        const next = candles[i + 1];
        if (!next) break;

        const reference = fastValue > slowValue ? 1 : -1;
        const rawEntry = next.open;
        entryPrice =
          reference === 1
            ? rawEntry * (1 + SLIPPAGE_RATE)
            : rawEntry * (1 - SLIPPAGE_RATE);

        atrAtEntry = atrValue;
        entryTime = next.time;
        entryIndex = i + 1;
        side = reference === 1 ? 'LONG' : 'SHORT';

        const distance = atrAtEntry * config.atrStop;

        stop =
          side === 'LONG'
            ? entryPrice - distance
            : entryPrice + distance;

        target =
          side === 'LONG'
            ? entryPrice + atrAtEntry * config.atrTarget
            : entryPrice - atrAtEntry * config.atrTarget;

        inTrade = true;
        i++;
        continue;
      }

      i++;
    }

    return this.summarize(candles, trades, config, riskPerUnit);
  }

  private closeTrade(
    side: 'LONG' | 'SHORT',
    entryPrice: number,
    exitLevel: number,
    entryTime: number,
    exitTime: number,
    atrAtEntry: number,
    exitReason: string,
    barsHeld: number,
  ): BacktestTrade {
    const rawExit =
      exitLevel * (side === 'LONG' ? 1 - SLIPPAGE_RATE : 1 + SLIPPAGE_RATE);

    const gross =
      side === 'LONG'
        ? (rawExit - entryPrice) / entryPrice
        : (entryPrice - rawExit) / entryPrice;

    const net = gross - FEE_RATE * 2;

    // 1R is the distance from entry to stop, expressed as a fraction.
    const riskFraction =
      atrAtEntry > 0 ? (atrAtEntry * CONFIG.atrStop) / entryPrice : 0;
    const rMultiple = riskFraction > 0 ? net / riskFraction : 0;

    return {
      entryTime,
      exitTime,
      side,
      entryPrice: Number(entryPrice.toFixed(8)),
      exitPrice: Number(rawExit.toFixed(8)),
      pnlPercent: Number((net * 100).toFixed(4)),
      rMultiple: Number(rMultiple.toFixed(4)),
      exitReason,
      barsHeld,
    };
  }

  private summarize(
    candles: Candle[],
    trades: BacktestTrade[],
    config: StrategyConfig,
    riskPerTrade: number,
  ): BacktestSummary {
    const startingEquity = 10_000;
    let equity = startingEquity;
    let peak = startingEquity;
    let maxDrawdown = 0;

    const wins: BacktestTrade[] = [];
    const losses: BacktestTrade[] = [];

    const rMultiples: number[] = [];

    for (const trade of trades) {
      // Each trade risks `riskPerTrade` of equity. Position size is derived
      // from the stop distance, so a bigger stop means a smaller position
      // and the loss at the stop is constant in risk terms.
      const riskFraction = Math.max(trade.rMultiple, -1) * riskPerTrade;
      equity *= 1 + riskFraction;

      if (trade.pnlPercent > 0) wins.push(trade);
      else losses.push(trade);

      rMultiples.push(trade.rMultiple);

      if (equity > peak) peak = equity;

      const drawdown = peak > 0 ? (peak - equity) / peak : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    const grossProfit = wins.reduce((sum, t) => sum + t.pnlPercent / 100, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnlPercent / 100, 0));

    const profitFactor =
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

    const avgR =
      rMultiples.length > 0
        ? rMultiples.reduce((sum, v) => sum + v, 0) / rMultiples.length
        : 0;

    // Sharpe over per-trade returns, annualised by trade count. Reported
    // as 0 rather than NaN when there is not enough data to estimate it.
    let sharpeRatio = 0;
    if (rMultiples.length >= 3) {
      const mean = avgR;
      const variance =
        rMultiples.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
        (rMultiples.length - 1);
      const stdDev = Math.sqrt(variance);

      if (stdDev > 0) {
        const tradesPerYear = 365 / 30; // rough: one cycle per month
        sharpeRatio = (mean / stdDev) * Math.sqrt(tradesPerYear);
      }
    }

    const first = candles[0]?.close ?? 0;
    const last = candles[candles.length - 1]?.close ?? 0;
    const buyAndHoldReturn = first > 0 ? (last - first) / first : 0;

    const netReturn = (equity - startingEquity) / startingEquity;
    const winRate = trades.length > 0 ? wins.length / trades.length : 0;

    const averageHoldMs =
      trades.length > 0
        ? trades.reduce((sum, t) => sum + (t.exitTime - t.entryTime), 0) /
          trades.length
        : 0;

    const { verdict, notes } = this.judge({
      totalTrades: trades.length,
      winRate,
      profitFactor,
      netReturn,
      maxDrawdown,
      buyAndHoldReturn,
      avgR,
    });

    return {
      symbol: '',
      interval: '',
      strategy: config.name,
      lookbackDays: 0,
      barsTested: candles.length,
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: Number(winRate.toFixed(4)),
      profitFactor: Number(profitFactor.toFixed(4)),
      netReturn: Number(netReturn.toFixed(4)),
      buyAndHoldReturn: Number(buyAndHoldReturn.toFixed(4)),
      sharpeRatio: Number(sharpeRatio.toFixed(4)),
      maxDrawdown: Number(maxDrawdown.toFixed(4)),
      averageRMultiple: Number(avgR.toFixed(4)),
      averageHoldMs,
      verdict,
      notes,
      trades: trades.slice(-100),
      fees: FEE_RATE * 2,
      startingEquity,
      endingEquity: Number(equity.toFixed(2)),
    };
  }

  /**
   * Turns the statistics into a plain verdict. Minimum trade count is
   * enforced first: a 60% win rate over four trades is noise, not an edge.
   */
  private judge(stats: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    netReturn: number;
    maxDrawdown: number;
    buyAndHoldReturn: number;
    avgR: number;
  }): { verdict: string; notes: string } {
    if (stats.totalTrades < 20) {
      return {
        verdict: 'INSUFFICIENT_DATA',
        notes: `Only ${stats.totalTrades} trades were generated. Treat any result as noise and widen the date range before drawing conclusions.`,
      };
    }

    const parts: string[] = [];

    if (stats.profitFactor > 1.3 && stats.avgR > 0.15 && stats.netReturn > 0) {
      parts.push(
        `Profitable after fees: profit factor ${stats.profitFactor.toFixed(2)}, average ${stats.avgR.toFixed(2)}R per trade.`,
      );
    } else if (stats.profitFactor < 1) {
      parts.push(
        `Loses money after fees: profit factor ${stats.profitFactor.toFixed(2)}. The edge does not survive ${(FEE_RATE * 2 * 100).toFixed(2)}% round-trip costs.`,
      );
    } else {
      parts.push(
        `Marginal: profit factor ${stats.profitFactor.toFixed(2)} is too close to break-even to be meaningful.`,
      );
    }

    if (stats.winRate >= 0.5) {
      parts.push(`Win rate ${(stats.winRate * 100).toFixed(1)}%.`);
    } else if (stats.profitFactor > 1.3) {
      parts.push(
        `Win rate is only ${(stats.winRate * 100).toFixed(1)}%, so the edge comes from payoff ratio rather than accuracy.`,
      );
    }

    if (stats.maxDrawdown > 0.25) {
      parts.push(
        `Max drawdown ${(stats.maxDrawdown * 100).toFixed(1)}% is severe enough to break most position-sizing plans.`,
      );
    }

    if (stats.netReturn > stats.buyAndHoldReturn) {
      parts.push(
        `Beat buy and hold (${(stats.netReturn * 100).toFixed(1)}% vs ${(stats.buyAndHoldReturn * 100).toFixed(1)}%).`,
      );
    } else {
      parts.push(
        `Underperformed buy and hold (${(stats.netReturn * 100).toFixed(1)}% vs ${(stats.buyAndHoldReturn * 100).toFixed(1)}%).`,
      );
    }

    const passed =
      stats.profitFactor > 1.2 &&
      stats.avgR > 0.1 &&
      stats.totalTrades >= 20 &&
      stats.maxDrawdown < 0.35;

    return {
      verdict: passed ? 'VIABLE' : 'NOT_VIABLE',
      notes: parts.join(' '),
    };
  }

  async backtestSymbol(
    symbol: string,
    interval = '4h',
    lookbackDays = 180,
  ): Promise<BacktestSummary> {
    const endTime = Date.now();
    const startTime = endTime - lookbackDays * 24 * 60 * 60 * 1000;

    this.logger.log(`Backtesting ${symbol} on ${interval} for ${lookbackDays} days`);

    let rows = await this.klineService.getKlines(symbol, interval, startTime, endTime);
    let candles = this.toCandles(rows ?? []);

    // The local table usually only holds recent history, so a backtest
    // over a long window would otherwise be based on a handful of bars
    // and report INSUFFICIENT_DATA forever. Fetch what is missing once,
    // persist it, and re-read.
    if (candles.length < this.expectedCandles(interval, lookbackDays)) {
      this.logger.log(
        `${symbol} has ${candles.length} candles locally; backfilling history`,
      );

      await this.backfill(symbol, interval, startTime, endTime);

      rows = await this.klineService.getKlines(symbol, interval, startTime, endTime);
      candles = this.toCandles(rows ?? []);
    }

    if (candles.length < CONFIG.slow + 20) {
      throw new Error(
        `Not enough history for ${symbol} on ${interval}: only ${candles.length} candles available, need at least ${CONFIG.slow + 20}.`,
      );
    }

    const summary = this.run(candles);
    summary.symbol = symbol;
    summary.interval = interval;
    summary.lookbackDays = lookbackDays;

    const entity = this.resultRepository.create({
      symbol,
      interval,
      strategy: summary.strategy,
      lookbackDays,
      totalTrades: summary.totalTrades,
      winningTrades: summary.winningTrades,
      losingTrades: summary.losingTrades,
      winRate: summary.winRate,
      profitFactor: summary.profitFactor,
      netReturn: summary.netReturn,
      sharpeRatio: summary.sharpeRatio,
      maxDrawdown: summary.maxDrawdown,
      averageRMultiple: summary.averageRMultiple,
      averageHoldMs: summary.averageHoldMs,
      trades: summary.trades,
      buyAndHoldReturn: summary.buyAndHoldReturn,
      verdict: summary.verdict,
      notes: summary.notes,
    });

    const saved = await this.resultRepository.save(entity);

    this.logger.log(
      `${symbol}: ${summary.totalTrades} trades over ${summary.barsTested} candles, PF ${summary.profitFactor}, ${summary.verdict}`,
    );

    return { ...summary, id: saved.id } as BacktestSummary;
  }

  /** Approximate candle count a window should contain, with slack. */
  private expectedCandles(interval: string, lookbackDays: number): number {
    const perDay: Record<string, number> = {
      '15m': 96,
      '1h': 24,
      '4h': 6,
      '1d': 1,
    };

    const daily = perDay[interval] ?? 6;

    // Require only half the window; gaps and listing dates are normal.
    return Math.floor((lookbackDays * daily) / 2);
  }

  /**
   * Downloads and stores missing candles. Failures are logged and
   * ignored so a backtest still runs on whatever history exists.
   */
  private async backfill(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    try {
      const klines = await this.binanceService.getFuturesKlines(
        symbol,
        interval,
        startTime,
        endTime,
        1000,
      );

      if (!klines || klines.length === 0) {
        this.logger.warn(`Backfill returned no candles for ${symbol} ${interval}`);
        return;
      }

      await this.klineService.saveKlines(symbol, interval, klines);

      this.logger.log(`Backfilled ${klines.length} candles for ${symbol} ${interval}`);
    } catch (error) {
      this.logger.warn(
        `Backfill failed for ${symbol} ${interval}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async backtestMany(
    symbols: string[],
    interval = '4h',
    lookbackDays = 180,
  ) {
    const results: (BacktestSummary | { symbol: string; error: string })[] = [];

    for (const symbol of symbols) {
      try {
        results.push(await this.backtestSymbol(symbol, interval, lookbackDays));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(`Backtest failed for ${symbol}: ${message}`);
        results.push({ symbol, error: message });
      }
    }

    const completed = results.filter(
      (r): r is BacktestSummary => !('error' in r),
    );

    const valid = completed.filter((r) => r.totalTrades >= 20);

    const byProfitFactor = [...valid].sort(
      (a, b) => b.profitFactor - a.profitFactor,
    );

    return {
      results,
      leaderboard: byProfitFactor.slice(0, 10).map((r) => ({
        symbol: r.symbol,
        totalTrades: r.totalTrades,
        winRate: r.winRate,
        profitFactor: r.profitFactor,
        netReturn: r.netReturn,
        sharpeRatio: r.sharpeRatio,
        maxDrawdown: r.maxDrawdown,
        verdict: r.verdict,
      })),
      summary: {
        tested: results.length,
        passed: valid.filter((r) => r.verdict === 'VIABLE').length,
        best: byProfitFactor[0]?.symbol ?? null,
      },
    };
  }

  async getHistory(limit = 20) {
    const rows = await this.resultRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      interval: r.interval,
      totalTrades: r.totalTrades,
      winRate: parseFloat(String(r.winRate)),
      profitFactor: parseFloat(String(r.profitFactor)),
      netReturn: parseFloat(String(r.netReturn)),
      sharpeRatio: parseFloat(String(r.sharpeRatio)),
      maxDrawdown: parseFloat(String(r.maxDrawdown)),
      verdict: r.verdict,
      createdAt: r.createdAt,
    }));
  }
}