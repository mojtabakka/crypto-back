import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { NewListingsService } from './new-listings.service';
import { NewListingEntity } from './entities/new-listing.entity';
import type { ListingStatus } from './entities/new-listing.entity';

@ApiTags('new-listings')
@Controller('new-listings')
export class NewListingsController {
  constructor(private readonly newListingsService: NewListingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all new listings with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  async getAllListings(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: ListingStatus,
  ) {
    return this.newListingsService.getAllListings(
      page ?? 1,
      limit ?? 20,
      status,
    );
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Get upcoming listings (future dates only)' })
  async getUpcomingListings(): Promise<NewListingEntity[]> {
    return this.newListingsService.getUpcomingListings();
  }

  @Get('recent')
  @ApiOperation({ summary: 'Get recent listings from last N days' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async getRecentListings(
    @Query('days') days?: number,
  ): Promise<NewListingEntity[]> {
    return this.newListingsService.getRecentListings(days ?? 30);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get listings by status' })
  @ApiQuery({ name: 'status', required: false, type: String })
  async getListingsByStatus(
    @Query('status') status?: ListingStatus,
  ): Promise<NewListingEntity[]> {
    return this.newListingsService.getListingsByStatus(status ?? 'UPCOMING');
  }

  @Get('fetch')
  @ApiOperation({ summary: 'Manually trigger fetch new listings' })
  async fetchNewListings() {
    const listings = await this.newListingsService.fetchNewListings();
    return {
      message: 'Fetch completed',
      count: listings.length,
      listings,
    };
  }
}
