import { Controller, Get, Post, Query } from '@nestjs/common';
import { WeeklyEma21SignalService } from './weekly-ema21-signal.service';
import type { Ema21Strength } from './entities/weekly-ema21-signal.entity';

@Controller('weekly-ema21-signals')
export class WeeklyEma21SignalController {
  constructor(
    private readonly weeklyEma21SignalService: WeeklyEma21SignalService,
  ) {}

  @Get()
  async getLatestSignals(
    @Query('exchange') exchange?: string,
    @Query('minPriceVsEma21') minPriceVsEma21?: string,
  ) {
    return this.weeklyEma21SignalService.getLatestSignals(
      exchange ?? 'BINANCE',
      parseFloat(minPriceVsEma21 ?? '0'),
    );
  }

  @Get('by-strength')
  async getSignalsByStrength(
    @Query('strength') strength: Ema21Strength,
    @Query('exchange') exchange?: string,
  ) {
    if (
      !strength ||
      !['JUST_ABOVE', 'ABOVE', 'STRONG', 'EXTREME'].includes(strength)
    ) {
      return {
        error: 'Invalid strength. Use JUST_ABOVE, ABOVE, STRONG, or EXTREME',
      };
    }
    return this.weeklyEma21SignalService.getSignalsByStrength(
      strength,
      exchange ?? 'BINANCE',
    );
  }

  @Post('scan')
  async triggerScan(@Query('exchange') exchange?: string) {
    return this.weeklyEma21SignalService.scanAndStoreSignals(
      exchange ?? 'BINANCE',
    );
  }
}
