import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ProtocolDataService } from './protocol-data.service';
import { ProtocolAnalyzerService } from './protocol-analyzer.service';
import { ProtocolAnalysisController } from './protocol-analysis.controller';

@Module({
  imports: [HttpModule],
  controllers: [ProtocolAnalysisController],
  providers: [ProtocolDataService, ProtocolAnalyzerService],
  exports: [ProtocolDataService, ProtocolAnalyzerService],
})
export class ProtocolAnalysisModule {}
