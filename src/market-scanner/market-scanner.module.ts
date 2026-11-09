import { Module } from '@nestjs/common';
import { MarketScannerService } from './market-scanner.service';
import { MarketScannerController } from './market-scanner.controller';
import { MarketSignalModule } from 'src/market-signal/market-signal.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { ExchangeModule } from 'src/exchange/exchange.module';
import { NotificationModule } from 'src/notification/notification.module';
import { ScannerExtrasService } from './scanner-extras.service';
import { AnalyticsModule } from 'src/analytics/analytics.module';
import { LiquidationModule } from 'src/liquidation/liquidation.module';

@Module({
  imports: [
    MarketSignalModule,
    FuturesSymbolsModule,
    ExchangeModule,
    NotificationModule,
    AnalyticsModule,
    LiquidationModule,
  ],
  providers: [MarketScannerService, ScannerExtrasService],
  controllers: [MarketScannerController],
  exports: [MarketScannerService],
})
export class MarketScannerModule {}
