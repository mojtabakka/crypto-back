import { Module } from '@nestjs/common';
import { SignalsSuiteService } from './signals-suite.service';
import {
  CoinGlassController,
  DumpDetectorController,
  PressureScanController,
  PreMoveDetectorController,
  PumpDetectorController,
  SafeSellController,
} from './signals-suite.controllers';
import { AnalyticsModule } from 'src/analytics/analytics.module';
import { LiquidationModule } from 'src/liquidation/liquidation.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [AnalyticsModule, LiquidationModule, NotificationModule],
  providers: [SignalsSuiteService],
  controllers: [
    PumpDetectorController,
    DumpDetectorController,
    PreMoveDetectorController,
    SafeSellController,
    PressureScanController,
    CoinGlassController,
  ],
  exports: [SignalsSuiteService],
})
export class SignalsSuiteModule {}
