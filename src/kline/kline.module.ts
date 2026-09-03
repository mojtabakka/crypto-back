import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KlineService } from './kline.service';
import { KlineEntity } from './entities/kline.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KlineEntity])],
  providers: [KlineService],
  exports: [KlineService],
})
export class KlineModule {}
