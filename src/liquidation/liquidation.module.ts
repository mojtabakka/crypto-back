import { Module } from '@nestjs/common';

import { LiquidationService } from './liquidation.service';
import { LiquidationController } from './liquidation.controller';

import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [RedisModule],

  providers: [LiquidationService],

  controllers: [LiquidationController],

  exports: [LiquidationService],
})
export class LiquidationModule {}
