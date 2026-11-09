import { Module } from '@nestjs/common';
import { IchimokuService } from './ichimoku.service';
import {
  IchimokuCombinedController,
  IchimokuLaggingSpanController,
  IchimokuScannerController,
} from './ichimoku.controllers';
import { AnalyticsModule } from 'src/analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  providers: [IchimokuService],
  controllers: [
    IchimokuScannerController,
    IchimokuLaggingSpanController,
    IchimokuCombinedController,
  ],
  exports: [IchimokuService],
})
export class IchimokuModule {}
