import { Module } from '@nestjs/common';

import { LiquidationService } from './liquidation.service';

import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [RedisModule],

  providers: [LiquidationService],

  exports: [LiquidationService],
})
export class LiquidationModule {}
