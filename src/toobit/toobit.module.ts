import { Module } from '@nestjs/common';

import { ToobitService } from './toobit.service';

@Module({
  providers: [ToobitService],
  exports: [ToobitService],
})
export class ToobitModule {}
