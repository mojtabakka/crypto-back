import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  SentimentAnalysisEntity,
  SentimentSource,
  SentimentLabel,
} from './entities/sentiment-analysis.entity';
import { NewsService } from '../news/news.service';
import { BinanceService } from '../binance/binance.service';

interface WeightedTerm {
  term: string;
  weight: number;
}

@Injectable()
export class SentimentService {
  private readonly logger = new Logger(SentimentService.name);

  /**
   * Strong directional conviction — should dominate the score.
   */
  private readonly strongBullish: WeightedTerm[] = [
    { term: 'surge', weight: 3 },
    { term: 'soar', weight: 3 },
    { term: 'rally', weight: 2.5 },
    { term: 'jump', weight: 2 },
    { term: 'spike', weight: 2 },
    { term: 'breakout', weight: 3 },
    { term: 'all-time high', weight: 3.5 },
    { term: 'ath', weight: 2 },
    { term: 'record high', weight: 3 },
    { term: 'moon', weight: 2 },
    { term: 'pump', weight: 2 },
    { term: 'explode', weight: 3 },
    { term: 'skyrocket', weight: 3 },
    { term: 'bull run', weight: 3 },
    { term: 'short squeeze', weight: 3 },
    { term: 'massive inflow', weight: 3 },
    { term: 'inflows', weight: 2 },
    { term: 'accumulation', weight: 2.5 },
    { term: 'upgrade', weight: 2 },
    { term: 'adoption', weight: 2 },
    { term: 'approval', weight: 2 },
    { term: 'partnership', weight: 1.5 },
    { term: 'institutional', weight: 1.5 },
    { term: 'bullish', weight: 2 },
    { term: 'optimistic', weight: 1.5 },
    { term: 'etf inflow', weight: 3 },
    { term: 'green', weight: 1 },
  ];

  private readonly strongBearish: WeightedTerm[] = [
    { term: 'crash', weight: 3 },
    { term: 'plunge', weight: 3 },
    { term: 'collapse', weight: 3 },
    { term: 'tumble', weight: 2.5 },
    { term: 'slump', weight: 2.5 },
    { term: 'sink', weight: 2 },
    { term: 'drop', weight: 1.5 },
    { term: 'fall', weight: 1.5 },
    { term: 'breakdown', weight: 3 },
    { term: 'dump', weight: 2.5 },
    { term: 'liquidat', weight: 2.5 },
    { term: 'bearish', weight: 2 },
    { term: 'panic', weight: 2.5 },
    { term: 'fear', weight: 2 },
    { term: 'hack', weight: 3 },
    { term: 'exploit', weight: 3 },
    { term: 'scam', weight: 3 },
    { term: 'fraud', weight: 3 },
    { term: 'lawsuit', weight: 2 },
    { term: 'sue', weight: 2 },
    { term: 'sec ', weight: 1.5 },
    { term: 'investigation', weight: 2.5 },
    { term: 'ban', weight: 2.5 },
    { term: 'crackdown', weight: 3 },
    { term: 'outflow', weight: 2 },
    { term: 'outflows', weight: 2.5 },
    { term: 'short squeeze', weight: 0 },
    { term: 'warning', weight: 1.5 },
    { term: 'risk', weight: 1 },
    { term: 'correction', weight: 2 },
    { term: 'red', weight: 1 },
  ];

  /**
   * Contextual modifiers. These shift sentiment rather than dominate it.
   */
  private readonly amplifiers: string[] = [
    'massive',
    'huge',
    'record',
    'gigantic',
    'surprise',
    'shock',
    'unprecedented',
    'historic',
  ];

  private readonly dampeners: string[] = [
    'may',
    'might',
    'could',
    'possible',
    'reportedly',
    'rumor',
    'expected',
    'potential',
    'unlikely',
  ];

  constructor(
    @InjectRepository(SentimentAnalysisEntity)
    private readonly sentimentRepository: Repository<SentimentAnalysisEntity>,
    private readonly newsService: NewsService,
    private readonly binanceService: BinanceService,
  ) {}

  async analyzeSentiment(
    symbol: string,
    source: SentimentSource = SentimentSource.OVERALL,
  ) {
    const articles = await this.collectArticles(symbol);

    if (articles.length === 0) {
      return this.persist(symbol, source, {
        score: 0,
        label: SentimentLabel.NEUTRAL,
        articleCount: 0,
        keywords: [],
        summary: `No recent news mentioning ${symbol.replace(/USDT?$/i, '')} was found, so sentiment is neutral.`,
        topArticles: [],
        confidence: 0,
      });
    }

    const analyzed = articles.map((article) => this.scoreArticle(article));
    const scored = analyzed.filter((a) => a.score !== 0);

    // Fall back to all articles when nothing matched a keyword, so the
    // confidence reflects "no signal" instead of silently scoring zero.
    const usable = scored.length > 0 ? scored : analyzed;

    const avgScore =
      usable.reduce((sum, a) => sum + a.score, 0) / usable.length;
    const matchRate = scored.length / articles.length;

    // Confidence scales the score: many matching terms => strong reading.
    // clamp keeps a single strong headline from pinning the score at +100.
    const confidence = this.clamp(matchRate, 0, 1);
    const normalizedScore = this.clamp(
      this.tanh(avgScore / 2.5) * 100 * confidence,
      -100,
      100,
    );

    const label = this.getSentimentLabel(normalizedScore);
    const keywords = this.extractKeywords(analyzed);
    const summary = this.buildSummary(
      symbol,
      label,
      normalizedScore,
      articles.length,
      matchRate,
    );

    return this.persist(symbol, source, {
      score: Number(normalizedScore.toFixed(2)),
      label,
      articleCount: articles.length,
      keywords,
      summary,
      topArticles: analyzed.slice(0, 5).map((a) => ({
        title: a.title,
        url: a.url,
        sentiment: a.score > 0 ? 'bullish' : a.score < 0 ? 'bearish' : 'neutral',
      })),
      confidence: Number(confidence.toFixed(2)),
    });
  }

  async getLatestSentiment(
    symbol: string,
    source?: SentimentSource,
  ): Promise<SentimentAnalysisEntity[]> {
    const where: Record<string, unknown> = { symbol: symbol.toUpperCase() };
    if (source) where.source = source;

    return this.sentimentRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: 1,
    });
  }

  async getSentimentHistory(
    symbol: string,
    days = 30,
  ): Promise<SentimentAnalysisEntity[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.sentimentRepository.find({
      where: {
        symbol: symbol.toUpperCase(),
        createdAt: MoreThan(startDate),
      },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async getMarketOverview() {
    const symbols = [
      'BTCUSDT',
      'ETHUSDT',
      'BNBUSDT',
      'SOLUSDT',
      'XRPUSDT',
      'ADAUSDT',
      'DOGEUSDT',
    ];

    const results: SentimentAnalysisEntity[] = [];

    for (const symbol of symbols) {
      const latest = await this.sentimentRepository.findOne({
        where: { symbol, source: SentimentSource.OVERALL },
        order: { createdAt: 'DESC' },
      });

      if (latest) results.push(latest);
    }

    return results;
  }

  /**
   * Ensure there is at least one analysis per tracked symbol so the
   * overview endpoint is never empty on a fresh database.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async analyzeMarketSentiment() {
    const symbols = [
      'BTCUSDT',
      'ETHUSDT',
      'BNBUSDT',
      'SOLUSDT',
      'XRPUSDT',
      'ADAUSDT',
      'DOGEUSDT',
    ];

    for (const symbol of symbols) {
      try {
        await this.analyzeSentiment(symbol, SentimentSource.OVERALL);
        this.logger.log(`Sentiment analysis completed for ${symbol}`);
      } catch (error) {
        this.logger.error(
          `Failed to analyze sentiment for ${symbol}`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  /**
   * Pull news from several angles so a symbol is not limited to whatever
   * a single feed happens to surface.
   */
  private async collectArticles(symbol: string) {
    const articles = await this.safeNews(() =>
      this.newsService.getCombinedNewsForSymbol(symbol, 80),
    );

    const seen = new Set<string>();

    return articles
      .filter((article) => {
        const key = (article.title ?? '').toLowerCase().trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 80);
  }

  private async safeNews(
    fetch: () => Promise<{ title?: string; description?: string; url?: string }[]>,
  ) {
    try {
      const result = await fetch();
      return Array.isArray(result) ? result : [];
    } catch (error) {
      this.logger.warn(
        `News source failed during sentiment collection: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private scoreArticle(article: {
    title?: string;
    description?: string;
    url?: string;
  }) {
    const title = (article.title ?? '').toLowerCase();
    const body = (article.description ?? '').toLowerCase();
    const text = `${title} ${body}`;

    let score = 0;

    // Titles carry far more signal than bodies, so weight them 2x.
    for (const { term, weight } of this.strongBullish) {
      if (title.includes(term)) score += weight * 2;
      else if (body.includes(term)) score += weight;
    }

    for (const { term, weight } of this.strongBearish) {
      if (term.trim() === 'short squeeze') continue;
      if (title.includes(term)) score -= weight * 2;
      else if (body.includes(term)) score -= weight;
    }

    if (this.amplifiers.some((a) => text.includes(a))) {
      score *= 1.35;
    }

    if (this.dampeners.some((d) => text.includes(d))) {
      score *= 0.65;
    }

    return {
      title: article.title ?? '',
      url: article.url ?? '',
      score,
    };
  }

  private extractKeywords(articles: { title: string }[]): string[] {
    const counts = new Map<string, number>();

    for (const article of articles) {
      const text = article.title.toLowerCase();

      for (const { term } of [
        ...this.strongBullish,
        ...this.strongBearish,
      ]) {
        if (text.includes(term)) {
          counts.set(term, (counts.get(term) ?? 0) + 1);
        }
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([term]) => term);
  }

  private getSentimentLabel(score: number): SentimentLabel {
    if (score >= 45) return SentimentLabel.VERY_BULLISH;
    if (score >= 15) return SentimentLabel.BULLISH;
    if (score > -15) return SentimentLabel.NEUTRAL;
    if (score > -45) return SentimentLabel.BEARISH;
    return SentimentLabel.VERY_BEARISH;
  }

  private buildSummary(
    symbol: string,
    label: SentimentLabel,
    score: number,
    articleCount: number,
    matchRate: number,
  ): string {
    const base = symbol.replace(/USDT?$/i, '');
    const readable = label.replace(/_/g, ' ').toLowerCase();

    if (articleCount === 0) {
      return `No recent coverage of ${base} was found. Sentiment is neutral by default.`;
    }

    if (matchRate === 0) {
      return `${articleCount} recent articles about ${base} contained no clear directional language, so sentiment reads as neutral (score ${score.toFixed(1)}).`;
    }

    return `${base} coverage is ${readable} with a score of ${score.toFixed(1)} based on ${articleCount} recent articles. ${Math.round(
      matchRate * 100,
    )}% of them carried explicit directional wording.`;
  }

  private persist(
    symbol: string,
    source: SentimentSource,
    data: {
      score: number;
      label: SentimentLabel;
      articleCount: number;
      keywords: string[];
      summary: string;
      topArticles: { title: string; url: string; sentiment: string }[];
      confidence: number;
    },
  ) {
    const analysis = this.sentimentRepository.create({
      symbol: symbol.toUpperCase(),
      source,
      score: data.score,
      label: data.label,
      confidence: data.confidence,
      articleCount: data.articleCount,
      keywords: data.keywords,
      summary: data.summary,
      topArticles: data.topArticles,
    });

    return this.sentimentRepository.save(analysis);
  }

  private tanh(x: number): number {
    return (Math.exp(2 * x) - 1) / (Math.exp(2 * x) + 1);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}