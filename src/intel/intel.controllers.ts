import { Controller, Get, Param, Query } from '@nestjs/common';
import { IntelService } from './intel.service';

const limitOf = (limit?: string, fallback = 20) => {
  const parsed = Number(limit ?? fallback);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : fallback;
};

@Controller('tvl-analysis')
export class TvlController {
  constructor(private readonly intel: IntelService) {}

  @Get('scan')
  scan(@Query('exchange') _exchange?: string, @Query('limit') limit?: string) {
    return this.intel.getScan(limitOf(limit, 100));
  }

  @Get('top-opportunities')
  async opportunities(
    @Query('exchange') _exchange?: string,
    @Query('limit') limit?: string,
  ) {
    return this.intel.getTopOpportunities(limitOf(limit));
  }

  @Get('top-by-tvl')
  topByTvl(@Query('limit') limit?: string) {
    return this.intel.getTopByTvl(limitOf(limit));
  }

  @Get('top-by-growth')
  topByGrowth(@Query('limit') limit?: string) {
    return this.intel.getTopByGrowth(limitOf(limit));
  }

  @Get('undervalued')
  undervalued(@Query('limit') limit?: string) {
    return this.intel.getUndervalued(limitOf(limit));
  }

  @Get('blue-chips')
  blueChips(@Query('limit') limit?: string) {
    return this.intel.getBlueChips(limitOf(limit));
  }

  @Get('multi-chain')
  multiChain(@Query('limit') limit?: string) {
    return this.intel.getMultiChain(limitOf(limit));
  }

  @Get('protocol/:symbol')
  protocol(@Param('symbol') symbol: string) {
    return this.intel.getProtocolBySymbol(symbol);
  }

  @Get('by-chain/:chain')
  byChain(@Param('chain') chain: string, @Query('limit') limit?: string) {
    return this.intel.getByChain(chain, limitOf(limit, 50));
  }

  @Get('by-category/:category')
  byCategory(@Param('category') category: string, @Query('limit') limit?: string) {
    return this.intel.getByCategory(category, limitOf(limit, 50));
  }
}

@Controller('protocol-analysis')
export class ProtocolAnalysisController {
  constructor(private readonly intel: IntelService) {}

  @Get('search')
  search(@Query('query') query?: string, @Query('limit') limit?: string) {
    return this.intel.searchProtocols(query ?? '', limitOf(limit, 30));
  }

  @Get('categories')
  categories() {
    return this.intel.getCategories();
  }

  @Get(':slug')
  deepDive(@Param('slug') slug: string) {
    return this.intel.getDeepDive(slug);
  }
}

@Controller('volume-marketcap')
export class VolumeMarketCapController {
  constructor(private readonly intel: IntelService) {}

  @Get()
  scan(
    @Query('minRatio') minRatio?: string,
    @Query('minMarketCap') minMarketCap?: string,
    @Query('limit') limit?: string,
    @Query('pages') pages?: string,
    @Query('refresh') refresh?: string,
    @Query('includeSqueeze') includeSqueeze?: string,
  ) {
    const ratio = Number(minRatio);
    const mcap = Number(minMarketCap);
    const size = Number(limit);
    const pageCount = Number(pages);

    return this.intel.getVolumeMarketCap({
      minRatio: Number.isFinite(ratio) ? ratio : 0.5,
      minMarketCap: Number.isFinite(mcap) ? mcap : 10_000_000,
      limit: Number.isFinite(size) ? size : 100,
      pages: Number.isFinite(pageCount) ? pageCount : 4,
      refresh: refresh === 'true',
      includeSqueeze: includeSqueeze !== 'false',
    });
  }
}
