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
import { ToobitModule } from 'src/toobit/toobit.module';
import { LbankModule } from 'src/lbank/lbank.module';
import { OrbitModule } from 'src/orbit/orbit.module';
import { KlineModule } from 'src/kline/kline.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    BinanceModule,
    OkxModule,
    BybitModule,
    MexcModule,
    KucoinModule,
    BingxModule,
    CryptocomModule,
    ToobitModule,
    LbankModule,
    OrbitModule,
    KlineModule,
    NotificationModule,
  ],
  controllers: [ExchangeController],
  providers: [ExchangeService],
  exports: [ExchangeService],
})
export class ExchangeModule {}
