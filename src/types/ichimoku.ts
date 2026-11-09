export interface IchimokuConditions {
  priceAboveCloud: boolean;
  tenkanAboveKijun: boolean;
  chikouAbovePrice26: boolean;
  chikouClean: boolean;
  breakoutCandleClosed: boolean;
}

export interface IchimokuSignal {
  symbol: string;
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  chikou: number;
  signal: 'BUY' | 'NEUTRAL';
  conditions: IchimokuConditions;
  cloudTop: number;
  cloudBottom: number;
}

export interface IchimokuLaggingSpanSignal {
  symbol: string;
  price: number;
  chikouValue: number;
  crossCandleIndex: number;
  crossTime: number;
  crossPriceHigh: number;
  barsAgo: number;
  signal: 'BUY';
}

export interface IchimokuCombinedSignal {
  symbol: string;
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
  chikouValue: number;
  crossPriceHigh: number;
  barsAgo: number;
  signal: 'BUY';
}
