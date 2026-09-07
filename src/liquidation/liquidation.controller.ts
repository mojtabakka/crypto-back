import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { LiquidationService } from './liquidation.service';

@ApiTags('liquidation')
@Controller('liquidation')
export class LiquidationController {
  constructor(private readonly liquidationService: LiquidationService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get liquidation WebSocket connection status' })
  getStatus() {
    return this.liquidationService.getStatus();
  }
}
