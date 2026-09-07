import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LoggerService } from './logger.service';

@ApiTags('logs')
@Controller('logs')
export class LoggerController {
  constructor(private readonly loggerService: LoggerService) {}

  @Get('recent')
  @ApiOperation({ summary: 'Get recent log entries' })
  @ApiQuery({ name: 'level', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  async getRecentLogs(
    @Query('level') level?: string,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.loggerService.getRecentLogs({
      level,
      limit: limit ?? 100,
      search,
    });
  }

  @Get('errors')
  @ApiOperation({ summary: 'Get recent error logs' })
  async getErrorLogs() {
    return this.loggerService.getRecentLogs({ level: 'error', limit: 100 });
  }

  @Get('exchange')
  @ApiOperation({ summary: 'Get exchange-related logs' })
  async getExchangeLogs() {
    return this.loggerService.getRecentLogs({
      search: 'Exchange',
      limit: 100,
    });
  }
}
