import {
  Controller,
  Get,
  Query,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { VolumeProfileService } from './volume-profile.service';

@Controller('volume-profile')
export class VolumeProfileController {
  constructor(private readonly volumeProfileService: VolumeProfileService) {}

  @Get(':symbol')
  async getVolumeProfile(
    @Param('symbol') symbol: string,
    @Query('interval') interval = '1d',
    @Query('lookback') lookback = 100,
  ) {
    try {
      return await this.volumeProfileService.calculateVolumeProfile(
        symbol,
        interval,
        lookback,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(
        { error: message, symbol, interval },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':symbol/latest')
  async getLatestProfile(
    @Param('symbol') symbol: string,
    @Query('interval') interval = '1d',
  ) {
    return this.volumeProfileService.getLatestProfile(symbol, interval);
  }
}
