import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AlertService } from './alert.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertDto } from './dto/update-alert.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AlertStatus } from './entities/price-alert.entity';

@ApiTags('alerts')
@Controller('alerts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AlertController {
  constructor(private readonly alertService: AlertService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new price alert' })
  async create(@CurrentUser() user: any, @Body() dto: CreateAlertDto) {
    return this.alertService.createAlert(user.username, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all alerts for current user' })
  @ApiQuery({ name: 'status', enum: AlertStatus, required: false })
  async getUserAlerts(
    @CurrentUser() user: any,
    @Query('status') status?: AlertStatus,
  ) {
    return this.alertService.getUserAlerts(user.username, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get alert by ID' })
  async getAlert(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.alertService.getAlertById(user.username, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an alert' })
  async update(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAlertDto,
  ) {
    return this.alertService.updateAlert(user.username, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an alert' })
  async delete(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.alertService.deleteAlert(user.username, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an active alert' })
  async cancel(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.alertService.cancelAlert(user.username, id);
  }
}