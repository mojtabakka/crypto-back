import { Module } from '@nestjs/common';
import { BinanceModule } from 'src/binance/binance.module';
import { BybitModule } from 'src/bybit/bybit.module';
import { ToobitModule } from 'src/toobit/toobit.module';

import { MultiExchangeKlineService } from './multi-exchange-kline.service';

@Module({
  imports: [BinanceModule, BybitModule, ToobitModule],
  providers: [MultiExchangeKlineService],
  exports: [MultiExchangeKlineService],
})
export class MultiExchangeKlineModule {}
