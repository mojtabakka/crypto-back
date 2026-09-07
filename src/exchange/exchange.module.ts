import { Module } from '@nestjs/common';

import { ExchangeService } from './exchange.service';
import { ExchangeController } from './exchange.controller';
import { BinanceModule } from 'src/binance/binance.module';
import { OkxModule } from 'src/okx/okx.module';
import { BybitModule } from 'src/bybit/bybit.module';
import { MexcModule } from 'src/mexc/mexc.module';
import { KucoinModule } from 'src/kucoin/kucoin.module';
import { BingxModule } from 'src/bingx/bingx.module';
import { CryptocomModule } from 'src/cryptocom/cryptocom.module';
import { KlineModule } from 'src/kline/kline.module';

@Module({
  imports: [
    BinanceModule,
    OkxModule,
    BybitModule,
    MexcModule,
    KucoinModule,
    BingxModule,
    CryptocomModule,
    KlineModule,
  ],
  controllers: [ExchangeController],
  providers: [ExchangeService],
  exports: [ExchangeService],
})
export class ExchangeModule {}
