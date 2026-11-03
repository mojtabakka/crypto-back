import { Module } from '@nestjs/common';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { IchimokuLaggingSpanService } from './ichimoku-lagging-span.service';
import { IchimokuLaggingSpanController } from './ichimoku-lagging-span.controller';

@Module({
  imports: [MultiExchangeKlineModule, FuturesSymbolsModule],
  providers: [IchimokuLaggingSpanService],
  controllers: [IchimokuLaggingSpanController],
  exports: [IchimokuLaggingSpanService],
})
export class IchimokuLaggingSpanModule {}
