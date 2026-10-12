import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TVLValidationDataService } from './tvl-validation-data.service';
import { TVLValidationAnalyzerService } from './tvl-validation-analyzer.service';
import { TVLValidationController } from './tvl-validation.controller';
import { TVLAnalysisModule } from '../tvl-analysis/tvl-analysis.module';

@Module({
  imports: [HttpModule, TVLAnalysisModule],
  controllers: [TVLValidationController],
  providers: [TVLValidationDataService, TVLValidationAnalyzerService],
  exports: [TVLValidationDataService, TVLValidationAnalyzerService],
})
export class TVLValidationModule {}
