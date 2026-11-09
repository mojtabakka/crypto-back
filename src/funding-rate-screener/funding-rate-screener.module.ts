import { Module } from '@nestjs/common';
import { BinanceModule } from 'src/binance/binance.module';
import { FundingRateScreenerService } from './funding-rate-screener.service';
import { FundingRateScreenerController } from './funding-rate-screener.controller';

@Module({
  imports: [BinanceModule],
  providers: [FundingRateScreenerService],
  controllers: [FundingRateScreenerController],
  exports: [FundingRateScreenerService],
})
export class FundingRateScreenerModule {}
