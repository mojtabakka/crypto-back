import { Module } from '@nestjs/common';
import { IchimokuCombinedModule } from 'src/ichimoku-combined/ichimoku-combined.module';
import { BinanceModule } from 'src/binance/binance.module';
import { IchimokuOiScreenerService } from './ichimoku-oi-screener.service';
import { IchimokuOiScreenerController } from './ichimoku-oi-screener.controller';

@Module({
  imports: [IchimokuCombinedModule, BinanceModule],
  providers: [IchimokuOiScreenerService],
  controllers: [IchimokuOiScreenerController],
  exports: [IchimokuOiScreenerService],
})
export class IchimokuOiScreenerModule {}
