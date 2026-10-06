import { Controller, Get, Post, Query, UseGuards, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CorrelationService } from './correlation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('correlation')
@Controller('correlation')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CorrelationController {
  constructor(private readonly correlationService: CorrelationService) {}

  @Get('matrix')
  @ApiOperation({ summary: 'Get the latest correlation matrix and clusters' })
  async getMatrix() {
    const data = await this.correlationService.getLatest();
    return data ?? { message: 'No analysis yet. Trigger one to build it.' };
  }

  @Post('analyze')
  @ApiOperation({ summary: 'Recompute the correlation matrix' })
  @ApiQuery({ name: 'interval', example: '4h', required: false })
  @ApiQuery({ name: 'days', example: 30, required: false })
  async analyze(
    @Query('interval', new DefaultValuePipe('4h')) interval: string,
    @Query('days', new DefaultValuePipe('30')) days: string,
  ) {
    const lookback = Math.max(7, Math.min(180, parseInt(days, 10) || 30));
    return this.correlationService.analyze(interval, lookback);
  }

  @Get('insights')
  @ApiOperation({
    summary: 'Get concentration risk, diversification and rotation verdicts',
  })
  async getInsights() {
    const data = await this.correlationService.getInsights();
    return data;
  }
}