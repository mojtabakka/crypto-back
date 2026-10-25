import { Controller, Get, Query } from '@nestjs/common';
import { PressureScanService } from './pressure-scan.service';

@Controller('pressure-scan')
export class PressureScanController {
  constructor(private readonly pressureScanService: PressureScanService) {}

  @Get()
  async scan(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 100;
    return this.pressureScanService.scanForPressure(parsedLimit);
  }
}
