import { Controller, Get, Query } from '@nestjs/common';
import { VolumeProfileScannerService } from './volume-profile-scanner.service';
import { VolumeProfileEntity } from './entities/volume-profile.entity';

@Controller('volume-profile')
export class VolumeProfileScannerController {
  constructor(private readonly scannerService: VolumeProfileScannerService) {}

  @Get('signals')
  async getSignals(
    @Query('interval') interval?: string,
  ): Promise<VolumeProfileEntity[]> {
    return this.scannerService.getLatestSignals(interval);
  }

  @Get('scan')
  async triggerScan(): Promise<{ message: string; count: number }> {
    const results = await this.scannerService.scanAllSymbols();
    return {
      message: 'Scan completed',
      count: results.length,
    };
  }
}
