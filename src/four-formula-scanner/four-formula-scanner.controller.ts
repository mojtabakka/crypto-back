import { Controller, Get, Query } from '@nestjs/common';
import { FourFormulaScannerService } from './four-formula-scanner.service';
import type {
  FourFormulaScanParams,
  FourFormulaScanResult,
} from './types/four-formula-scanner.types';

@Controller('four-formula-scan')
export class FourFormulaScannerController {
  constructor(private readonly scanner: FourFormulaScannerService) {}

  @Get()
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
    @Query('direction') direction?: 'LONG' | 'SHORT' | 'ALL',
    @Query('minScore') minScore?: string,
  ): Promise<FourFormulaScanResult> {
    return this.scanner.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      exchange,
      direction,
      minScore: minScore ? Number(minScore) : undefined,
    });
  }
}
