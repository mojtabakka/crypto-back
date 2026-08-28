import { OpenInterestDto } from '../dto/open-interest.dto';
import { BinanceOpenInterest } from '../types/binance-open-interest.type';

export function mapOpenInterest(item: BinanceOpenInterest): OpenInterestDto {
  return {
    time: item.timestamp,
    openInterest: Number(item.sumOpenInterest),
    openInterestValue: Number(item.sumOpenInterestValue),
  };
}
