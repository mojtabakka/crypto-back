import { Controller, Get, Query, Body, Post } from '@nestjs/common';
import { TVLValidationAnalyzerService } from './tvl-validation-analyzer.service';
import { TVLAnalyzerService } from '../tvl-analysis/tvl-analyzer.service';
import type {
  ProtocolValidationResult,
  ValidationConfig,
} from './types/tvl-validation.types';
import type { TVLAnalysisResult } from '../tvl-analysis/types/tvl-analysis.types';

@Controller('tvl-validation')
export class TVLValidationController {
  constructor(
    private readonly validationAnalyzer: TVLValidationAnalyzerService,
    private readonly tvlAnalyzer: TVLAnalyzerService,
  ) {}

  @Post('validate')
  async validateProtocol(
    @Body()
    body: {
      protocol: TVLAnalysisResult;
      config?: Partial<ValidationConfig>;
    },
  ): Promise<ProtocolValidationResult> {
    return this.validationAnalyzer.validateProtocol(body.protocol, body.config);
  }

  @Post('validate-multiple')
  async validateMultiple(
    @Body()
    body: {
      protocols: TVLAnalysisResult[];
      config?: Partial<ValidationConfig>;
    },
  ): Promise<ProtocolValidationResult[]> {
    return this.validationAnalyzer.validateMultiple(
      body.protocols,
      body.config,
    );
  }

  @Get('validate-top-opportunities')
  async validateTopOpportunities(
    @Query('limit') limit = 20,
    @Query('config') config?: string,
  ): Promise<ProtocolValidationResult[]> {
    const opportunities = await this.tvlAnalyzer.getTopOpportunities(limit);
    const parsedConfig = config ? JSON.parse(config) : {};
    return this.validationAnalyzer.validateMultiple(
      opportunities,
      parsedConfig,
    );
  }

  @Get('validate-by-category/:category')
  async validateByCategory(
    @Query('category') category: string,
    @Query('limit') limit = 20,
    @Query('config') config?: string,
  ): Promise<ProtocolValidationResult[]> {
    const protocols = await this.tvlAnalyzer.getProtocolsByCategory(category);
    const parsedConfig = config ? JSON.parse(config) : {};
    return this.validationAnalyzer.validateMultiple(
      protocols.slice(0, limit),
      parsedConfig,
    );
  }

  @Get('validate-by-chain/:chain')
  async validateByChain(
    @Query('chain') chain: string,
    @Query('limit') limit = 20,
    @Query('config') config?: string,
  ): Promise<ProtocolValidationResult[]> {
    const protocols = await this.tvlAnalyzer.getProtocolsByChain(chain);
    const parsedConfig = config ? JSON.parse(config) : {};
    return this.validationAnalyzer.validateMultiple(
      protocols.slice(0, limit),
      parsedConfig,
    );
  }

  @Get('config')
  getConfig(): ValidationConfig {
    return this.validationAnalyzer.getConfig();
  }

  @Post('config')
  updateConfig(@Body() config: Partial<ValidationConfig>): ValidationConfig {
    return this.validationAnalyzer.updateConfig(config);
  }
}
