import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NewsService } from './news.service';
// Query DTOs must be value imports: `import type` erases them from the emitted
// `design:paramtypes`, so the ValidationPipe would see `Function`, strip every
// query parameter and answer 400 "property X should not exist".
import { EventsQueryDto, NewsQueryDto } from './news.types';
import type {
  CryptoEventResponse,
  CryptoNewsResponse,
  TradingViewNewsResponse,
} from './news.types';

@ApiTags('news')
@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get crypto news articles from RSS feeds',
    description:
      'Fetches latest crypto news from Cointelegraph RSS feeds. Optionally filter by symbol.',
  })
  async getNews(@Query() query: NewsQueryDto): Promise<CryptoNewsResponse> {
    return this.newsService.getNews(query);
  }

  @Get('events')
  @ApiOperation({
    summary: 'Get crypto events from CoinMarketCal',
    description:
      'Fetches upcoming crypto events from CoinMarketCal API. Optionally filter by symbol.',
  })
  async getEvents(
    @Query() query: EventsQueryDto,
  ): Promise<CryptoEventResponse> {
    return this.newsService.getEvents(query);
  }

  @Get('tradingview')
  @ApiOperation({
    summary: 'Get symbol-specific news from TradingView',
    description:
      'Fetches latest news for a specific symbol from TradingView news feed.',
  })
  async getTradingViewNews(
    @Query('symbol') symbol: string,
    @Query('limit') limit?: number,
    @Query('lang') lang?: string,
  ): Promise<TradingViewNewsResponse> {
    return this.newsService.getTradingViewNews(symbol, limit, lang);
  }

  @Get('important')
  @ApiOperation({
    summary: 'Get important news from all major symbols',
    description:
      'Fetches latest news from TradingView for all major crypto symbols, sorted by date.',
  })
  async getImportantNews(
    @Query('limit') limit?: number,
    @Query('lang') lang?: string,
  ): Promise<TradingViewNewsResponse> {
    return this.newsService.getImportantNews(limit ?? 30, lang);
  }
}
