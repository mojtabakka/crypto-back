import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { ToobitService } from './toobit.service';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [HttpModule, RedisModule],
  providers: [ToobitService],
  exports: [ToobitService],
})
export class ToobitModule {}
