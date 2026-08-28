export class LiquidationDto {
  time!: number;

  symbol!: string;

  side!: 'LONG' | 'SHORT';

  quantity!: number;

  price!: number;

  value!: number;
}
