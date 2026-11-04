import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TVLService } from './tvl.service';
import { TVLAnalyzerService } from './tvl-analyzer.service';
import { TVLAnalysisController } from './tvl-analysis.controller';

@Module({
  imports: [HttpModule],
  controllers: [TVLAnalysisController],
  providers: [TVLService, TVLAnalyzerService],
  exports: [TVLService, TVLAnalyzerService],
})
export class TVLAnalysisModule {}
