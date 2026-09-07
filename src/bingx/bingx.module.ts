import { Module } from '@nestjs/common';

import { BingxService } from './bingx.service';

@Module({
  providers: [BingxService],
  exports: [BingxService],
})
export class BingxModule {}
