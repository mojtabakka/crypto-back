import { Module } from '@nestjs/common';
import { BinanceModule } from 'src/binance/binance.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { IchimokuLaggingSpanService } from './ichimoku-lagging-span.service';
import { IchimokuLaggingSpanController } from './ichimoku-lagging-span.controller';

@Module({
  imports: [BinanceModule, FuturesSymbolsModule],
  providers: [IchimokuLaggingSpanService],
  controllers: [IchimokuLaggingSpanController],
  exports: [IchimokuLaggingSpanService],
})
export class IchimokuLaggingSpanModule {}
