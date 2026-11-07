import { Module } from '@nestjs/common';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { VolumeMarketCapModule } from 'src/volume-marketcap/volume-marketcap.module';
import { IchimokuCloudBottomTouchService } from './ichimoku-cloud-bottom-touch.service';
import { IchimokuCloudBottomTouchController } from './ichimoku-cloud-bottom-touch.controller';

@Module({
  imports: [
    MultiExchangeKlineModule,
    FuturesSymbolsModule,
    VolumeMarketCapModule,
  ],
  providers: [IchimokuCloudBottomTouchService],
  controllers: [IchimokuCloudBottomTouchController],
  exports: [IchimokuCloudBottomTouchService],
})
export class IchimokuCloudBottomTouchModule {}
