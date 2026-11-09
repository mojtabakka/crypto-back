import { Controller, Get, Query } from '@nestjs/common';
import { FundingRateScreenerService } from './funding-rate-screener.service';
import type { FundingRateScanResult } from './types/funding-rate-screener.types';

@Controller('funding-rate-screener')
export class FundingRateScreenerController {
  constructor(private readonly screener: FundingRateScreenerService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('maxFundingRate') maxFundingRate?: string,
    @Query('exchange') exchange?: string,
  ): Promise<FundingRateScanResult> {
    return this.screener.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      maxFundingRate: maxFundingRate ? Number(maxFundingRate) : undefined,
      exchange,
    });
  }
}
