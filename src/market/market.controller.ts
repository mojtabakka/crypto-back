import { Controller, Get, Param, Query } from '@nestjs/common';

import { MarketService } from './market.service';

import { MarketQueryDto } from './dto/market-query.dto';
import { MarketSymbolDto } from './dto/market-symbol.dto';

import { LiquidationService } from 'src/liquidation/liquidation.service';

import type { MarketRange } from './dto/market-range.dto';
import type { MarketResponseDto } from './dto/market-response.dto';

@Controller('market')
export class MarketController {
  constructor(
    private readonly marketService: MarketService,

    private readonly liquidationService: LiquidationService,
  ) {}

  // =====================================================
  // Market Candles
  // =====================================================

  @Get(':symbol')
  getMarket(
    @Param() params: MarketSymbolDto,

    @Query() query: MarketQueryDto,
  ): Promise<{ time: number; volume: number }[]> {
    return this.marketService.getMarketData(
      params.symbol,

      query.interval,

      query.range,
    );
  }

  // =====================================================
  // Open Interest
  // =====================================================

  @Get(':symbol/open-interest')
  async getOpenInterest(
    @Param('symbol') symbol: string,

    @Query('range')
    range: string,
  ) {
    return this.marketService.getOpenInterest(
      symbol,

      range,
    );
  }

  // =====================================================
  // Funding Rate
  // =====================================================

  @Get(':symbol/funding-rate')
  async getFundingRate(
    @Param('symbol') symbol: string,

    @Query('range')
    range: string,
  ) {
    return this.marketService.getFundingRate(
      symbol,

      range,
    );
  }

  // =====================================================
  // Liquidations
  // =====================================================

  @Get(':symbol/liquidations')
  async getLiquidations(
    @Param('symbol') symbol: string,

    @Query('range')
    range: string,
  ) {
    return this.liquidationService.getLiquidations(
      symbol,

      range,
    );
  }

  // =====================================================
  // Market Signals
  // =====================================================

  @Get(':symbol/signals')
  async getSignals(
    @Param('symbol') symbol: string,

    @Query('range')
    range: MarketRange = '24h',
  ): Promise<MarketResponseDto> {
    return this.marketService.getSignals(
      symbol,

      range,
    );
  }
}
