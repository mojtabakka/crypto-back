import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type LongShortDirection = 'LONG' | 'SHORT';

export type LongShortRiskLevel = 'NORMAL' | 'HIGH_RISK';

@Entity('long_short_signals')
export class LongShortSignalEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'BINANCE' })
  exchange: string;

  @Index()
  @Column({ type: 'varchar', length: 10 })
  direction: LongShortDirection;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  score: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  priceChange: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  oiChange: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  fundingRate: number | null;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  currentPrice: number | null;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  ema50: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  priceVsEma50: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  signal: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  confidence: number | null;

  @Column({ type: 'varchar', length: 20, default: 'NORMAL' })
  riskLevel: LongShortRiskLevel;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  fakeSignalProbability: number | null;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
