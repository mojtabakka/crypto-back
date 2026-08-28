import { FundingRateDto } from '../dto/funding-rate.dto';
import { BinanceFundingRate } from '../types/binance-funding-rate.type';

export function mapFundingRate(item: BinanceFundingRate): FundingRateDto {
  return {
    time: item.fundingTime,

    fundingRate: Number(item.fundingRate),
  };
}
