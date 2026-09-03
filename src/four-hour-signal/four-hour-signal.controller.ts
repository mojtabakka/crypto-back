import { Controller, Get, Query } from '@nestjs/common';
import { FourHourSignalService } from './four-hour-signal.service';
import type {
  SignalType,
  SignalDirection,
} from './entities/four-hour-signal.entity';

@Controller('four-hour-signals')
export class FourHourSignalController {
  constructor(private readonly fourHourSignalService: FourHourSignalService) {}

  @Get()
  async getLatestSignals() {
    return this.fourHourSignalService.getLatestSignals();
  }

  @Get('by-type')
  async getSignalsByType(@Query('type') type: SignalType) {
    if (!type || !['PULLBACK', 'REAPPROACH'].includes(type)) {
      return { error: 'Invalid type. Use PULLBACK or REAPPROACH' };
    }
    return this.fourHourSignalService.getSignalsByType(type);
  }

  @Get('by-direction')
  async getSignalsByDirection(@Query('direction') direction: SignalDirection) {
    if (!direction || !['BULLISH', 'BEARISH'].includes(direction)) {
      return { error: 'Invalid direction. Use BULLISH or BEARISH' };
    }
    return this.fourHourSignalService.getSignalsByDirection(direction);
  }
}
