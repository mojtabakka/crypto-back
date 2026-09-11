import { Module } from '@nestjs/common';

import { LbankService } from './lbank.service';

@Module({
  providers: [LbankService],
  exports: [LbankService],
})
export class LbankModule {}
