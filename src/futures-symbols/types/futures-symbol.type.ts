export interface BinanceFuturesSymbol {
  symbol: string;
  pair: string;
  contractType: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  deliveryDate: number | null;
  onboardDate: number | null;
}

export interface FuturesSymbolsResponse {
  symbols: BinanceFuturesSymbol[];
  total: number;
  fetchedAt: string;
}
