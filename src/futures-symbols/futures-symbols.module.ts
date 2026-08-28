import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FuturesSymbolsService } from './futures-symbols.service';
import { FuturesSymbolsController } from './futures-symbols.controller';
import { FuturesSymbolEntity } from './entities/futures-symbol.entity';

@Module({
  imports: [TypeOrmModule.forFeature([FuturesSymbolEntity])],
  providers: [FuturesSymbolsService],
  controllers: [FuturesSymbolsController],
  exports: [FuturesSymbolsService],
})
export class FuturesSymbolsModule {}
