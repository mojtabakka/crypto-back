import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NewListingsService } from './new-listings.service';
import { NewListingsController } from './new-listings.controller';
import { NewListingEntity } from './entities/new-listing.entity';
import { FuturesSymbolEntity } from 'src/futures-symbols/entities/futures-symbol.entity';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NewListingEntity, FuturesSymbolEntity]),
    NotificationModule,
  ],
  controllers: [NewListingsController],
  providers: [NewListingsService],
  exports: [NewListingsService],
})
export class NewListingsModule {}
