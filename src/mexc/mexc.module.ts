import { Module } from '@nestjs/common';

import { MexcService } from './mexc.service';

@Module({
  providers: [MexcService],
  exports: [MexcService],
})
export class MexcModule {}
