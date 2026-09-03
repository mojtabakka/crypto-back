import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VolumeProfileService } from './volume-profile.service';
import { VolumeProfileController } from './volume-profile.controller';
import { VolumeProfileEntity } from './entities/volume-profile.entity';
import { KlineEntity } from 'src/kline/entities/kline.entity';
import { ExchangeModule } from 'src/exchange/exchange.module';
import { KlineModule } from 'src/kline/kline.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([VolumeProfileEntity, KlineEntity]),
    ExchangeModule,
    KlineModule,
  ],
  providers: [VolumeProfileService],
  controllers: [VolumeProfileController],
  exports: [VolumeProfileService],
})
export class VolumeProfileModule {}
