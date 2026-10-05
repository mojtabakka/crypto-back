import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SentimentSource } from '../entities/sentiment-analysis.entity';

export class AnalyzeSentimentDto {
  @ApiProperty({ example: 'BTCUSDT' })
  @IsString()
  symbol: string;

  @ApiPropertyOptional({ enum: SentimentSource, default: SentimentSource.OVERALL })
  @IsOptional()
  @IsEnum(SentimentSource)
  source?: SentimentSource;
}
