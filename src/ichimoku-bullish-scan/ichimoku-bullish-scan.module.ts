import { Module } from '@nestjs/common';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { IchimokuBullishScanService } from './ichimoku-bullish-scan.service';
import { IchimokuBullishScanController } from './ichimoku-bullish-scan.controller';

@Module({
  imports: [MultiExchangeKlineModule, FuturesSymbolsModule],
  providers: [IchimokuBullishScanService],
  controllers: [IchimokuBullishScanController],
  exports: [IchimokuBullishScanService],
})
export class IchimokuBullishScanModule {}
