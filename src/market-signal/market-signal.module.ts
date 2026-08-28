import { Module } from '@nestjs/common';
import { MarketSignalService } from './market-signal.service';
import { BinanceModule } from 'src/binance/binance.module';
import { MarketSignalController } from './market-signal.controller';
import { LiquidationModule } from 'src/liquidation/liquidation.module';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [BinanceModule, LiquidationModule, RedisModule],

  providers: [MarketSignalService],

  exports: [MarketSignalService],

  controllers: [MarketSignalController],
})
export class MarketSignalModule {}
