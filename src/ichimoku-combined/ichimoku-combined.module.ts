import { Module } from '@nestjs/common';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { VolumeMarketCapModule } from 'src/volume-marketcap/volume-marketcap.module';
import { IchimokuCombinedService } from './ichimoku-combined.service';
import { IchimokuCombinedController } from './ichimoku-combined.controller';

@Module({
  imports: [
    MultiExchangeKlineModule,
    FuturesSymbolsModule,
    VolumeMarketCapModule,
  ],
  providers: [IchimokuCombinedService],
  controllers: [IchimokuCombinedController],
  exports: [IchimokuCombinedService],
})
export class IchimokuCombinedModule {}
