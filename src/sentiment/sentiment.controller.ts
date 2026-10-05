import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SentimentService } from './sentiment.service';
import { AnalyzeSentimentDto } from './dto/analyze-sentiment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SentimentSource } from './entities/sentiment-analysis.entity';

@ApiTags('sentiment')
@Controller('sentiment')
export class SentimentController {
  constructor(private readonly sentimentService: SentimentService) {}

  @Post('analyze')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Analyze sentiment for a symbol' })
  async analyze(@Query() dto: AnalyzeSentimentDto) {
    return this.sentimentService.analyzeSentiment(dto.symbol, dto.source);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get latest sentiment for a symbol' })
  @ApiQuery({ name: 'symbol', example: 'BTCUSDT' })
  @ApiQuery({ name: 'source', enum: SentimentSource, required: false })
  async getLatest(
    @Query('symbol') symbol: string,
    @Query('source') source?: SentimentSource,
  ) {
    return this.sentimentService.getLatestSentiment(symbol, source);
  }

  @Get('history/:symbol')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get sentiment history for a symbol' })
  @ApiQuery({ name: 'days', example: 30, required: false })
  async getHistory(
    @Query('symbol') symbol: string,
    @Query('days') days?: number,
  ) {
    return this.sentimentService.getSentimentHistory(symbol, days);
  }

  @Get('overview')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get market sentiment overview' })
  async getOverview() {
    return this.sentimentService.getMarketOverview();
  }
}
