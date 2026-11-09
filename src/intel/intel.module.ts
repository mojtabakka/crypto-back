import { Module } from '@nestjs/common';
import { IntelService } from './intel.service';
import {
  ProtocolAnalysisController,
  TvlController,
  VolumeMarketCapController,
} from './intel.controllers';
import { AnalyticsModule } from 'src/analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  providers: [IntelService],
  controllers: [TvlController, ProtocolAnalysisController, VolumeMarketCapController],
  exports: [IntelService],
})
export class IntelModule {}
