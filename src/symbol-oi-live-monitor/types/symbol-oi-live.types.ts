export type LiveOIDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

export type LiveOIClassification =
  | 'LONG_BUILDUP'
  | 'SHORT_COVERING'
  | 'LONG_LIQUIDATION'
  | 'SHORT_BUILDUP'
  | 'NEUTRAL';

export interface LiveOIStatus {
  symbol: string;
  price: number;
  priceChangePct: number;
  oiChangePct: number;
  classification: LiveOIClassification;
  direction: LiveOIDirection;
  lastUpdated: string;
}

export interface LiveOMonitorSubscribe {
  symbol: string;
}

export interface LiveOMonitorUnsubscribe {
  symbol: string;
}
