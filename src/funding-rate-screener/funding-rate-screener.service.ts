import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from 'src/binance/binance.service';
import type {
  FundingRateScanParams,
  FundingRateScanResult,
  FundingRateSignal,
} from './types/funding-rate-screener.types';

@Injectable()
export class FundingRateScreenerService {
  private readonly logger = new Logger(FundingRateScreenerService.name);

  constructor(private readonly binanceService: BinanceService) {}

  async scan(
    params: FundingRateScanParams = {},
  ): Promise<FundingRateScanResult> {
    const interval = params.interval ?? '1d';
    const exchange: string = params.exchange ?? 'binance';
    const maxFundingRate = params.maxFundingRate ?? -0.05; // -0.05% default

    this.logger.log(
      `Funding rate screener: scanning for funding rate <= ${maxFundingRate}% (exchange=${exchange})`,
    );

    try {
      const tickers = await this.binanceService.getTickers();
      const symbols = tickers
        .map((t) => t.symbol)
        .filter((s) => s.endsWith('USDT'));

      const matches: FundingRateSignal[] = [];

      for (const symbol of symbols) {
        try {
          const fundingRateData = await this.binanceService.getFundingRate(
            symbol,
            Date.now() - 24 * 60 * 60 * 1000,
            Date.now(),
          );

          if (!fundingRateData || fundingRateData.length === 0) {
            continue;
          }

          const latestFunding = fundingRateData[fundingRateData.length - 1];
          const fundingRate = parseFloat(latestFunding.fundingRate);
          const fundingRatePct = fundingRate * 100;

          if (fundingRatePct <= maxFundingRate) {
            matches.push({
              symbol,
              price: parseFloat(
                tickers.find((t) => t.symbol === symbol)?.lastPrice || '0',
              ),
              fundingRate,
              fundingRatePct,
              timeframe: interval,
              nextFundingTime: latestFunding.fundingTime,
              signal: fundingRatePct <= -0.05 ? 'SHORT' : 'NEUTRAL',
              score: Math.abs(fundingRatePct) * 10,
            });
          }
        } catch (error) {
          this.logger.warn(
            `Funding rate fetch failed for ${symbol}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }

      matches.sort((a, b) => a.fundingRatePct - b.fundingRatePct);

      this.logger.log(
        `Funding rate screener complete: ${matches.length}/${symbols.length} symbols with funding rate <= ${maxFundingRate}%`,
      );

      return {
        timestamp: new Date().toISOString(),
        interval,
        exchange,
        totalScanned: symbols.length,
        matches,
      };
    } catch (error) {
      this.logger.error(`Funding rate screener failed: ${error}`);
      return {
        timestamp: new Date().toISOString(),
        interval,
        exchange,
        totalScanned: 0,
        matches: [],
      };
    }
  }
}
