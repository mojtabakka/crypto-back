import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from 'src/binance/binance.service';
import type {
  SymbolOIStatus,
  SymbolOIMonitorParams,
  SymbolOIDirection,
  SymbolOIClassification,
} from './types/symbol-oi-monitor.types';

const DEFAULT_LOOKBACK_MINUTES = 60;

@Injectable()
export class SymbolOiMonitorService {
  private readonly logger = new Logger(SymbolOiMonitorService.name);

  constructor(private readonly binanceService: BinanceService) {}

  async getStatus(params: SymbolOIMonitorParams): Promise<SymbolOIStatus> {
    const symbol = params.symbol.toUpperCase();
    const lookbackMinutes = params.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;

    this.logger.log(
      `Symbol OI monitor: ${symbol} lookback=${lookbackMinutes}m`,
    );

    const now = Date.now();
    const startTime = now - lookbackMinutes * 60 * 1000;

    // Fetch 24hr price change from Binance (rate limited)
    const ticker = await this.binanceService.rateLimit(() =>
      this.binanceService.get24hrTicker(symbol),
    );

    if (!ticker) {
      throw new Error(`Failed to fetch price data for ${symbol}`);
    }

    const priceChangePct = ticker.priceChangePercent;

    // Fetch OI history from Binance (rate limited)
    const oiHistory = await this.binanceService.rateLimit(() =>
      this.binanceService.getOpenInterest(symbol, startTime, now),
    );

    let oiChangePct = 0;
    if (oiHistory && oiHistory.length >= 2) {
      const firstOI = Number(oiHistory[0].sumOpenInterest);
      const lastOI = Number(oiHistory[oiHistory.length - 1].sumOpenInterest);

      if (firstOI > 0) {
        oiChangePct = ((lastOI - firstOI) / firstOI) * 100;
      }
    }

    const classification: SymbolOIClassification = this.classify(
      priceChangePct,
      oiChangePct,
    );

    const direction: SymbolOIDirection =
      classification === 'LONG_BUILDUP' || classification === 'SHORT_COVERING'
        ? 'LONG'
        : classification === 'LONG_LIQUIDATION' ||
            classification === 'SHORT_BUILDUP'
          ? 'SHORT'
          : 'NEUTRAL';

    return {
      symbol,
      price: Number(ticker.lastPrice),
      priceChangePct,
      oiChangePct,
      classification,
      direction,
      lastUpdated: new Date().toISOString(),
      lookbackMinutes,
    };
  }

  private classify(
    priceChangePct: number,
    oiChangePct: number,
  ): SymbolOIClassification {
    const priceUp = priceChangePct > 0;
    const priceDown = priceChangePct < 0;
    const oiUp = oiChangePct > 0;
    const oiDown = oiChangePct < 0;

    if (priceUp && oiUp) return 'LONG_BUILDUP';
    if (priceUp && oiDown) return 'SHORT_COVERING';
    if (priceDown && oiDown) return 'LONG_LIQUIDATION';
    if (priceDown && oiUp) return 'SHORT_BUILDUP';

    return 'NEUTRAL';
  }
}
