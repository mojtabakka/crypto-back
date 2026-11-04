import { Module } from '@nestjs/common';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { VolumeMarketCapModule } from 'src/volume-marketcap/volume-marketcap.module';
import { NotificationModule } from 'src/notification/notification.module';
import { IchimokuChikouPullbackService } from './ichimoku-chikou-pullback.service';
import { IchimokuChikouPullbackController } from './ichimoku-chikou-pullback.controller';

@Module({
  imports: [
    MultiExchangeKlineModule,
    FuturesSymbolsModule,
    VolumeMarketCapModule,
    NotificationModule,
  ],
  providers: [IchimokuChikouPullbackService],
  controllers: [IchimokuChikouPullbackController],
  exports: [IchimokuChikouPullbackService],
})
export class IchimokuChikouPullbackModule {}
