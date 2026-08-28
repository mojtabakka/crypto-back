import { BinanceKline } from '../dto/binance-kline.type';
import { MarketCandleDto } from '../dto/market-candle.dto';

export function mapBinanceKlineToCandle(kline: BinanceKline): MarketCandleDto {
  return {
    time: kline[0],

    open: Number(kline[1]),

    high: Number(kline[2]),

    low: Number(kline[3]),

    close: Number(kline[4]),

    volume: Number(kline[5]),

    quoteVolume: Number(kline[7]),

    trades: kline[8],
  };
}
