import { IsString, Matches } from 'class-validator';

export class MarketSymbolDto {
  @IsString()
  @Matches(/^[A-Z0-9]{5,20}$/, {
    message: 'symbol must be a valid trading symbol',
  })
  symbol!: string;
}
