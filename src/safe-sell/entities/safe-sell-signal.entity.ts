import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type SafeSellDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

export type SafeSellSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

@Entity('safe_sell_signals')
@Index(['symbol', 'exchange', 'detectedAt'])
export class SafeSellSignalEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'BINANCE' })
  exchange: string;

  @Column({ type: 'varchar', length: 10 })
  direction: SafeSellDirection;

  @Column({ type: 'varchar', length: 10 })
  severity: SafeSellSeverity;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  priceChange1h: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  priceChange4h: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  volumeChange1h: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  oiChange1h: number;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  fundingRate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  longLiquidationChange: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  shortLiquidationChange: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  safeSellScore: number;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  currentPrice: number;

  @Column({ type: 'bigint' })
  detectedAt: number;

  @Column({ type: 'text', nullable: true })
  reasons: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
