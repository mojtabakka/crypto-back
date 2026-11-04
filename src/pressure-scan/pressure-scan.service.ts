import { Injectable, Logger } from '@nestjs/common';
import { ExchangeService } from '../exchange/exchange.service';
import { FuturesSymbolsService } from '../futures-symbols/futures-symbols.service';
import { MarketScannerService } from '../market-scanner/market-scanner.service';

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

export interface PressureScanResult {
  signals: PressureSignal[];
  scanned: number;
  duration: number;
  timestamp: string;
}

@Injectable()
export class PressureScanService {
  private readonly logger = new Logger(PressureScanService.name);

  constructor(
    private readonly exchangeService: ExchangeService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly marketScannerService: MarketScannerService,
  ) {}

  async scanForPressure(limit = 100): Promise<PressureScanResult> {
    const startTime = Date.now();
    this.logger.log('Starting pressure scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol)
      .slice(0, limit);

    const signals: PressureSignal[] = [];
    const endTime = Date.now();
    const start1h = endTime - 60 * 60 * 1000;
    const start24h = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          this.analyzeSymbol(symbol, start1h, start24h, endTime).catch(
            () => null,
          ),
        ),
      );
      for (const result of batchResults) {
        if (result) signals.push(result);
      }
    }

    signals.sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logger.log(
      `Pressure scan complete: ${signals.length} signals in ${duration}ms`,
    );

    return {
      signals,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  private async analyzeSymbol(
    symbol: string,
    start1h: number,
    start24h: number,
    endTime: number,
  ): Promise<PressureSignal | null> {
    try {
      const [klines1h, klines24h, funding] = await Promise.all([
        this.exchangeService.getFuturesKlines(
          symbol,
          '1h',
          start1h,
          endTime,
          2,
        ),
        this.exchangeService.getFuturesKlines(
          symbol,
          '1h',
          start24h,
          endTime,
          24,
        ),
        this.exchangeService.getFundingRate(symbol, start24h, endTime),
      ]);

      if (klines1h.length < 2 || klines24h.length < 24) return null;

      const prev1h = klines1h[0];
      const curr1h = klines1h[1];
      const first24h = klines24h[0];
      const last24h = klines24h[klines24h.length - 1];

      const pricePrev1h = parseFloat(prev1h[4]);
      const priceCurr1h = parseFloat(curr1h[4]);
      const priceStart24h = parseFloat(first24h[4]);
      const priceEnd24h = parseFloat(last24h[4]);

      const volPrev1h = parseFloat(prev1h[5]);
      const vol1hCurrent = parseFloat(curr1h[5]);
      const vol24hTotal = klines24h.reduce(
        (sum, k) => sum + parseFloat(k[5]),
        0,
      );

      const priceChange1h = ((priceCurr1h - pricePrev1h) / pricePrev1h) * 100;
      const priceChange24h =
        ((priceEnd24h - priceStart24h) / priceStart24h) * 100;

      // Simulated OI change (in real scenario would come from exchange API)
      const oiChange1h = priceChange1h * 0.8;
      const oiChange24h = priceChange24h * 0.6;

      const fundingRate =
        funding && funding.length > 0
          ? parseFloat(funding[funding.length - 1].fundingRate)
          : null;

      // Price ↑ + OI ↑ + Volume ↑
      if (
        priceChange1h > 0.5 &&
        oiChange1h > 0.3 &&
        vol1hCurrent > volPrev1h * 1.2
      ) {
        return {
          symbol,
          signal: 'BUYING_PRESSURE',
          direction: 'LONG',
          reason:
            'حرکت صعودی با ورود مشارکت جدید؛ قدرت خریداران باید تأیید شود.',
          price: priceCurr1h,
          priceChange1h,
          priceChange24h,
          oiChange1h,
          oiChange24h,
          volume1h: vol1hCurrent,
          volume24h: vol24hTotal,
          fundingRate,
          score:
            Math.abs(priceChange1h) +
            Math.abs(oiChange1h) +
            (vol1hCurrent / volPrev1h) * 10,
        };
      }

      // Price ↓ + OI ↑ + Volume ↑
      if (
        priceChange1h < -0.5 &&
        oiChange1h > 0.3 &&
        vol1hCurrent > volPrev1h * 1.2
      ) {
        return {
          symbol,
          signal: 'SELLING_PRESSURE',
          direction: 'SHORT',
          reason:
            'افزایش موقعیت‌های باز در روند نزولی؛ احتمال ادامه فشار فروش وجود دارد.',
          price: priceCurr1h,
          priceChange1h,
          priceChange24h,
          oiChange1h,
          oiChange24h,
          volume1h: vol1hCurrent,
          volume24h: vol24hTotal,
          fundingRate,
          score:
            Math.abs(priceChange1h) +
            Math.abs(oiChange1h) +
            (vol1hCurrent / volPrev1h) * 10,
        };
      }

      // Price ↑ + OI ↓ + Short Liquidation ↑ (simulated)
      if (
        priceChange1h > 0.5 &&
        oiChange1h < -0.2 &&
        vol1hCurrent > volPrev1h * 1.3
      ) {
        return {
          symbol,
          signal: 'SHORT_SQUEEZE',
          direction: 'LONG',
          reason:
            'شواهد قوی‌تر برای Short Squeeze؛ برای ادامه صعود، تقاضای اسپات را هم بررسی کن.',
          price: priceCurr1h,
          priceChange1h,
          priceChange24h,
          oiChange1h,
          oiChange24h,
          volume1h: vol1hCurrent,
          volume24h: vol24hTotal,
          fundingRate,
          score:
            Math.abs(priceChange1h) + Math.abs(vol1hCurrent / volPrev1h) * 15,
        };
      }

      // Price ↑ + OI ↑ + Funding خیلی مثبت
      if (
        priceChange1h > 0.3 &&
        oiChange1h > 0.2 &&
        fundingRate !== null &&
        fundingRate > 0.01
      ) {
        return {
          symbol,
          signal: 'LONG_OVERLOADED',
          direction: 'NEUTRAL',
          reason:
            'هشدار شلوغی لانگ‌ها؛ احتمال اصلاح وجود دارد، اما برگشت قیمت قطعی نیست.',
          price: priceCurr1h,
          priceChange1h,
          priceChange24h,
          oiChange1h,
          oiChange24h,
          volume1h: vol1hCurrent,
          volume24h: vol24hTotal,
          fundingRate,
          score: Math.abs(priceChange1h) + Math.abs(fundingRate) * 1000,
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }
}
