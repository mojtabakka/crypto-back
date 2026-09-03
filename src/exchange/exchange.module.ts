import { Module } from '@nestjs/common';

import { ExchangeService } from './exchange.service';
import { BinanceModule } from 'src/binance/binance.module';
import { KlineModule } from 'src/kline/kline.module';

@Module({
  imports: [BinanceModule, KlineModule],
  providers: [ExchangeService],
  exports: [ExchangeService],
})
export class ExchangeModule {}
