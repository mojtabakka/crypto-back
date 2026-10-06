import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExecutorService } from './executor.service';
import { TradeStatus, TradeSide } from './entities/position.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('executor')
@Controller('executor')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ExecutorController {
  constructor(private readonly executorService: ExecutorService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get execution settings for the current user' })
  async getSettings(@CurrentUser() user: any) {
    const settings = await this.executorService.getSettings(user.username);

    return {
      ...settings,
      riskPerTrade: parseFloat(String(settings.riskPerTrade)),
      startingEquity: parseFloat(String(settings.startingEquity)),
    };
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update execution settings' })
  async updateSettings(@CurrentUser() user: any, @Body() body: any) {
    const settings = await this.executorService.updateSettings(user.username, body);

    return {
      ...settings,
      riskPerTrade: parseFloat(String(settings.riskPerTrade)),
      startingEquity: parseFloat(String(settings.startingEquity)),
    };
  }

  @Get('positions')
  @ApiOperation({ summary: 'List positions for the current user' })
  async getPositions(
    @CurrentUser() user: any,
    @Query('status') status?: TradeStatus,
  ) {
    return this.executorService.getPositions(user.username, status);
  }

  @Get('performance')
  @ApiOperation({ summary: 'Get trading performance summary' })
  async getPerformance(@CurrentUser() user: any) {
    return this.executorService.getPerformance(user.username);
  }

  @Get('candidates')
  @ApiOperation({ summary: 'List signals that currently qualify for entry' })
  async getCandidates(@CurrentUser() user: any) {
    return this.executorService.scanForEntries(user.username);
  }

  @Post('positions')
  @ApiOperation({ summary: 'Open a position manually' })
  async openPosition(@CurrentUser() user: any, @Body() body: any) {
    return this.executorService.openPosition(user.username, {
      symbol: String(body?.symbol ?? '').toUpperCase(),
      side: body?.side ?? TradeSide.LONG,
      score: Number(body?.score ?? 100),
      signal: String(body?.signal ?? 'MANUAL'),
    });
  }

  @Post('positions/:id/close')
  @ApiOperation({ summary: 'Close a single position at the current market price' })
  async closePosition(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.executorService.closePositionById(user.username, id);
  }

  @Post('tick')
  @ApiOperation({ summary: 'Run one execution cycle immediately' })
  async tick(@CurrentUser() user: any) {
    return this.executorService.tick(user.username);
  }

  @Post('close-all')
  @ApiOperation({ summary: 'Close every open position' })
  async closeAll(@CurrentUser() user: any) {
    return this.executorService.closeAllPositions(user.username);
  }
}