import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';

import {
  ExchangeService,
  normalizeExchangeName,
} from 'src/exchange/exchange.service';
import type { ExchangeName } from 'src/exchange/exchange.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import {
  SafeSellSignalEntity,
  SafeSellDirection,
  SafeSellSeverity,
} from './entities/safe-sell-signal.entity';

interface SafeSellIndicators {
  priceChange1h: number;
  priceChange4h: number;
  volumeChange1h: number;
  volumeRatioVsAvg: number;
  oiChange1h: number;
  fundingRate: number;
  longLiquidationChange: number;
  shortLiquidationChange: number;
  rsi14: number;
  bollingerPosition: number;
  consecutiveGreenCandles: number;
  largeBuyRatio: number;
  currentPrice: number;
}

@Injectable()
export class SafeSellService {
  private readonly logger = new Logger(SafeSellService.name);

  constructor(
    @InjectRepository(SafeSellSignalEntity)
    private readonly safeSellRepository: Repository<SafeSellSignalEntity>,
    private readonly exchangeService: ExchangeService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  async scanExchange(exchange: ExchangeName): Promise<SafeSellSignalEntity[]> {
    const normalizedExchange = normalizeExchangeName(exchange);
    const symbolsData =
      await this.futuresSymbolsService.getStoredSymbols(normalizedExchange);
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(
      `[${normalizedExchange}] Scanning ${symbols.length} symbols for safe-sell signals...`,
    );

    const signals: SafeSellSignalEntity[] = [];
    const batchSize = 8;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((symbol) =>
          this.analyzeSymbolForSafeSell(symbol, normalizedExchange),
        ),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          signals.push(result.value);
        }
      }

      if (i + batchSize < symbols.length) {
        await this.delay(500);
      }
    }

    return signals;
  }

  private async analyzeSymbolForSafeSell(
    symbol: string,
    exchange: ExchangeName,
  ): Promise<SafeSellSignalEntity | null> {
    const endTime = Date.now();

    const [klines15m, klines1h, klines4h, oiData, fundingData, liquidations] =
      await Promise.all([
        this.exchangeService
          .getFuturesKlines(
            symbol,
            '15m',
            endTime - 24 * 60 * 60 * 1000,
            endTime,
            exchange,
            100,
          )
          .catch(() => []),
        this.exchangeService
          .getFuturesKlines(
            symbol,
            '1h',
            endTime - 7 * 24 * 60 * 60 * 1000,
            endTime,
            exchange,
            170,
          )
          .catch(() => []),
        this.exchangeService
          .getFuturesKlines(
            symbol,
            '4h',
            endTime - 30 * 24 * 60 * 60 * 1000,
            endTime,
            exchange,
            200,
          )
          .catch(() => []),
        this.exchangeService
          .getOpenInterest(
            symbol,
            endTime - 24 * 60 * 60 * 1000,
            endTime,
            exchange,
          )
          .catch(() => []),
        this.exchangeService
          .getFundingRate(
            symbol,
            endTime - 7 * 24 * 60 * 60 * 1000,
            endTime,
            exchange,
          )
          .catch(() => []),
        this.exchangeService
          .getLiquidationOrders(
            symbol,
            endTime - 60 * 60 * 1000,
            endTime,
            exchange,
          )
          .catch(() => []),
      ]);

    if (klines1h.length < 24) return null;

    const indicators = this.calculateIndicators(
      klines15m,
      klines1h,
      klines4h,
      oiData,
      fundingData,
      liquidations,
    );

    const score = this.calculateSafeSellScore(indicators);
    const direction = this.getDirection(indicators);
    const severity = this.getSeverity(score);
    const reasons = this.getReasons(indicators, direction, score);

    if (severity === null) return null;

    const currentPrice = parseFloat(klines1h[klines1h.length - 1][4]);

    const existing = await this.safeSellRepository.findOne({
      where: {
        symbol,
        exchange,
        detectedAt: MoreThan(endTime - 4 * 60 * 60 * 1000),
      },
    });

    if (existing) {
      existing.direction = direction;
      existing.severity = severity;
      existing.priceChange1h = indicators.priceChange1h;
      existing.priceChange4h = indicators.priceChange4h;
      existing.volumeChange1h = indicators.volumeChange1h;
      existing.oiChange1h = indicators.oiChange1h;
      existing.fundingRate = indicators.fundingRate;
      existing.longLiquidationChange = indicators.longLiquidationChange;
      existing.shortLiquidationChange = indicators.shortLiquidationChange;
      existing.safeSellScore = score;
      existing.currentPrice = currentPrice;
      existing.reasons = JSON.stringify(reasons);
      existing.detectedAt = endTime;
      return this.safeSellRepository.save(existing);
    }

    const signal = new SafeSellSignalEntity();
    signal.symbol = symbol;
    signal.exchange = exchange;
    signal.direction = direction;
    signal.severity = severity;
    signal.priceChange1h = indicators.priceChange1h;
    signal.priceChange4h = indicators.priceChange4h;
    signal.volumeChange1h = indicators.volumeChange1h;
    signal.oiChange1h = indicators.oiChange1h;
    signal.fundingRate = indicators.fundingRate;
    signal.longLiquidationChange = indicators.longLiquidationChange;
    signal.shortLiquidationChange = indicators.shortLiquidationChange;
    signal.safeSellScore = score;
    signal.currentPrice = currentPrice;
    signal.detectedAt = endTime;
    signal.reasons = JSON.stringify(reasons);

    const saved = await this.safeSellRepository.save(signal);

    if (severity === 'HIGH' || severity === 'EXTREME') {
      this.notificationGateway.sendSafeSellSignal({
        symbol,
        exchange,
        direction,
        severity,
        safeSellScore: score,
        priceChange1h: indicators.priceChange1h,
        priceChange4h: indicators.priceChange4h,
        currentPrice,
        reasons,
      });
    }

    return saved;
  }

  private calculateIndicators(
    klines15m: any[],
    klines1h: any[],
    klines4h: any[],
    oiData: any[],
    fundingData: any[],
    liquidations: any[],
  ): SafeSellIndicators {
    const currentPrice = parseFloat(klines1h[klines1h.length - 1][4]);
    const price1hAgo = parseFloat(
      klines1h[Math.max(0, klines1h.length - 2)][4],
    );
    const price4hAgo = parseFloat(
      klines1h[Math.max(0, klines1h.length - 5)][4],
    );

    const priceChange1h = ((currentPrice - price1hAgo) / price1hAgo) * 100;
    const priceChange4h = ((currentPrice - price4hAgo) / price4hAgo) * 100;

    const currentVolume1h = this.sumVolume(klines1h.slice(-1));
    const previousVolume1h = this.sumVolume(klines1h.slice(-2, -1));
    const volumeChange1h =
      previousVolume1h > 0
        ? ((currentVolume1h - previousVolume1h) / previousVolume1h) * 100
        : 0;

    const avgVolume7d =
      klines1h.slice(-168).reduce((sum, k) => sum + parseFloat(k[5]), 0) / 168;
    const volumeRatioVsAvg =
      avgVolume7d > 0 ? (currentVolume1h / avgVolume7d) * 100 : 100;

    const oiChange1h =
      oiData.length >= 2
        ? ((parseFloat(oiData[oiData.length - 1].sumOpenInterest) -
            parseFloat(
              oiData[Math.max(0, oiData.length - 2)].sumOpenInterest,
            )) /
            Math.max(
              1,
              parseFloat(
                oiData[Math.max(0, oiData.length - 2)].sumOpenInterest,
              ),
            )) *
          100
        : 0;

    const fundingRate =
      fundingData.length > 0
        ? parseFloat(fundingData[fundingData.length - 1].fundingRate)
        : 0;

    const closes = klines1h.map((k) => parseFloat(k[4]));
    const rsi14 = this.calculateRSI(closes, 14);
    const bollingerPosition = this.calculateBollingerPosition(closes, 20, 2);
    const consecutiveGreenCandles = this.countConsecutiveGreen(klines1h);
    const largeBuyRatio = this.calculateLargeBuyRatio(klines15m);

    const longLiq = liquidations
      .filter((l: any) => l.side === 'BUY')
      .reduce(
        (sum: number, l: any) =>
          sum + parseFloat(l.executedQty || l.origQty || 0),
        0,
      );
    const shortLiq = liquidations
      .filter((l: any) => l.side === 'SELL')
      .reduce(
        (sum: number, l: any) =>
          sum + parseFloat(l.executedQty || l.origQty || 0),
        0,
      );

    const longLiquidationChange = longLiq;
    const shortLiquidationChange = shortLiq;

    return {
      priceChange1h,
      priceChange4h,
      volumeChange1h,
      volumeRatioVsAvg,
      oiChange1h,
      fundingRate,
      longLiquidationChange,
      shortLiquidationChange,
      rsi14,
      bollingerPosition,
      consecutiveGreenCandles,
      largeBuyRatio,
      currentPrice,
    };
  }

  private calculateSafeSellScore(ind: SafeSellIndicators): number {
    let score = 0;

    if (ind.priceChange1h > 5) {
      score += 20;
    } else if (ind.priceChange1h > 3) {
      score += 12;
    } else if (ind.priceChange1h > 1.5) {
      score += 6;
    }

    if (ind.priceChange4h > 10) {
      score += 20;
    } else if (ind.priceChange4h > 5) {
      score += 12;
    } else if (ind.priceChange4h > 3) {
      score += 6;
    }

    if (ind.volumeChange1h > 200) {
      score += 15;
    } else if (ind.volumeChange1h > 100) {
      score += 10;
    } else if (ind.volumeChange1h > 50) {
      score += 5;
    }

    if (ind.volumeRatioVsAvg > 500) {
      score += 10;
    } else if (ind.volumeRatioVsAvg > 300) {
      score += 6;
    } else if (ind.volumeRatioVsAvg > 200) {
      score += 3;
    }

    if (ind.oiChange1h > 20) {
      score += 10;
    } else if (ind.oiChange1h > 10) {
      score += 6;
    } else if (ind.oiChange1h > 5) {
      score += 3;
    }

    if (ind.fundingRate > 0.001) {
      score += 8;
    } else if (ind.fundingRate > 0.0005) {
      score += 4;
    }

    if (ind.rsi14 > 80) {
      score += 10;
    } else if (ind.rsi14 > 70) {
      score += 5;
    }

    if (ind.bollingerPosition > 1) {
      score += 8;
    }

    if (ind.consecutiveGreenCandles >= 6) {
      score += 10;
    } else if (ind.consecutiveGreenCandles >= 4) {
      score += 5;
    }

    if (ind.longLiquidationChange > 0 && ind.shortLiquidationChange > 0) {
      if (ind.longLiquidationChange > ind.shortLiquidationChange * 2) {
        score += 10;
      } else if (ind.shortLiquidationChange > ind.longLiquidationChange * 2) {
        score += 10;
      }
    }

    return Math.min(100, score);
  }

  private getDirection(ind: SafeSellIndicators): SafeSellDirection {
    const longPressure = ind.longLiquidationChange - ind.shortLiquidationChange;
    const oiPressure = ind.oiChange1h;
    const fundingPressure = ind.fundingRate > 0 ? 1 : -1;

    if (longPressure > 0 && oiPressure > 0 && fundingPressure > 0) {
      return 'LONG';
    }
    if (longPressure < 0 && oiPressure < 0 && fundingPressure < 0) {
      return 'SHORT';
    }

    if (ind.oiChange1h > 5 && ind.fundingRate > 0) return 'LONG';
    if (ind.oiChange1h < -5 && ind.fundingRate < 0) return 'SHORT';

    return 'NEUTRAL';
  }

  private getSeverity(score: number): SafeSellSeverity | null {
    if (score >= 80) return 'EXTREME';
    if (score >= 60) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    if (score >= 25) return 'LOW';
    return null;
  }

  private getReasons(
    ind: SafeSellIndicators,
    direction: SafeSellDirection,
    score: number,
  ): string[] {
    const reasons: string[] = [];

    if (ind.priceChange1h > 3) {
      reasons.push(`Price up ${ind.priceChange1h.toFixed(2)}% in 1h`);
    }
    if (ind.priceChange4h > 5) {
      reasons.push(`Price up ${ind.priceChange4h.toFixed(2)}% in 4h`);
    }
    if (ind.volumeChange1h > 100) {
      reasons.push(`Volume spike +${ind.volumeChange1h.toFixed(0)}% in 1h`);
    }
    if (ind.volumeRatioVsAvg > 300) {
      reasons.push(`Volume ${ind.volumeRatioVsAvg.toFixed(0)}% of 7d avg`);
    }
    if (ind.oiChange1h > 10) {
      reasons.push(`OI up ${ind.oiChange1h.toFixed(2)}% in 1h`);
    }
    if (ind.fundingRate > 0.0005) {
      reasons.push(`High funding: ${(ind.fundingRate * 100).toFixed(3)}%`);
    }
    if (ind.rsi14 > 70) {
      reasons.push(`RSI overbought: ${ind.rsi14.toFixed(1)}`);
    }
    if (ind.bollingerPosition > 1) {
      reasons.push('Price above upper Bollinger Band');
    }
    if (ind.consecutiveGreenCandles >= 4) {
      reasons.push(`${ind.consecutiveGreenCandles} consecutive green candles`);
    }
    if (direction === 'LONG') {
      reasons.push('Longs increasing');
    } else if (direction === 'SHORT') {
      reasons.push('Shorts increasing');
    }

    return reasons;
  }

  private sumVolume(klines: any[][]): number {
    return klines.reduce((sum, k) => sum + parseFloat(k[5]), 0);
  }

  private calculateRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private calculateBollingerPosition(
    closes: number[],
    period: number,
    stdDevMultiplier: number,
  ): number {
    if (closes.length < period) return 0;

    const slice = closes.slice(-period);
    const sma = slice.reduce((sum, p) => sum + p, 0) / period;

    const variance =
      slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    const upperBand = sma + stdDev * stdDevMultiplier;
    const currentPrice = closes[closes.length - 1];

    if (upperBand === sma) return 0;
    return (currentPrice - sma) / (upperBand - sma);
  }

  private countConsecutiveGreen(klines: any[][]): number {
    let count = 0;
    for (let i = klines.length - 1; i >= 0; i--) {
      if (parseFloat(klines[i][4]) > parseFloat(klines[i][1])) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  private calculateLargeBuyRatio(klines: any[][]): number {
    if (klines.length === 0) return 50;

    let buyVolume = 0;
    let sellVolume = 0;

    for (const k of klines) {
      const totalVol = parseFloat(k[5]);
      const takerBuyVol = parseFloat(k[9] || '0');
      buyVolume += takerBuyVol;
      sellVolume += totalVol - takerBuyVol;
    }

    const total = buyVolume + sellVolume;
    return total > 0 ? (buyVolume / total) * 100 : 50;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getRecentSignals(
    exchange?: ExchangeName,
    symbol?: string,
  ): Promise<SafeSellSignalEntity[]> {
    const where: any = {};

    if (exchange) {
      where.exchange = normalizeExchangeName(exchange);
    }

    if (symbol) {
      where.symbol = symbol.toUpperCase();
    }

    return this.safeSellRepository.find({
      where,
      order: { detectedAt: 'DESC' },
      take: 100,
    });
  }

  async getActiveSignals(
    exchange?: ExchangeName,
    symbol?: string,
  ): Promise<SafeSellSignalEntity[]> {
    const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;

    const where: any = {
      detectedAt: MoreThan(fourHoursAgo),
    };

    if (exchange) {
      where.exchange = normalizeExchangeName(exchange);
    }

    if (symbol) {
      where.symbol = symbol.toUpperCase();
    }

    return this.safeSellRepository.find({
      where,
      order: { detectedAt: 'DESC' },
      take: 50,
    });
  }
}
