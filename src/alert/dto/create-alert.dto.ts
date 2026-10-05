import { IsString, IsNumber, IsEnum, IsOptional, IsDateString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertCondition } from '../entities/price-alert.entity';

export class CreateAlertDto {
  @ApiProperty({ example: 'BTCUSDT' })
  @IsString()
  symbol: string;

  @ApiProperty({ example: 50000 })
  @IsNumber()
  @Min(0)
  targetPrice: number;

  @ApiProperty({ enum: AlertCondition, example: AlertCondition.ABOVE })
  @IsEnum(AlertCondition)
  condition: AlertCondition;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ example: 'Buy the dip' })
  @IsOptional()
  @IsString()
  note?: string;
}
