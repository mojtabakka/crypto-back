export interface MarketChartPoint {
  time: number;
  value: number;
}

export interface MarketChartData {
  price: MarketChartPoint[];
  openInterest: MarketChartPoint[];
  volume: MarketChartPoint[];
  funding: MarketChartPoint[];
}
