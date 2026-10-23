import { Module } from '@nestjs/common';
import { CoinGlassService } from './coinglass.service';
import { CoinGlassController } from './coinglass.controller';

@Module({
  providers: [CoinGlassService],
  controllers: [CoinGlassController],
  exports: [CoinGlassService],
})
export class CoinGlassModule {}
