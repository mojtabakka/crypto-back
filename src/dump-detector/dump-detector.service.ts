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
import { DumpAlertEntity, DumpSeverity } from './entities/dump-alert.entity';

interface DumpIndicators {
  priceChange1h: number;
  priceChange4h: number;
  priceChange24h: number;
  volumeChange1h: number;
  volumeChange24h: number;
  volumeRatioVsAvg: number;
  oiChange1h: number;
  fundingRate: number;
  rsi14: number;
  bollingerPosition: number;
  consecutiveRedCandles: number;
  largeSellRatio: number;
  currentPrice: number;
}

@Injectable()
export class DumpDetectorService {
  private readonly logger = new Logger(DumpDetectorService.name);

  constructor(
    @InjectRepository(DumpAlertEntity)
    private readonly dumpAlertRepository: Repository<DumpAlertEntity>,
    private readonly exchangeService: ExchangeService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  async scanExchange(exchange: ExchangeName): Promise<DumpAlertEntity[]> {
    const normalizedExchange = normalizeExchangeName(exchange);
    const symbolsData =
      await this.futuresSymbolsService.getStoredSymbols(normalizedExchange);
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(
      `[${normalizedExchange}] Scanning ${symbols.length} symbols for dumps...`,
    );

    const alerts: DumpAlertEntity[] = [];
    const batchSize = 8;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((symbol) =>
          this.analyzeSymbolForDump(symbol, normalizedExchange),
        ),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          alerts.push(result.value);
        }
      }

      if (i + batchSize < symbols.length) {
        await this.delay(500);
      }
    }

    return alerts;
  }

  private async analyzeSymbolForDump(
    symbol: string,
    exchange: ExchangeName,
  ): Promise<DumpAlertEntity | null> {
    const endTime = Date.now();

    const [klines15m, klines1h, klines4h, oiData, fundingData] =
      await Promise.all([
        this.exchangeService.getFuturesKlines(
          symbol,
          '15m',
          endTime - 24 * 60 * 60 * 1000,
          endTime,
          exchange,
          100,
        ),
        this.exchangeService.getFuturesKlines(
          symbol,
          '1h',
          endTime - 7 * 24 * 60 * 60 * 1000,
          endTime,
          exchange,
          170,
        ),
        this.exchangeService.getFuturesKlines(
          symbol,
          '4h',
          endTime - 30 * 24 * 60 * 60 * 1000,
          endTime,
          exchange,
          200,
        ),
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
      ]);

    if (klines1h.length < 24) return null;

    const indicators = this.calculateIndicators(
      klines15m,
      klines1h,
      klines4h,
      oiData,
      fundingData,
    );

    const dumpScore = this.calculateDumpScore(indicators);
    const severity = this.getSeverity(dumpScore);
    const reasons = this.getReasons(indicators, dumpScore);

    if (severity === null) return null;

    const currentPrice = parseFloat(klines1h[klines1h.length - 1][4]);

    const existing = await this.dumpAlertRepository.findOne({
      where: {
        symbol,
        exchange,
        detectedAt: MoreThan(endTime - 4 * 60 * 60 * 1000),
      },
    });

    if (existing) {
      existing.dumpScore = dumpScore;
      existing.severity = severity;
      existing.priceChange1h = indicators.priceChange1h;
      existing.priceChange4h = indicators.priceChange4h;
      existing.priceChange24h = indicators.priceChange24h;
      existing.volumeChange1h = indicators.volumeChange1h;
      existing.volumeChange24h = indicators.volumeChange24h;
      existing.currentPrice = currentPrice;
      existing.reasons = JSON.stringify(reasons);
      existing.detectedAt = endTime;
      return this.dumpAlertRepository.save(existing);
    }

    const alert = new DumpAlertEntity();
    alert.symbol = symbol;
    alert.exchange = exchange;
    alert.severity = severity;
    alert.dumpScore = dumpScore;
    alert.priceChange1h = indicators.priceChange1h;
    alert.priceChange4h = indicators.priceChange4h;
    alert.priceChange24h = indicators.priceChange24h;
    alert.volumeChange1h = indicators.volumeChange1h;
    alert.volumeChange24h = indicators.volumeChange24h;
    alert.currentPrice = currentPrice;
    alert.detectedAt = endTime;
    alert.reasons = JSON.stringify(reasons);

    const saved = await this.dumpAlertRepository.save(alert);

    if (severity === 'HIGH' || severity === 'EXTREME') {
      this.notificationGateway.sendDumpAlert({
        symbol,
        exchange,
        severity,
        dumpScore,
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
  ): DumpIndicators {
    const currentPrice = parseFloat(klines1h[klines1h.length - 1][4]);
    const price1hAgo = parseFloat(
      klines1h[Math.max(0, klines1h.length - 2)][4],
    );
    const price4hAgo = parseFloat(
      klines1h[Math.max(0, klines1h.length - 5)][4],
    );
    const price24hAgo = parseFloat(
      klines1h[Math.max(0, klines1h.length - 25)][4],
    );

    const priceChange1h = ((currentPrice - price1hAgo) / price1hAgo) * 100;
    const priceChange4h = ((currentPrice - price4hAgo) / price4hAgo) * 100;
    const priceChange24h = ((currentPrice - price24hAgo) / price24hAgo) * 100;

    const currentVolume1h = this.sumVolume(klines1h.slice(-1));
    const previousVolume1h = this.sumVolume(klines1h.slice(-2, -1));
    const volumeChange1h =
      previousVolume1h > 0
        ? ((currentVolume1h - previousVolume1h) / previousVolume1h) * 100
        : 0;

    const currentVolume24h = this.sumVolume(klines1h.slice(-24));
    const previousVolume24h = this.sumVolume(klines1h.slice(-48, -24));
    const volumeChange24h =
      previousVolume24h > 0
        ? ((currentVolume24h - previousVolume24h) / previousVolume24h) * 100
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

    const consecutiveRedCandles = this.countConsecutiveRed(klines1h);

    const largeSellRatio = this.calculateLargeSellRatio(klines15m);

    return {
      priceChange1h,
      priceChange4h,
      priceChange24h,
      volumeChange1h,
      volumeChange24h,
      volumeRatioVsAvg,
      oiChange1h,
      fundingRate,
      rsi14,
      bollingerPosition,
      consecutiveRedCandles,
      largeSellRatio,
      currentPrice,
    };
  }

  private calculateDumpScore(ind: DumpIndicators): number {
    let score = 0;

    if (ind.priceChange1h < -5) {
      score += 25;
    } else if (ind.priceChange1h < -3) {
      score += 15;
    } else if (ind.priceChange1h < -1.5) {
      score += 8;
    }

    if (ind.priceChange4h < -10) {
      score += 25;
    } else if (ind.priceChange4h < -5) {
      score += 15;
    } else if (ind.priceChange4h < -3) {
      score += 8;
    }

    if (ind.priceChange24h < -20) {
      score += 20;
    } else if (ind.priceChange24h < -10) {
      score += 10;
    } else if (ind.priceChange24h < -5) {
      score += 5;
    }

    if (ind.volumeChange1h > 200) {
      score += 20;
    } else if (ind.volumeChange1h > 100) {
      score += 12;
    } else if (ind.volumeChange1h > 50) {
      score += 6;
    }

    if (ind.volumeRatioVsAvg > 500) {
      score += 15;
    } else if (ind.volumeRatioVsAvg > 300) {
      score += 10;
    } else if (ind.volumeRatioVsAvg > 200) {
      score += 5;
    }

    if (ind.oiChange1h < -20) {
      score += 10;
    } else if (ind.oiChange1h < -10) {
      score += 5;
    }

    if (ind.fundingRate < -0.001) {
      score += 8;
    } else if (ind.fundingRate < -0.0005) {
      score += 4;
    }

    if (ind.rsi14 < 20) {
      score += 10;
    } else if (ind.rsi14 < 30) {
      score += 5;
    }

    if (ind.bollingerPosition < -1) {
      score += 8;
    }

    if (ind.consecutiveRedCandles >= 6) {
      score += 10;
    } else if (ind.consecutiveRedCandles >= 4) {
      score += 5;
    }

    if (ind.largeSellRatio > 70) {
      score += 8;
    } else if (ind.largeSellRatio > 60) {
      score += 4;
    }

    return Math.min(100, score);
  }

  private getSeverity(score: number): DumpSeverity | null {
    if (score >= 80) return 'EXTREME';
    if (score >= 60) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    if (score >= 25) return 'LOW';
    return null;
  }

  private getReasons(ind: DumpIndicators, score: number): string[] {
    const reasons: string[] = [];

    if (ind.priceChange1h < -3) {
      reasons.push(`📉 Price down ${ind.priceChange1h.toFixed(2)}% in 1h`);
    }
    if (ind.priceChange4h < -5) {
      reasons.push(`📉 Price down ${ind.priceChange4h.toFixed(2)}% in 4h`);
    }
    if (ind.priceChange24h < -10) {
      reasons.push(`📉 Price down ${ind.priceChange24h.toFixed(2)}% in 24h`);
    }
    if (ind.volumeChange1h > 100) {
      reasons.push(`🔊 Volume spike +${ind.volumeChange1h.toFixed(0)}% in 1h`);
    }
    if (ind.volumeRatioVsAvg > 300) {
      reasons.push(
        `🔊 Volume ${ind.volumeRatioVsAvg.toFixed(0)}% of 7d average`,
      );
    }
    if (ind.oiChange1h < -10) {
      reasons.push(`💼 OI down ${ind.oiChange1h.toFixed(2)}% in 1h`);
    }
    if (ind.fundingRate < -0.0005) {
      reasons.push(
        `💰 Negative funding: ${(ind.fundingRate * 100).toFixed(3)}%`,
      );
    }
    if (ind.rsi14 < 30) {
      reasons.push(`⚠️ RSI oversold: ${ind.rsi14.toFixed(1)}`);
    }
    if (ind.bollingerPosition < -1) {
      reasons.push('⚠️ Price below lower Bollinger Band');
    }
    if (ind.consecutiveRedCandles >= 4) {
      reasons.push(`🔴 ${ind.consecutiveRedCandles} consecutive red candles`);
    }
    if (ind.largeSellRatio > 60) {
      reasons.push(`🔴 Sell pressure: ${ind.largeSellRatio.toFixed(0)}%`);
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

  private countConsecutiveRed(klines: any[][]): number {
    let count = 0;
    for (let i = klines.length - 1; i >= 0; i--) {
      if (parseFloat(klines[i][4]) < parseFloat(klines[i][1])) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  private calculateLargeSellRatio(klines: any[][]): number {
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
    return total > 0 ? (sellVolume / total) * 100 : 50;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getRecentAlerts(
    exchange?: ExchangeName,
    minScore = 0,
  ): Promise<DumpAlertEntity[]> {
    const where: any = { dumpScore: MoreThan(minScore) };

    if (exchange) {
      where.exchange = normalizeExchangeName(exchange);
    }

    return this.dumpAlertRepository.find({
      where,
      order: { dumpScore: 'DESC' },
      take: 100,
    });
  }

  async getActiveAlerts(exchange?: ExchangeName): Promise<DumpAlertEntity[]> {
    const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;

    const where: any = {
      detectedAt: MoreThan(fourHoursAgo),
    };

    if (exchange) {
      where.exchange = normalizeExchangeName(exchange);
    }

    return this.dumpAlertRepository.find({
      where,
      order: { dumpScore: 'DESC' },
      take: 50,
    });
  }
}
