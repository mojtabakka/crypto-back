import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { BacktestService } from './backtest.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('backtest')
@Controller('backtest')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BacktestController {
  constructor(private readonly backtestService: BacktestService) {}

  @Post('run')
  @ApiOperation({ summary: 'Backtest a single symbol' })
  @ApiBody({
    schema: {
      properties: {
        symbol: { type: 'string', example: 'BTCUSDT' },
        interval: { type: 'string', example: '4h' },
        lookbackDays: { type: 'integer', example: 180 },
      },
    },
  })
  async run(@Body() body: any) {
    const symbol = String(body?.symbol ?? 'BTCUSDT').toUpperCase();
    const interval = String(body?.interval ?? '4h');
    const lookbackDays = Math.max(
      30,
      Math.min(720, parseInt(body?.lookbackDays, 10) || 180),
    );

    return this.backtestService.backtestSymbol(symbol, interval, lookbackDays);
  }

  @Post('batch')
  @ApiOperation({ summary: 'Backtest a list of symbols and rank them' })
  @ApiBody({
    schema: {
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          example: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
        },
        interval: { type: 'string', example: '4h' },
        lookbackDays: { type: 'integer', example: 180 },
      },
    },
  })
  async batch(@Body() body: any) {
    const symbols: string[] = Array.isArray(body?.symbols)
      ? body.symbols.map((s: string) => String(s).toUpperCase())
      : ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];

    const interval = String(body?.interval ?? '4h');
    const lookbackDays = Math.max(
      30,
      Math.min(720, parseInt(body?.lookbackDays, 10) || 180),
    );

    return this.backtestService.backtestMany(symbols.slice(0, 20), interval, lookbackDays);
  }

  @Get('history')
  @ApiOperation({ summary: 'List recent backtest runs' })
  async history(@Query('limit', new DefaultValuePipe('20')) limit: string) {
    const parsed = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    return this.backtestService.getHistory(parsed);
  }
}