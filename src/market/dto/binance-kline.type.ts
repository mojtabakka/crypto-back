export type BinanceKline = [
  number, // open time
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // close time
  string, // quote volume
  number, // number of trades
  string, // taker buy base asset volume
  string, // taker buy quote asset volume
  string, // ignore
];
