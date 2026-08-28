import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { BinanceService } from './binance.service';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [HttpModule, RedisModule],
  providers: [BinanceService],
  exports: [BinanceService],
})
export class BinanceModule {}
