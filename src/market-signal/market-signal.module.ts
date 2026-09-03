import { Module } from '@nestjs/common';
import { MarketSignalService } from './market-signal.service';
import { ExchangeModule } from 'src/exchange/exchange.module';
import { MarketSignalController } from './market-signal.controller';
import { LiquidationModule } from 'src/liquidation/liquidation.module';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [ExchangeModule, LiquidationModule, RedisModule],

  providers: [MarketSignalService],

  exports: [MarketSignalService],

  controllers: [MarketSignalController],
})
export class MarketSignalModule {}
