import { Test, TestingModule } from '@nestjs/testing';
import { TVLAnalysisController } from './tvl-analysis.controller';
import { TVLAnalyzerService } from './tvl-analyzer.service';
import { TVLService } from './tvl.service';
import { HttpModule } from '@nestjs/axios';

describe('TVLAnalysisController', () => {
  let controller: TVLAnalysisController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      controllers: [TVLAnalysisController],
      providers: [TVLAnalyzerService, TVLService],
    }).compile();

    controller = module.get<TVLAnalysisController>(TVLAnalysisController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

describe('TVLAnalyzerService', () => {
  let service: TVLAnalyzerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [TVLAnalyzerService, TVLService],
    }).compile();

    service = module.get<TVLAnalyzerService>(TVLAnalyzerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('TVLService', () => {
  let service: TVLService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [TVLService],
    }).compile();

    service = module.get<TVLService>(TVLService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
