import { Controller, Get, Query } from '@nestjs/common';
import { VolumeMarketCapService } from './volume-marketcap.service';
import type { VolumeMarketCapScanResult } from './types/volume-marketcap.types';

@Controller('volume-marketcap')
export class VolumeMarketCapController {
  constructor(private readonly service: VolumeMarketCapService) {}

  @Get()
  async scan(
    @Query('limit') limit: string | number = 50,
    @Query('minRatio') minRatio: string | number = 1,
    @Query('minMarketCap') minMarketCap: string | number = 10_000_000,
    @Query('pages') pages: string | number = 4,
    @Query('refresh') refresh: string | boolean = 'false',
    @Query('includeSqueeze') includeSqueeze: string | boolean = 'true',
  ): Promise<VolumeMarketCapScanResult> {
    const parsedLimit = Number(limit) || 50;
    const parsedMinRatio = Number(minRatio) || 1;
    const parsedMinMarketCap = Number(minMarketCap) || 10_000_000;
    const parsedPages = Number(pages) || 4;
    const forceRefresh = refresh === 'true' || refresh === true;
    const parsedIncludeSqueeze =
      includeSqueeze !== 'false' && includeSqueeze !== false;

    return this.service.scan(
      parsedMinRatio,
      parsedMinMarketCap,
      parsedLimit,
      parsedPages,
      forceRefresh,
      parsedIncludeSqueeze,
    );
  }
}
