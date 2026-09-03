import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { BybitService } from './bybit.service';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [HttpModule, RedisModule],
  providers: [BybitService],
  exports: [BybitService],
})
export class BybitModule {}
