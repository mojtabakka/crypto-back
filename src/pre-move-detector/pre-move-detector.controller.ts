import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { PreMoveDetectorService } from './pre-move-detector.service';
import { PreMoveSignalEntity } from './entities/pre-move-signal.entity';
import type { PreMoveType } from './entities/pre-move-signal.entity';
import type { ExchangeName } from 'src/exchange/exchange.service';

@ApiTags('pre-move-detector')
@Controller('pre-move-detector')
export class PreMoveDetectorController {
  constructor(
    private readonly preMoveDetectorService: PreMoveDetectorService,
  ) {}

  @Get('signals')
  @ApiOperation({ summary: 'Get recent pre-move signals' })
  @ApiQuery({ name: 'type', required: false, enum: ['PUMP', 'DUMP'] })
  @ApiQuery({ name: 'minConfidence', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'exchange', required: false, type: String })
  async getSignals(
    @Query('type') type?: PreMoveType,
    @Query('minConfidence') minConfidence?: number,
    @Query('limit') limit?: number,
    @Query('exchange') exchange?: ExchangeName,
  ): Promise<PreMoveSignalEntity[]> {
    return this.preMoveDetectorService.getRecentSignals(
      type,
      minConfidence ?? 0,
      limit ?? 100,
      exchange,
    );
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active pre-move signals from last hour' })
  @ApiQuery({ name: 'type', required: false, enum: ['PUMP', 'DUMP'] })
  @ApiQuery({ name: 'exchange', required: false, type: String })
  async getActiveSignals(
    @Query('type') type?: PreMoveType,
    @Query('exchange') exchange?: ExchangeName,
  ): Promise<PreMoveSignalEntity[]> {
    return this.preMoveDetectorService.getActiveSignals(type, exchange);
  }

  @Get('pump-candidates')
  @ApiOperation({ summary: 'Get symbols likely to pump (pre-pump signals)' })
  async getPumpCandidates(
    @Query('exchange') exchange?: ExchangeName,
  ): Promise<PreMoveSignalEntity[]> {
    return this.preMoveDetectorService.getActiveSignals('PUMP', exchange);
  }

  @Get('dump-candidates')
  @ApiOperation({ summary: 'Get symbols likely to dump (pre-dump signals)' })
  async getDumpCandidates(
    @Query('exchange') exchange?: ExchangeName,
  ): Promise<PreMoveSignalEntity[]> {
    return this.preMoveDetectorService.getActiveSignals('DUMP', exchange);
  }

  @Get('scan')
  @ApiOperation({ summary: 'Manually trigger pre-move scan' })
  async triggerScan(@Query('exchange') exchange?: ExchangeName) {
    const signals = await this.preMoveDetectorService.scanAllSymbols(exchange);
    return {
      message: 'Scan complete',
      count: signals.length,
      signals,
    };
  }

  @Get('debug')
  @ApiOperation({ summary: 'Debug: show liquidation data per symbol' })
  async debug() {
    return this.preMoveDetectorService.debugStatus();
  }
}
