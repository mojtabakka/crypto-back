import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { DefiLlamaProtocol, TVLSignal } from './types/tvl-analysis.types';

@Injectable()
export class TVLService {
  private readonly logger = new Logger(TVLService.name);
  private readonly DEFILLAMA_PROTOCOLS_URL = 'https://api.llama.fi/protocols';
  private readonly DEFILLAMA_SUMMARY_URL = 'https://api.llama.fi/summary/fees';

  constructor(private readonly httpService: HttpService) {}

  async fetchAllProtocols(): Promise<DefiLlamaProtocol[]> {
    try {
      this.logger.log('Fetching all protocols from DefiLlama...');
      const response = await firstValueFrom(
        this.httpService.get<DefiLlamaProtocol[]>(
          this.DEFILLAMA_PROTOCOLS_URL,
          {
            timeout: 30000,
          },
        ),
      );

      const protocols = response.data.filter(
        (p) => p.tvl && p.tvl > 0 && p.chain !== 'Bitcoin',
      );

      this.logger.log(`Fetched ${protocols.length} protocols with TVL > 0`);
      return protocols;
    } catch (error) {
      this.logger.error('Failed to fetch protocols from DefiLlama', error);
      throw new Error('Failed to fetch TVL data');
    }
  }

  async fetchProtocolsByChain(chain: string): Promise<DefiLlamaProtocol[]> {
    const allProtocols = await this.fetchAllProtocols();
    return allProtocols.filter((p) =>
      p.chains.map((c) => c.toLowerCase()).includes(chain.toLowerCase()),
    );
  }

  async fetchProtocolsByCategory(
    category: string,
  ): Promise<DefiLlamaProtocol[]> {
    const allProtocols = await this.fetchAllProtocols();
    return allProtocols.filter((p) =>
      p.category.toLowerCase().includes(category.toLowerCase()),
    );
  }

  async getTopProtocolsByTVL(limit = 50): Promise<DefiLlamaProtocol[]> {
    const protocols = await this.fetchAllProtocols();
    return protocols.sort((a, b) => b.tvl - a.tvl).slice(0, limit);
  }

  async getProtocolsByTVLRange(
    minTVL: number,
    maxTVL: number,
  ): Promise<DefiLlamaProtocol[]> {
    const protocols = await this.fetchAllProtocols();
    return protocols.filter((p) => p.tvl >= minTVL && p.tvl <= maxTVL);
  }

  calculateTVLScore(protocol: DefiLlamaProtocol): number {
    let score = 0;

    // TVL magnitude (max 40 points)
    if (protocol.tvl >= 1_000_000_000) score += 40;
    else if (protocol.tvl >= 500_000_000) score += 30;
    else if (protocol.tvl >= 100_000_000) score += 20;
    else if (protocol.tvl >= 50_000_000) score += 15;
    else if (protocol.tvl >= 10_000_000) score += 10;
    else score += 5;

    // TVL growth (max 25 points)
    const growth7d = protocol.change_7d || 0;
    if (growth7d > 20) score += 25;
    else if (growth7d > 10) score += 20;
    else if (growth7d > 5) score += 15;
    else if (growth7d > 0) score += 10;
    else if (growth7d > -5) score += 5;
    else score += 0;

    // Multi-chain presence (max 15 points)
    const chainCount = protocol.chains.length;
    if (chainCount >= 10) score += 15;
    else if (chainCount >= 5) score += 12;
    else if (chainCount >= 3) score += 10;
    else if (chainCount >= 2) score += 7;
    else score += 3;

    // Category bonus (max 10 points)
    const blueChipCategories = ['Dexes', 'Lending', 'Bridge', 'CDP', 'Yield'];
    if (blueChipCategories.some((c) => protocol.category.includes(c)))
      score += 10;
    else if (protocol.category === 'Liquid Staking') score += 8;
    else score += 5;

    // Age/stability bonus (max 10 points)
    const ageInYears =
      (Date.now() - protocol.listedAt * 1000) / (365 * 24 * 60 * 60 * 1000);
    if (ageInYears >= 3) score += 10;
    else if (ageInYears >= 2) score += 8;
    else if (ageInYears >= 1) score += 5;
    else score += 2;

    return Math.min(100, score);
  }

  calculateMcapToTvlRatio(protocol: DefiLlamaProtocol): number | null {
    if (!protocol.mcap || !protocol.tvl) return null;
    return protocol.mcap / protocol.tvl;
  }

  generateSignals(protocol: DefiLlamaProtocol): TVLSignal[] {
    const signals: TVLSignal[] = [];

    // High TVL
    if (protocol.tvl >= 1_000_000_000) {
      signals.push({
        type: 'HIGH_TVL',
        strength: 'STRONG',
        description: `TVL $${(protocol.tvl / 1e9).toFixed(2)}B - Top tier liquidity`,
      });
    } else if (protocol.tvl >= 100_000_000) {
      signals.push({
        type: 'HIGH_TVL',
        strength: 'MODERATE',
        description: `TVL $${(protocol.tvl / 1e6).toFixed(0)}M - Significant liquidity`,
      });
    }

    // Growing TVL
    const growth7d = protocol.change_7d || 0;
    if (growth7d > 15) {
      signals.push({
        type: 'GROWING_TVL',
        strength: 'STRONG',
        description: `7d TVL growth: +${growth7d.toFixed(1)}% - Strong capital inflow`,
      });
    } else if (growth7d > 5) {
      signals.push({
        type: 'GROWING_TVL',
        strength: 'MODERATE',
        description: `7d TVL growth: +${growth7d.toFixed(1)}% - Positive momentum`,
      });
    }

    // Low Mcap/TVL ratio (potentially undervalued)
    const ratio = this.calculateMcapToTvlRatio(protocol);
    if (
      ratio !== null &&
      ratio < 1 &&
      protocol.mcap &&
      protocol.mcap > 50_000_000
    ) {
      signals.push({
        type: 'LOW_MCAP_TVL_RATIO',
        strength: ratio < 0.5 ? 'STRONG' : 'MODERATE',
        description: `Mcap/TVL ratio: ${ratio.toFixed(2)} - Potentially undervalued`,
      });
    }

    // Stable TVL (low volatility)
    if (
      Math.abs(protocol.change_1d || 0) < 2 &&
      Math.abs(protocol.change_7d || 0) < 5
    ) {
      signals.push({
        type: 'STABLE_TVL',
        strength: 'MODERATE',
        description: `Low TVL volatility - Stable capital base`,
      });
    }

    // Multi-chain
    if (protocol.chains.length >= 5) {
      signals.push({
        type: 'MULTI_CHAIN',
        strength: protocol.chains.length >= 10 ? 'STRONG' : 'MODERATE',
        description: `Deployed on ${protocol.chains.length} chains - Diversified risk`,
      });
    }

    // Blue chip categories
    const blueChipCategories = ['Dexes', 'Lending', 'Bridge', 'CDP'];
    if (blueChipCategories.some((c) => protocol.category.includes(c))) {
      signals.push({
        type: 'BLUE_CHIP',
        strength: 'STRONG',
        description: `${protocol.category} protocol - Core DeFi infrastructure`,
      });
    }

    return signals;
  }
}
