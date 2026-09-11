import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { FuturesSymbolEntity } from './entities/futures-symbol.entity';
import {
  BinanceFuturesSymbol,
  FuturesSymbolsResponse,
} from './types/futures-symbol.type';
import type { ExchangeName } from 'src/exchange/exchange.service';

@Injectable()
export class FuturesSymbolsService {
  private readonly logger = new Logger(FuturesSymbolsService.name);
  private readonly futuresBaseUrl = 'https://fapi.binance.com';
  private mexcSymbolsCache: {
    symbols: BinanceFuturesSymbol[];
    fetchedAt: number;
  } | null = null;
  private readonly mexcSymbolsCacheTtl = 5 * 60 * 1000;
  private readonly mexcSymbolLimit = 100;

  constructor(
    @InjectRepository(FuturesSymbolEntity)
    private readonly symbolRepository: Repository<FuturesSymbolEntity>,
  ) {}

  async fetchAndStoreSymbols(
    exchange: ExchangeName = 'BINANCE',
  ): Promise<FuturesSymbolsResponse> {
    if (exchange === 'MEXC') {
      return this.fetchMexcSymbols();
    }
    if (exchange === 'TOOBIT') {
      return this.fetchToobitSymbols();
    }
    if (exchange === 'LBANK') {
      return this.fetchLbankSymbols();
    }
    if (exchange === 'ORBIT') {
      return this.fetchOrbitSymbols();
    }

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

  async getStoredSymbols(
    exchange: ExchangeName = 'BINANCE',
  ): Promise<FuturesSymbolsResponse> {
    if (exchange === 'MEXC') {
      return this.getMexcSymbols();
    }
    if (exchange === 'TOOBIT') {
      return this.fetchToobitSymbols();
    }
    if (exchange === 'LBANK') {
      return this.fetchLbankSymbols();
    }
    if (exchange === 'ORBIT') {
      return this.fetchOrbitSymbols();
    }

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

  private async getMexcSymbols(): Promise<FuturesSymbolsResponse> {
    if (
      this.mexcSymbolsCache &&
      Date.now() - this.mexcSymbolsCache.fetchedAt < this.mexcSymbolsCacheTtl
    ) {
      return {
        symbols: this.mexcSymbolsCache.symbols,
        total: this.mexcSymbolsCache.symbols.length,
        fetchedAt: new Date(this.mexcSymbolsCache.fetchedAt).toISOString(),
      };
    }

    const result = await this.fetchMexcSymbols();
    this.mexcSymbolsCache = {
      symbols: result.symbols,
      fetchedAt: Date.now(),
    };
    return result;
  }

  private async fetchMexcSymbols(): Promise<FuturesSymbolsResponse> {
    this.logger.log('Fetching futures symbols from MEXC...');

    const [detailResponse, tickerResponse, binanceResponse] = await Promise.all(
      [
        axios.get<{
          success: boolean;
          code: number;
          data: MexcContractDetail[];
        }>('https://contract.mexc.com/api/v1/contract/detail', {
          timeout: 10000,
        }),
        axios.get<{
          success: boolean;
          code: number;
          data: MexcTicker[];
        }>('https://contract.mexc.com/api/v1/contract/ticker', {
          timeout: 10000,
        }),
        this.symbolRepository.find({ select: ['symbol'] }),
      ],
    );

    const binanceSymbols = new Set(
      binanceResponse
        .map((entity) => entity.symbol)
        .filter((symbol) => symbol.endsWith('USDT')),
    );
    const tickerVolumes = new Map(
      (tickerResponse.data?.data ?? []).map((ticker) => [
        ticker.symbol.replace(/_USDT$/, 'USDT'),
        Number(ticker.volume24 ?? 0),
      ]),
    );

    const normalized = (detailResponse.data?.data ?? [])
      .filter(
        (contract) =>
          contract.state === 0 &&
          contract.quoteCoin === 'USDT' &&
          contract.futureType === 1 &&
          contract.apiAllowed !== false,
      )
      .map((contract) => {
        const symbol = contract.symbol.replace(/_USDT$/, 'USDT');
        return {
          symbol,
          pair: symbol,
          contractType: 'PERPETUAL',
          status: 'TRADING',
          baseAsset: contract.baseCoin,
          quoteAsset: contract.quoteCoin,
          marginAsset: contract.settleCoin ?? contract.quoteCoin,
          pricePrecision: Number(contract.priceScale ?? 0),
          quantityPrecision: Number(contract.volScale ?? 0),
          deliveryDate: null,
          onboardDate: contract.openingTime || contract.createTime || null,
        };
      })
      .filter(
        (symbol) =>
          binanceSymbols.size === 0 || binanceSymbols.has(symbol.symbol),
      );

    const shared = normalized
      .filter((symbol) => binanceSymbols.has(symbol.symbol))
      .sort(
        (a, b) =>
          (tickerVolumes.get(b.symbol) ?? 0) -
          (tickerVolumes.get(a.symbol) ?? 0),
      );
    const additional = normalized
      .filter((symbol) => !binanceSymbols.has(symbol.symbol))
      .sort(
        (a, b) =>
          (tickerVolumes.get(b.symbol) ?? 0) -
          (tickerVolumes.get(a.symbol) ?? 0),
      );
    const symbols = [...shared, ...additional].slice(0, this.mexcSymbolLimit);

    this.logger.log(`Fetched ${symbols.length} MEXC futures symbols`);

    return {
      symbols,
      total: symbols.length,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchToobitSymbols(): Promise<FuturesSymbolsResponse> {
    try {
      const response = await axios.get<{
        contracts?: ToobitContract[];
      }>('https://api.toobit.com/api/v1/exchangeInfo', { timeout: 10000 });

      const symbols = (response.data.contracts ?? [])
        .filter(
          (contract) =>
            contract.status === 'TRADING' &&
            contract.quoteAsset === 'USDT' &&
            contract.symbol.includes('-SWAP-'),
        )
        .map((contract) => ({
          symbol: contract.symbol.replace(/-SWAP-USDT$/, 'USDT'),
          pair: contract.symbol,
          contractType: 'PERPETUAL',
          status: contract.status,
          baseAsset:
            contract.underlying ?? contract.baseAsset ?? contract.symbol,
          quoteAsset: contract.quoteAsset ?? 'USDT',
          marginAsset: contract.marginToken ?? 'USDT',
          pricePrecision: Number(contract.quotePrecision ?? 0),
          quantityPrecision: Number(contract.baseAssetPrecision ?? 0),
          deliveryDate: null,
          onboardDate: null,
        }));

      this.logger.log(`Fetched ${symbols.length} Toobit futures symbols`);
      return {
        symbols,
        total: symbols.length,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Toobit symbols error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return { symbols: [], total: 0, fetchedAt: new Date().toISOString() };
    }
  }

  private async fetchLbankSymbols(): Promise<FuturesSymbolsResponse> {
    try {
      const response = await axios.get<LbankContract[]>(
        'https://lbkperp.lbank.com/cfd/openApi/v1/pub/instrument',
        { params: { productGroup: 'SwapU' }, timeout: 10000 },
      );

      const symbols = (Array.isArray(response.data) ? response.data : [])
        .filter(
          (contract) =>
            contract.clearCurrency?.toUpperCase() === 'USDT' && contract.symbol,
        )
        .map((contract) => {
          const symbol = contract.symbol
            .replace(/[-_]?SWAP[-_]?USDT$/i, '')
            .replace(/[-_]USDT$/i, '')
            .replace(/USDT$/i, '')
            .toUpperCase();
          return {
            symbol: `${symbol}USDT`,
            pair: contract.symbol,
            contractType: 'PERPETUAL',
            status: 'TRADING',
            baseAsset: contract.baseCurrency ?? symbol,
            quoteAsset: 'USDT',
            marginAsset: contract.clearCurrency ?? 'USDT',
            pricePrecision: Number(contract.priceTick ?? 0),
            quantityPrecision: Number(contract.volumeTick ?? 0),
            deliveryDate: null,
            onboardDate: null,
          };
        });

      this.logger.log(`Fetched ${symbols.length} LBank futures symbols`);
      return {
        symbols,
        total: symbols.length,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `LBank symbols error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return { symbols: [], total: 0, fetchedAt: new Date().toISOString() };
    }
  }

  private async fetchOrbitSymbols(): Promise<FuturesSymbolsResponse> {
    this.logger.warn(
      'Orbit symbols fetch skipped: no verified public exchange-info endpoint available.',
    );
    return { symbols: [], total: 0, fetchedAt: new Date().toISOString() };
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

type MexcContractDetail = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  settleCoin?: string;
  futureType: number;
  state: number;
  apiAllowed?: boolean;
  priceScale?: number;
  volScale?: number;
  openingTime?: number;
  createTime?: number;
};

type MexcTicker = {
  symbol: string;
  volume24?: number | string;
};

type ToobitContract = {
  symbol: string;
  status: string;
  baseAsset?: string;
  underlying?: string;
  quoteAsset?: string;
  marginToken?: string;
  quotePrecision?: number | string;
  baseAssetPrecision?: number | string;
};

type LbankContract = {
  symbol: string;
  baseCurrency?: string;
  clearCurrency?: string;
  priceTick?: number | string;
  volumeTick?: number | string;
};
