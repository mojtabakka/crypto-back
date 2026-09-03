import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { OkxService } from './okx.service';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [HttpModule, RedisModule],
  providers: [OkxService],
  exports: [OkxService],
})
export class OkxModule {}
