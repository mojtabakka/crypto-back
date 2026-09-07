import { Module } from '@nestjs/common';

import { CryptocomService } from './cryptocom.service';

@Module({
  providers: [CryptocomService],
  exports: [CryptocomService],
})
export class CryptocomModule {}
