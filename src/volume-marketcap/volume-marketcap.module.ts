import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { VolumeMarketCapService } from './volume-marketcap.service';
import { VolumeMarketCapController } from './volume-marketcap.controller';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [HttpModule, RedisModule],
  controllers: [VolumeMarketCapController],
  providers: [VolumeMarketCapService],
  exports: [VolumeMarketCapService],
})
export class VolumeMarketCapModule {}
