import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum SentimentSource {
  NEWS = 'news',
  TWITTER = 'twitter',
  REDDIT = 'reddit',
  OVERALL = 'overall',
}

export enum SentimentLabel {
  VERY_BULLISH = 'very_bullish',
  BULLISH = 'bullish',
  NEUTRAL = 'neutral',
  BEARISH = 'bearish',
  VERY_BEARISH = 'very_bearish',
}

@Entity('sentiment_analyses')
export class SentimentAnalysisEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  symbol: string;

  @Column({ type: 'enum', enum: SentimentSource })
  source: SentimentSource;

  @Column({ type: 'enum', enum: SentimentLabel })
  label: SentimentLabel;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  score: number;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  confidence: number;

  @Column({ type: 'int', default: 0 })
  articleCount: number;

  @Column({ type: 'simple-json', nullable: true })
  keywords: string[] | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'simple-json', nullable: true })
  topArticles: { title: string; url: string; sentiment: string }[] | null;

  @CreateDateColumn()
  createdAt: Date;
}
