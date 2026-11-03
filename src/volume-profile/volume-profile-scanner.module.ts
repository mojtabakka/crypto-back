import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VolumeProfileScannerService } from './volume-profile-scanner.service';
import { VolumeProfileScannerController } from './volume-profile-scanner.controller';
import { VolumeProfileEntity } from './entities/volume-profile.entity';
import { KlineEntity } from 'src/kline/entities/kline.entity';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { ExchangeModule } from 'src/exchange/exchange.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([VolumeProfileEntity, KlineEntity]),
    FuturesSymbolsModule,
    ExchangeModule,
    NotificationModule,
  ],
  controllers: [VolumeProfileScannerController],
  providers: [VolumeProfileScannerService],
  exports: [VolumeProfileScannerService],
})
export class VolumeProfileScannerModule {}
