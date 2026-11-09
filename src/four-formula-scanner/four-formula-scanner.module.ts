import { Module } from '@nestjs/common';
import { MarketSignalModule } from 'src/market-signal/market-signal.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { FourFormulaScannerService } from './four-formula-scanner.service';
import { FourFormulaScannerController } from './four-formula-scanner.controller';

@Module({
  imports: [MarketSignalModule, FuturesSymbolsModule],
  providers: [FourFormulaScannerService],
  controllers: [FourFormulaScannerController],
  exports: [FourFormulaScannerService],
})
export class FourFormulaScannerModule {}
