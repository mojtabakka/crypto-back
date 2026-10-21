import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { MexcService } from './mexc.service';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [HttpModule, RedisModule],
  providers: [MexcService],
  exports: [MexcService],
})
export class MexcModule {}