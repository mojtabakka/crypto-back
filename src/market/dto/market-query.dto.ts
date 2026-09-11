import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class MarketQueryDto {
  @IsString()
  @IsIn([
    '1m',
    '3m',
    '5m',
    '15m',
    '30m',
    '1h',
    '2h',
    '4h',
    '6h',
    '8h',
    '12h',
    '1d',
  ])
  interval: string = '15m';

  @IsString()
  @Matches(/^\d+(h|d)$/, {
    message: 'range must be like 24h, 48h, 7d or 30d',
  })
  range: string = '24h';

  @IsOptional()
  @IsString()
  @IsIn([
    'BINANCE',
    'OKX',
    'BYBIT',
    'MEXC',
    'KUCOIN',
    'BINGX',
    'CRYPTOCOM',
    'TOOBIT',
    'LBANK',
  ])
  exchange?: string = 'BINANCE';
}
