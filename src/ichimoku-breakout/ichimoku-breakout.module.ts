import { Module } from '@nestjs/common';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { VolumeMarketCapModule } from 'src/volume-marketcap/volume-marketcap.module';
import { IchimokuBreakoutService } from './ichimoku-breakout.service';
import { IchimokuBreakoutController } from './ichimoku-breakout.controller';

@Module({
  imports: [
    MultiExchangeKlineModule,
    FuturesSymbolsModule,
    VolumeMarketCapModule,
  ],
  providers: [IchimokuBreakoutService],
  controllers: [IchimokuBreakoutController],
  exports: [IchimokuBreakoutService],
})
export class IchimokuBreakoutModule {}
