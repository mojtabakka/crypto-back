import { IsNumber, IsEnum, IsOptional, IsDateString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AlertCondition, AlertStatus } from '../entities/price-alert.entity';

export class UpdateAlertDto {
  @ApiPropertyOptional({ example: 55000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetPrice?: number;

  @ApiPropertyOptional({ enum: AlertCondition })
  @IsOptional()
  @IsEnum(AlertCondition)
  condition?: AlertCondition;

  @ApiPropertyOptional({ enum: AlertStatus })
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ example: 'Updated note' })
  @IsOptional()
  note?: string;
}
