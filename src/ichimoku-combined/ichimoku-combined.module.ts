import { Module } from '@nestjs/common';
import { BinanceModule } from 'src/binance/binance.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { IchimokuCombinedService } from './ichimoku-combined.service';
import { IchimokuCombinedController } from './ichimoku-combined.controller';

@Module({
  imports: [BinanceModule, FuturesSymbolsModule],
  providers: [IchimokuCombinedService],
  controllers: [IchimokuCombinedController],
  exports: [IchimokuCombinedService],
})
export class IchimokuCombinedModule {}
