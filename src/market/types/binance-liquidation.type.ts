export interface BinanceLiquidationOrder {
  symbol: string;

  side: 'BUY' | 'SELL';

  price: string;

  origQty: string;

  executedQty: string;

  averagePrice: string;

  status: string;

  timeInForce: string;

  type: string;

  clientOrderId: string;

  lastUpdateTime: number;
}
