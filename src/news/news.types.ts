import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export interface CryptoNewsItem {
  id: string;

  title: string;

  description: string;

  source: string;

  sourceImageUrl?: string;

  url: string;

  publishedOn: number;

  tags: string;

  categories: string;

  originalImageUrl?: string;
}

export interface CryptoEventItem {
  id: string;

  title: string;

  description: string;

  source: string;

  url: string;

  publishedOn: number;

  tags: string;

  coinName: string;

  coinSymbol: string;
}

export interface CryptoEventResponse {
  status: 'success' | 'error';

  hasWarning: boolean;

  message: string;

  data: CryptoEventItem[];
}

export interface CryptoNewsResponse {
  status: 'success' | 'error';

  hasWarning: boolean;

  message: string;

  data: CryptoNewsItem[];
}

// Validation decorators are required: the global ValidationPipe runs with
// `whitelist` + `forbidNonWhitelisted`, so a DTO with only Swagger metadata
// rejects every query parameter it receives with HTTP 400.
export class NewsQueryDto {
  @ApiProperty({ required: false, example: 'BTC' })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiProperty({ required: false, example: 'en' })
  @IsOptional()
  @IsString()
  lang?: string;

  @ApiProperty({ required: false, default: 50, example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class EventsQueryDto {
  @ApiProperty({ required: false, example: 'BTC' })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiProperty({ required: false, default: 50, example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiProperty({ required: false, example: 'en' })
  @IsOptional()
  @IsString()
  lang?: string;
}

export interface TradingViewNewsItem {
  id: string;
  title: string;
  description: string;
  source: string;
  url: string;
  publishedOn: number;
  publishedOnShamsi?: string;
  tags: string;
  imageUrl: string;
}

export interface TradingViewNewsResponse {
  status: 'success' | 'error';
  hasWarning: boolean;
  message: string;
  symbol: string;
  data: TradingViewNewsItem[];
}

export class TradingViewNewsQueryDto {
  @ApiProperty({ required: true, example: 'BTCUSDT' })
  symbol: string;

  @ApiProperty({ required: false, default: 20, example: 20 })
  limit?: number;
}

export interface TradingViewRawItem {
  id: string;
  title: string;
  description?: string;
  short_description?: string;
  source?: string;
  url?: string;
  link?: string;
  story_path?: string;
  published?: number;
  related_symbols?: Array<{ symbol: string }>;
  thumbnail?: { url: string };
  avatar_url?: string;
}

export interface TradingViewRawResponse {
  items: TradingViewRawItem[];
}
