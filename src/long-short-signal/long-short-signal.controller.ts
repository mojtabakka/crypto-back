import { Controller, Get } from '@nestjs/common';
import { LongShortSignalService } from './long-short-signal.service';

@Controller('long-short-signals')
export class LongShortSignalController {
  constructor(
    private readonly longShortSignalService: LongShortSignalService,
  ) {}

  @Get()
  async getLatestSignals() {
    return this.longShortSignalService.getLatestSignals();
  }

  @Get('longs')
  async getLongSignals() {
    return this.longShortSignalService.getLongSignals();
  }

  @Get('shorts')
  async getShortSignals() {
    return this.longShortSignalService.getShortSignals();
  }
}
