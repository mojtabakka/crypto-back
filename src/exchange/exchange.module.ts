import { Module } from '@nestjs/common';

import { ExchangeService } from './exchange.service';
import { BinanceModule } from 'src/binance/binance.module';
import { KlineModule } from 'src/kline/kline.module';
import { OkxModule } from 'src/okx/okx.module';
import { BybitModule } from 'src/bybit/bybit.module';
import { MexcModule } from 'src/mexc/mexc.module';

@Module({
  imports: [BinanceModule, KlineModule, OkxModule, BybitModule, MexcModule],
  providers: [ExchangeService],
  exports: [ExchangeService],
})
export class ExchangeModule {}