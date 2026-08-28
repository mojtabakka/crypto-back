import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { FuturesSymbolEntity } from './entities/futures-symbol.entity';
import { FuturesSymbolsResponse } from './types/futures-symbol.type';

@Injectable()
export class FuturesSymbolsService {
  private readonly logger = new Logger(FuturesSymbolsService.name);
  private readonly futuresBaseUrl = 'https://fapi.binance.com';

  constructor(
    @InjectRepository(FuturesSymbolEntity)
    private readonly symbolRepository: Repository<FuturesSymbolEntity>,
  ) {}

  async fetchAndStoreSymbols(): Promise<FuturesSymbolsResponse> {
    this.logger.log('Fetching futures symbols from Binance...');

    const response = await axios.get<{
      symbols: BinanceFinanceFuturesSymbol[];
    }>(`${this.futuresBaseUrl}/fapi/v1/exchangeInfo`);

    const symbols = response.data.symbols.map((s) => ({
      symbol: s.symbol,
      pair: s.pair,
      contractType: s.contractType,
      status: s.status,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      marginAsset: s.marginAsset,
      pricePrecision: s.pricePrecision,
      quantityPrecision: s.quantityPrecision,
      deliveryDate: s.deliveryDate ?? null,
      onboardDate: s.onboardDate ?? null,
    }));

    await this.symbolRepository.clear();

    const entities = symbols.map((s) => this.symbolRepository.create(s));
    await this.symbolRepository.save(entities);

    this.logger.log(`Stored ${symbols.length} futures symbols in MySQL`);

    return {
      symbols,
      total: symbols.length,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getStoredSymbols(): Promise<FuturesSymbolsResponse> {
    const entities = await this.symbolRepository.find();

    const symbols = entities.map((e) => ({
      symbol: e.symbol,
      pair: e.pair,
      contractType: e.contractType,
      status: e.status,
      baseAsset: e.baseAsset,
      quoteAsset: e.quoteAsset,
      marginAsset: e.marginAsset,
      pricePrecision: e.pricePrecision,
      quantityPrecision: e.quantityPrecision,
      deliveryDate: e.deliveryDate,
      onboardDate: e.onboardDate,
    }));

    return {
      symbols,
      total: symbols.length,
      fetchedAt:
        entities.length > 0
          ? entities[0].createdAt.toISOString()
          : new Date().toISOString(),
    };
  }
}

type BinanceFinanceFuturesSymbol = {
  symbol: string;
  pair: string;
  contractType: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  deliveryDate?: number;
  onboardDate?: number;
};
