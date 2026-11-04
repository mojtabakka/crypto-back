import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { VolumeMarketCapService } from './volume-marketcap.service';
import { VolumeMarketCapController } from './volume-marketcap.controller';
import { RedisModule } from '../redis/redis.module';
import { BinanceModule } from 'src/binance/binance.module';
import { BybitModule } from 'src/bybit/bybit.module';

@Module({
  imports: [HttpModule, RedisModule, BinanceModule, BybitModule],
  controllers: [VolumeMarketCapController],
  providers: [VolumeMarketCapService],
  exports: [VolumeMarketCapService],
})
export class VolumeMarketCapModule {}
