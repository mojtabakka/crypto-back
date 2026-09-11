import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type PreMoveType = 'PUMP' | 'DUMP';
export type PreMoveStrength = 'WEAK' | 'MODERATE' | 'STRONG' | 'EXTREME';

@Entity('pre_move_signals')
@Index(['symbol', 'detectedAt'])
@Index(['type', 'detectedAt'])
export class PreMoveSignalEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'BINANCE' })
  exchange: string;

  @Column({ type: 'varchar', length: 10 })
  type: PreMoveType;

  @Column({ type: 'varchar', length: 10 })
  strength: PreMoveStrength;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  confidence: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  currentPrice: number | null;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  longLiqValue: number;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  shortLiqValue: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  longLiqCount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  shortLiqCount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  imbalanceRatio: number;

  @Column({ type: 'bigint' })
  windowMs: number;

  @Column({ type: 'bigint' })
  detectedAt: number;

  @Column({ type: 'text', nullable: true })
  reasons: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
