export type SymbolOIDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

export type SymbolOIClassification =
  | 'LONG_BUILDUP'
  | 'SHORT_COVERING'
  | 'LONG_LIQUIDATION'
  | 'SHORT_BUILDUP'
  | 'NEUTRAL';

export interface SymbolOIStatus {
  symbol: string;
  price: number;
  priceChangePct: number;
  oiChangePct: number;
  classification: SymbolOIClassification;
  direction: SymbolOIDirection;
  lastUpdated: string;
  lookbackMinutes: number;
}

export interface SymbolOIMonitorParams {
  symbol: string;
  lookbackMinutes?: number;
}
