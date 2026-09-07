import { Module } from '@nestjs/common';

import { KucoinService } from './kucoin.service';

@Module({
  providers: [KucoinService],
  exports: [KucoinService],
})
export class KucoinModule {}
