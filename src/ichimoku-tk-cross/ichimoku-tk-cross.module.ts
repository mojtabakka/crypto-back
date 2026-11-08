import { Module } from '@nestjs/common';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { VolumeMarketCapModule } from 'src/volume-marketcap/volume-marketcap.module';
import { IchimokuTkCrossService } from './ichimoku-tk-cross.service';
import { IchimokuTkCrossController } from './ichimoku-tk-cross.controller';

@Module({
  imports: [
    MultiExchangeKlineModule,
    FuturesSymbolsModule,
    VolumeMarketCapModule,
  ],
  providers: [IchimokuTkCrossService],
  controllers: [IchimokuTkCrossController],
  exports: [IchimokuTkCrossService],
})
export class IchimokuTkCrossModule {}
