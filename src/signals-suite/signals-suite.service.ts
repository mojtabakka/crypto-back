import { Injectable, Logger } from '@nestjs/common';
import { MarketDataService, Candle } from 'src/analytics/market-data.service';
import { LiquidationService } from 'src/liquidation/liquidation.service';
import { NotificationGateway } from 'src/notification/notification.gateway';

export type Direction = 'PUMP' | 'DUMP';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export interface MoverAlert {
  id: number;
  symbol: string;
  exchange: string;
  severity: Severity;
  priceChange1h: number;
  priceChange4h: number;
  priceChange24h: number;
  volumeChange1h: number;
  volumeChange24h: number;
  pumpScore: number;
  dumpScore: number;
  currentPrice: number;
  detectedAt: number;
  reasons: string;
  createdAt: string;
}

export interface PreMoveSignal {
  id: number;
  symbol: string;
  type: Direction;
  strength: 'WEAK' | 'MODERATE' | 'STRONG' | 'EXTREME';
  confidence: number;
  currentPrice: number | null;
  longLiqValue: number;
  shortLiqValue: number;
  longLiqCount: number;
  shortLiqCount: number;
  imbalanceRatio: number;
  windowMs: number;
  detectedAt: number;
  reasons: string;
  createdAt: string;
}

export interface SafeSellSignal {
  id: number;
  symbol: string;
  exchange: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  severity: Severity;
  priceChange1h: number;
  priceChange4h: number;
  volumeChange1h: number;
  oiChange1h: number;
  fundingRate: number;
  longLiquidationChange: number;
  shortLiquidationChange: number;
  safeSellScore: number;
  currentPrice: number;
  detectedAt: number;
  reasons: string;
  createdAt: string;
}

export interface PressureSignal {
  symbol: string;
  signal:
    | 'BUYING_PRESSURE'
    | 'SELLING_PRESSURE'
    | 'SHORT_SQUEEZE'
    | 'LONG_OVERLOADED';
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  reason: string;
  price: number;
  priceChange1h: number;
  priceChange24h: number;
  oiChange1h: number;
  oiChange24h: number;
  volume1h: number;
  volume24h: number;
  fundingRate: number | null;
  score: number;
}

export interface CoinGlassSymbolData {
  symbol: string;
  price: number;
  marketCap: number;
  openInterest: number;
  fundingRate: number;
  volume24h: number;
  liquidation24h: number;
  priceChange1h: number;
  priceChange24h: number;
  rsi1h: number | null;
  rsi4h: number | null;
  rsi1d: number | null;
}

export interface CoinGlassSignal {
  symbol: string;
  signal:
    | 'HEALTHY_BULLISH'
    | 'STRONG_BULLISH'
    | 'LONG_PUMP'
    | 'NORMAL_CORRECTION'
    | 'LONG_FLUSH'
    | 'NEUTRAL';
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  score: number;
  data: CoinGlassSymbolData;
  reason: string;
}

interface Timed<T> {
  at: number;
  data: T;
}

interface CoinGlassScanResult {
  longs: CoinGlassSignal[];
  shorts: CoinGlassSignal[];
  neutral: CoinGlassSignal[];
  totalScanned: number;
  fearGreedIndex: number | null;
  altcoinSeasonIndex: number | null;
  timestamp: string;
}

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));

const pct = (current: number, previous: number): number =>
  previous === 0 ? 0 : ((current - previous) / previous) * 100;

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const sum = (values: number[]): number =>
  values.reduce((a, b) => a + b, 0);

function severityFor(score: number): Severity {
  if (score >= 80) return 'EXTREME';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

function strengthFor(confidence: number): PreMoveSignal['strength'] {
  if (confidence >= 85) return 'EXTREME';
  if (confidence >= 70) return 'STRONG';
  if (confidence >= 55) return 'MODERATE';
  return 'WEAK';
}

/** Relative strength index over a close series. */
function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

/** Aggregate 1h candles into a higher timeframe (4h = 4, 1d = 24). */
function resample(candles: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];

  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;

    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: sum(chunk.map((c) => c.volume)),
      quoteVolume: sum(chunk.map((c) => c.quoteVolume)),
      trades: sum(chunk.map((c) => c.trades)),
      takerBuyBase: sum(chunk.map((c) => c.takerBuyBase)),
      takerBuyQuote: sum(chunk.map((c) => c.takerBuyQuote)),
    });
  }

  return out;
}

/**
 * Market "detector" suite: pump/dump, pre-move, post-pump safe-sell,
 * volume pressure and CoinGlass-style positioning signals.
 *
 * All of it runs on the shared MarketDataService cache, so opening four pages
 * in a row does not quadruple the Binance traffic.
 */
@Injectable()
export class SignalsSuiteService {
  private readonly logger = new Logger(SignalsSuiteService.name);

  private readonly movers = new Map<Direction, Timed<MoverAlert[]>>();
  private preMove?: Timed<PreMoveSignal[]>;
  private safeSell?: Timed<SafeSellSignal[]>;
  private pressure?: Timed<PressureSignal[]>;
  private coinGlass?: Timed<CoinGlassScanResult>;

  private readonly UNIVERSE = 180;
  private readonly MOVER_TTL = 60_000;
  private readonly PRE_MOVE_TTL = 30_000;
  private readonly SAFE_SELL_TTL = 5 * 60_000;
  private readonly PRESSURE_TTL = 2 * 60_000;
  private readonly COINGLASS_TTL = 3 * 60_000;

  constructor(
    private readonly marketData: MarketDataService,
    private readonly liquidationService: LiquidationService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  // ==================================================================
  // Pump / Dump
  // ==================================================================

  async scanMovers(direction: Direction, minScore = 25): Promise<MoverAlert[]> {
    const cached = this.movers.get(direction);
    if (cached && Date.now() - cached.at < this.MOVER_TTL) {
      return cached.data.filter((a) => this.scoreOf(a, direction) >= minScore);
    }

    const symbols = await this.marketData.getSymbols(this.UNIVERSE);
    const tickerMap = await this.marketData.getTickerMap();

    const analysed = await this.marketData.mapLimit(symbols, 6, (symbol) =>
      this.analyseMover(symbol, direction, tickerMap.get(symbol)?.priceChangePercent ?? 0),
    );

    const alerts = analysed
      .filter((a): a is MoverAlert => a !== null)
      .sort((a, b) => this.scoreOf(b, direction) - this.scoreOf(a, direction))
      .slice(0, 60)
      .map((alert, index) => ({ ...alert, id: index + 1 }));

    this.movers.set(direction, { at: Date.now(), data: alerts });

    this.logger.log(
      `${direction.toLowerCase()} scan: ${alerts.length} alerts across ${symbols.length} symbols`,
    );

    if (direction === 'PUMP') {
      for (const alert of alerts.slice(0, 5)) {
        this.notificationGateway.sendPumpAlert?.({
          symbol: alert.symbol,
          score: alert.pumpScore,
          severity: alert.severity,
        });
      }
    }

    return alerts.filter((a) => this.scoreOf(a, direction) >= minScore);
  }

  getMovers(direction: Direction, minScore = 25): MoverAlert[] {
    const cached = this.movers.get(direction);
    if (!cached) return [];
    return cached.data.filter((a) => this.scoreOf(a, direction) >= minScore);
  }

  private scoreOf(alert: MoverAlert, direction: Direction): number {
    return direction === 'PUMP' ? alert.pumpScore : alert.dumpScore;
  }

  private async analyseMover(
    symbol: string,
    direction: Direction,
    priceChange24h: number,
  ): Promise<MoverAlert | null> {
    let candles: Candle[];
    try {
      candles = await this.marketData.getCandles(symbol, '1h', 50);
    } catch {
      return null;
    }

    if (candles.length < 30) return null;

    const last = candles[candles.length - 1];
    const close = (offset: number) =>
      candles[candles.length - 1 - offset]?.close ?? last.close;

    const priceChange1h = pct(last.close, close(1));
    const priceChange4h = pct(last.close, close(4));

    const last24 = candles.slice(-24);
    const previous24 = candles.slice(-48, -24);

    const avgHourlyVolume = mean(
      candles.slice(-25, -1).map((c) => c.quoteVolume),
    );
    const volumeChange1h =
      avgHourlyVolume > 0
        ? pct(last.quoteVolume, avgHourlyVolume)
        : 0;

    const volume24hNow = sum(last24.map((c) => c.quoteVolume));
    const volume24hBefore = sum(previous24.map((c) => c.quoteVolume));
    const volumeChange24h =
      volume24hBefore > 0 ? pct(volume24hNow, volume24hBefore) : 0;

    // Direction gate: a pump needs a positive 1h impulse, a dump a negative one.
    if (direction === 'PUMP' && priceChange1h < 0.4) return null;
    if (direction === 'DUMP' && priceChange1h > -0.4) return null;

    const signedPrice = (value: number) =>
      direction === 'PUMP' ? value : -value;
    const signedVolume =
      direction === 'PUMP'
        ? Math.max(0, Math.min(volumeChange1h, 500))
        : Math.max(0, Math.min(-volumeChange1h, 500));

    const score = clamp(
      signedPrice(priceChange1h) * 2.2 +
        signedPrice(priceChange4h) * 0.9 +
        signedPrice(priceChange24h) * 0.15 +
        signedVolume * 0.05,
    );

    const reasons: string[] = [
      `1h ${priceChange1h >= 0 ? '+' : ''}${priceChange1h.toFixed(2)}%`,
      `4h ${priceChange4h >= 0 ? '+' : ''}${priceChange4h.toFixed(2)}%`,
      `24h ${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%`,
    ];

    if (Math.abs(volumeChange1h) >= 50) {
      reasons.push(
        `volume ${(last.quoteVolume / Math.max(avgHourlyVolume, 1)).toFixed(1)}x hourly average`,
      );
    }
    if (Math.abs(volumeChange24h) >= 30) {
      reasons.push(
        `24h volume ${volumeChange24h >= 0 ? '+' : ''}${volumeChange24h.toFixed(0)}%`,
      );
    }

    const alert: MoverAlert = {
      id: 0,
      symbol,
      exchange: 'BINANCE',
      severity: severityFor(score),
      priceChange1h,
      priceChange4h,
      priceChange24h,
      volumeChange1h,
      volumeChange24h,
      pumpScore: direction === 'PUMP' ? score : 0,
      dumpScore: direction === 'DUMP' ? score : 0,
      currentPrice: last.close,
      detectedAt: Date.now(),
      reasons: JSON.stringify(reasons),
      createdAt: new Date().toISOString(),
    };

    return alert;
  }

  // ==================================================================
  // Pre-move (one-sided liquidations)
  // ==================================================================

  async scanPreMove(): Promise<PreMoveSignal[]> {
    if (this.preMove && Date.now() - this.preMove.at < this.PRE_MOVE_TTL) {
      return this.preMove.data;
    }

    const windowMs = 30 * 60 * 1000;
    const recent = this.liquidationService.getRecentLiquidations(windowMs);

    const bySymbol = new Map<
      string,
      { long: number; short: number; longCount: number; shortCount: number }
    >();

    for (const item of recent) {
      const bucket = bySymbol.get(item.symbol) ?? {
        long: 0,
        short: 0,
        longCount: 0,
        shortCount: 0,
      };

      if (item.side === 'LONG') {
        bucket.long += item.value;
        bucket.longCount += 1;
      } else {
        bucket.short += item.value;
        bucket.shortCount += 1;
      }

      bySymbol.set(item.symbol, bucket);
    }

    const signals: PreMoveSignal[] = [];

    for (const [symbol, bucket] of bySymbol.entries()) {
      const total = bucket.long + bucket.short;
      if (total < 20_000) continue;

      const imbalance =
        bucket.short > bucket.long
          ? bucket.short / Math.max(bucket.long, 1)
          : bucket.long / Math.max(bucket.short, 1);

      const type: Direction = bucket.short > bucket.long ? 'PUMP' : 'DUMP';

      const confidence = clamp(
        35 + Math.min(imbalance, 6) * 9 + Math.min(30, Math.log10(total) * 4),
        0,
        99,
      );

      const reasons = [
        `${bucket.shortCount + bucket.longCount} forced exits in 30m`,
        `${type === 'PUMP' ? 'short' : 'long'} liquidations dominate (${imbalance.toFixed(1)}x)`,
        `$${(total / 1000).toFixed(0)}k liquidated`,
      ];

      const price = await this.marketData
        .getCandles(symbol, '5m', 2)
        .then((c) => c[c.length - 1]?.close ?? null)
        .catch(() => null);

      signals.push({
        id: signals.length + 1,
        symbol,
        type,
        strength: strengthFor(confidence),
        confidence,
        currentPrice: price,
        longLiqValue: bucket.long,
        shortLiqValue: bucket.short,
        longLiqCount: bucket.longCount,
        shortLiqCount: bucket.shortCount,
        imbalanceRatio: imbalance,
        windowMs,
        detectedAt: Date.now(),
        reasons: JSON.stringify(reasons),
        createdAt: new Date().toISOString(),
      });
    }

    // Cold start (WebSocket empty): surface quiet coils with building volume,
    // which is what the page promises conceptually ("early warning").
    if (signals.length < 5) {
      signals.push(...(await this.buildCoilSignals(5 - signals.length)));
    }

    signals.sort((a, b) => b.confidence - a.confidence);

    this.preMove = { at: Date.now(), data: signals };
    return signals;
  }

  private async buildCoilSignals(needed: number): Promise<PreMoveSignal[]> {
    const symbols = await this.marketData.getSymbols(60);
    const out: PreMoveSignal[] = [];

    await this.marketData.mapLimit(symbols, 6, async (symbol) => {
      if (out.length >= needed) return;

      const candles = await this.marketData
        .getCandles(symbol, '1h', 30)
        .catch(() => []);

      if (candles.length < 25) return;

      const last = candles[candles.length - 1];
      const priceChange = pct(last.close, candles[candles.length - 2].close);
      const avgVolume = mean(candles.slice(-25, -1).map((c) => c.quoteVolume));
      const volumeRatio = avgVolume > 0 ? last.quoteVolume / avgVolume : 0;

      // Tight range + volume expansion = coil before expansion.
      const rangePct = pct(last.high, last.low);
      if (volumeRatio < 1.6 || rangePct > 3) return;

      const buyPressure = last.takerBuyQuote / Math.max(last.quoteVolume, 1);
      const type: Direction = buyPressure >= 0.5 ? 'PUMP' : 'DUMP';
      const confidence = clamp(40 + Math.min(20, (volumeRatio - 1.6) * 12));

      out.push({
        id: -1,
        symbol,
        type,
        strength: strengthFor(confidence),
        confidence,
        currentPrice: last.close,
        longLiqValue: 0,
        shortLiqValue: 0,
        longLiqCount: 0,
        shortLiqCount: 0,
        imbalanceRatio: Number((buyPressure * 2).toFixed(2)),
        windowMs: 60 * 60 * 1000,
        detectedAt: Date.now(),
        reasons: JSON.stringify([
          `volume ${volumeRatio.toFixed(1)}x hourly average`,
          `tight ${rangePct.toFixed(2)}% range`,
          `${(buyPressure * 100).toFixed(0)}% taker buys`,
          'liquidation stream is warming up',
        ]),
        createdAt: new Date().toISOString(),
      });
    });

    return out.slice(0, needed);
  }

  getPreMove(minConfidence = 40, limit = 80): PreMoveSignal[] {
    return (this.preMove?.data ?? [])
      .filter((s) => s.confidence >= minConfidence)
      .slice(0, limit);
  }

  // ==================================================================
  // Safe sell (post-pump exhaustion)
  // ==================================================================

  async scanSafeSell(): Promise<SafeSellSignal[]> {
    if (this.safeSell && Date.now() - this.safeSell.at < this.SAFE_SELL_TTL) {
      return this.safeSell.data;
    }

    const symbols = await this.marketData.getSymbols(120);
    const funding = await this.marketData.getFundingMap().catch(() => new Map());
    const recentLiq = this.liquidationService.getRecentLiquidations(60 * 60 * 1000);

    const liqBySymbol = new Map<string, { long: number; short: number }>();
    for (const item of recentLiq) {
      const bucket = liqBySymbol.get(item.symbol) ?? { long: 0, short: 0 };
      if (item.side === 'LONG') bucket.long += item.value;
      else bucket.short += item.value;
      liqBySymbol.set(item.symbol, bucket);
    }

    const results = await this.marketData.mapLimit(
      symbols,
      6,
      async (symbol): Promise<SafeSellSignal | null> => {
      const candles = await this.marketData
        .getCandles(symbol, '1h', 50)
        .catch(() => []);

      if (candles.length < 25) return null;

      const last = candles[candles.length - 1];
      const priceChange1h = pct(last.close, candles[candles.length - 2].close);
      const priceChange4h = pct(last.close, candles[candles.length - 5].close);

      const avgVolume = mean(candles.slice(-25, -1).map((c) => c.quoteVolume));
      const volumeChange1h =
        avgVolume > 0 ? pct(last.quoteVolume, avgVolume) : 0;

      const fundingRate = funding.get(symbol) ?? 0;
      const liq = liqBySymbol.get(symbol) ?? { long: 0, short: 0 };

      const pumps = Math.max(0, priceChange4h) > 2;
      const momentumFading = priceChange1h < Math.max(0, priceChange4h) / 4;
      const volumeFading = volumeChange1h < -20;
      const fundingHot = fundingRate > 0.0005;
      const longFlush = liq.long > liq.short * 1.2;

      const reasons: string[] = [];

      let score = 0;
      if (pumps) {
        score += Math.min(30, priceChange4h * 1.5);
        reasons.push(`4h run-up ${priceChange4h.toFixed(2)}%`);
      }
      if (momentumFading) {
        score += 20;
        reasons.push(`1h momentum fading (${priceChange1h.toFixed(2)}%)`);
      }
      if (volumeFading) {
        score += 15;
        reasons.push(`volume ${volumeChange1h.toFixed(0)}% vs hourly average`);
      }
      if (fundingHot) {
        score += 20;
        reasons.push(`funding ${(fundingRate * 100).toFixed(4)}% — longs crowded`);
      }
      if (longFlush) {
        score += 15;
        reasons.push(`$${(liq.long / 1000).toFixed(0)}k longs liquidated in 1h`);
      }
      if (priceChange1h < -1 && priceChange4h > 3) {
        score += 10;
        reasons.push('first red hour after the impulse');
      }

      score = clamp(score);
      if (score < 35) return null;

      const direction: SafeSellSignal['direction'] =
        priceChange1h < 0 || longFlush
          ? 'LONG'
          : pumps && fundingHot
            ? 'LONG'
            : 'NEUTRAL';

      return {
        id: 0,
        symbol,
        exchange: 'BINANCE',
        direction,
        severity: severityFor(score),
        priceChange1h,
        priceChange4h,
        volumeChange1h,
        oiChange1h: 0,
        fundingRate,
        longLiquidationChange: liq.long,
        shortLiquidationChange: liq.short,
        safeSellScore: score,
        currentPrice: last.close,
        detectedAt: Date.now(),
        reasons: JSON.stringify(reasons),
        createdAt: new Date().toISOString(),
      };
      },
    );

    const data = results
      .filter((r): r is SafeSellSignal => r !== null)
      .sort((a, b) => b.safeSellScore - a.safeSellScore)
      .slice(0, 80)
      .map((r, index) => ({ ...r, id: index + 1 }));

    this.safeSell = { at: Date.now(), data };

    for (const signal of data.slice(0, 5)) {
      this.notificationGateway.sendSafeSellSignal?.({
        symbol: signal.symbol,
        exchange: signal.exchange,
        direction: signal.direction,
        severity: signal.severity,
        safeSellScore: signal.safeSellScore,
        priceChange1h: signal.priceChange1h,
        priceChange4h: signal.priceChange4h,
        currentPrice: signal.currentPrice,
        reasons: JSON.parse(signal.reasons) as string[],
        message: `Safe-sell ${signal.severity}: ${signal.symbol}`,
        timestamp: new Date().toISOString(),
      });
    }

    return data;
  }

  getSafeSell(symbol?: string, limit = 100): SafeSellSignal[] {
    const data = this.safeSell?.data ?? [];
    return (symbol ? data.filter((s) => s.symbol === symbol) : data).slice(0, limit);
  }

  // ==================================================================
  // Volume pressure
  // ==================================================================

  async scanPressure(): Promise<PressureSignal[]> {
    if (this.pressure && Date.now() - this.pressure.at < this.PRESSURE_TTL) {
      return this.pressure.data;
    }

    const symbols = await this.marketData.getSymbols(100);
    const tickerMap = await this.marketData.getTickerMap();
    const funding = await this.marketData.getFundingMap().catch(() => new Map());

    const results = await this.marketData.mapLimit(symbols, 6, async (symbol) => {
      const candles = await this.marketData
        .getCandles(symbol, '1h', 50)
        .catch(() => []);

      if (candles.length < 26) return null;

      const last = candles[candles.length - 1];
      const priceChange1h = pct(last.close, candles[candles.length - 2].close);
      const priceChange24h = tickerMap.get(symbol)?.priceChangePercent ?? 0;

      const avgVolume = mean(candles.slice(-25, -1).map((c) => c.quoteVolume));
      const volumeRatio = avgVolume > 0 ? last.quoteVolume / avgVolume : 1;

      const oiChange1h =
        (await this.marketData.getOpenInterestChange(symbol, '1h', 25)) ?? 0;

      const oiChange24h =
        (await this.marketData.getOpenInterestChange(symbol, '4h', 6)) ?? 0;

      const fundingRate = funding.get(symbol) ?? null;

      let signal: PressureSignal['signal'] | null = null;
      let reason = '';

      if (priceChange1h > 1 && oiChange1h > 1 && volumeRatio > 1.3) {
        signal = 'BUYING_PRESSURE';
        reason = `price +${priceChange1h.toFixed(2)}%, OI +${oiChange1h.toFixed(2)}%, volume ${volumeRatio.toFixed(1)}x`;
      } else if (priceChange1h < -1 && oiChange1h > 1 && volumeRatio > 1.3) {
        signal = 'SELLING_PRESSURE';
        reason = `price ${priceChange1h.toFixed(2)}%, OI +${oiChange1h.toFixed(2)}%, volume ${volumeRatio.toFixed(1)}x`;
      } else if (priceChange1h > 2 && oiChange1h < -2) {
        signal = 'SHORT_SQUEEZE';
        reason = `price +${priceChange1h.toFixed(2)}% while OI ${oiChange1h.toFixed(2)}% (shorts covering)`;
      } else if (
        priceChange1h > 0 &&
        oiChange1h > 1 &&
        fundingRate !== null &&
        fundingRate > 0.0008
      ) {
        signal = 'LONG_OVERLOADED';
        reason = `OI +${oiChange1h.toFixed(2)}% with funding ${(fundingRate * 100).toFixed(4)}%`;
      }

      if (!signal) return null;

      const score = clamp(
        Math.abs(priceChange1h) * 10 +
          Math.abs(oiChange1h) * 4 +
          Math.max(0, volumeRatio - 1) * 12,
      );

      const direction: PressureSignal['direction'] =
        signal === 'BUYING_PRESSURE' || signal === 'SHORT_SQUEEZE'
          ? 'LONG'
          : signal === 'SELLING_PRESSURE' || signal === 'LONG_OVERLOADED'
            ? 'SHORT'
            : 'NEUTRAL';

      return {
        symbol,
        signal,
        direction,
        reason,
        price: last.close,
        priceChange1h,
        priceChange24h,
        oiChange1h,
        oiChange24h,
        volume1h: last.quoteVolume,
        volume24h: tickerMap.get(symbol)?.quoteVolume ?? 0,
        fundingRate,
        score,
      } satisfies PressureSignal;
    });

    const data = results
      .filter((r): r is PressureSignal => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);

    this.pressure = { at: Date.now(), data };
    return data;
  }

  getPressure(limit = 100): { signals: PressureSignal[]; scanned: number } {
    return { signals: (this.pressure?.data ?? []).slice(0, limit), scanned: this.UNIVERSE };
  }

  // ==================================================================
  // CoinGlass-style positioning
  // ==================================================================

  async scanCoinGlass(limit = 200): Promise<CoinGlassScanResult> {
    if (this.coinGlass && Date.now() - this.coinGlass.at < this.COINGLASS_TTL) {
      return this.coinGlass.data;
    }

    const universe = Math.min(limit, 120);
    const symbols = await this.marketData.getSymbols(universe);
    const tickerMap = await this.marketData.getTickerMap();
    const funding = await this.marketData.getFundingMap().catch(() => new Map());

    const liq24h = new Map<string, number>();
    for (const item of this.liquidationService.getRecentLiquidations(
      24 * 60 * 60 * 1000,
    )) {
      liq24h.set(item.symbol, (liq24h.get(item.symbol) ?? 0) + item.value);
    }

    const results = await this.marketData.mapLimit(symbols, 5, async (symbol) => {
      const candles = await this.marketData
        .getCandles(symbol, '1h', 200)
        .catch(() => []);

      if (candles.length < 60) return null;

      const closes = candles.map((c) => c.close);
      const last = candles[candles.length - 1];
      const ticker = tickerMap.get(symbol);

      const priceChange1h = pct(last.close, candles[candles.length - 2].close);
      const priceChange24h = ticker?.priceChangePercent ?? 0;

      const last24 = candles.slice(-24);
      const previous24 = candles.slice(-48, -24);
      const volumeNow = sum(last24.map((c) => c.quoteVolume));
      const volumeBefore = sum(previous24.map((c) => c.quoteVolume));
      const volumeChange24h =
        volumeBefore > 0 ? pct(volumeNow, volumeBefore) : 0;

      const oiChange1h =
        (await this.marketData.getOpenInterestChange(symbol, '1h', 25)) ?? 0;

      const rsi1h = rsi(closes, 14);
      const rsi4h = rsi(resample(candles, 4).map((c) => c.close), 14);
      const rsi1d = rsi(resample(candles, 24).map((c) => c.close), 14);

      const fundingRate = funding.get(symbol) ?? 0;

      let signal: CoinGlassSignal['signal'] = 'NEUTRAL';
      let direction: CoinGlassSignal['direction'] = 'NEUTRAL';
      let reason = 'No dominant positioning';
      let score = 40;

      if (priceChange24h > 5 && (rsi1h ?? 0) > 65 && fundingRate > 0) {
        signal = 'STRONG_BULLISH';
        direction = 'LONG';
        score = 82;
        reason = `+${priceChange24h.toFixed(1)}% 24h with RSI ${rsi1h} and positive funding`;
      } else if (priceChange24h > 2 && oiChange1h > 0) {
        signal = 'HEALTHY_BULLISH';
        direction = 'LONG';
        score = 70;
        reason = `trend up with OI +${oiChange1h.toFixed(1)}%`;
      } else if (
        priceChange1h > 3 &&
        fundingRate > 0.0008 &&
        (rsi1h ?? 0) > 75
      ) {
        signal = 'LONG_PUMP';
        direction = 'SHORT';
        score = 66;
        reason = 'overheated 1h pump with crowded longs';
      } else if (priceChange1h < -1 && priceChange24h > 0) {
        signal = 'NORMAL_CORRECTION';
        direction = 'SHORT';
        score = 58;
        reason = 'profit taking inside an uptrend';
      } else if (priceChange1h < -3 && oiChange1h < -1) {
        signal = 'LONG_FLUSH';
        direction = 'SHORT';
        score = 74;
        reason = 'longs being flushed out';
      }

      return {
        symbol,
        signal,
        direction,
        score,
        reason,
        data: {
          symbol,
          price: last.close,
          marketCap: 0,
          openInterest: oiChange1h,
          fundingRate,
          volume24h: volumeChange24h,
          liquidation24h: liq24h.get(symbol) ?? 0,
          priceChange1h,
          priceChange24h,
          rsi1h,
          rsi4h,
          rsi1d,
        },
      } satisfies CoinGlassSignal;
    });

    const scanned = results.filter((r): r is CoinGlassSignal => r !== null);

    const data = {
      longs: scanned.filter((s) => s.direction === 'LONG').sort((a, b) => b.score - a.score),
      shorts: scanned.filter((s) => s.direction === 'SHORT').sort((a, b) => b.score - a.score),
      neutral: scanned.filter((s) => s.direction === 'NEUTRAL'),
      totalScanned: scanned.length,
      fearGreedIndex: await this.fetchFearGreed(),
      altcoinSeasonIndex: null,
      timestamp: new Date().toISOString(),
    };

    this.coinGlass = { at: Date.now(), data };
    return data;
  }

  getCoinGlass(limit = 200) {
    const data = this.coinGlass?.data;
    if (!data) {
      return {
        longs: [],
        shorts: [],
        neutral: [],
        totalScanned: 0,
        fearGreedIndex: null,
        altcoinSeasonIndex: null,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      ...data,
      longs: data.longs.slice(0, limit),
      shorts: data.shorts.slice(0, limit),
    };
  }

  private async fetchFearGreed(): Promise<number | null> {
    try {
      const response = await fetch('https://api.alternative.me/fng/?limit=1');
      if (!response.ok) return null;
      const json = (await response.json()) as {
        data?: Array<{ value?: string }>;
      };
      const value = Number(json.data?.[0]?.value);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }
}
