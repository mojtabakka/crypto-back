import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Tracks the correlation of a symbol against the benchmark over time so
 * rotation can be detected: a falling correlation means the asset is
 * beginning to trade independently of the market.
 */
@Entity('correlation_pairs')
@Index(['symbol', 'benchmark'], { unique: true })
export class CorrelationPairEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Column({ type: 'varchar', length: 20 })
  benchmark: string;

  @Column({ type: 'varchar', length: 10 })
  interval: string;

  /** Latest measured correlation, -1..1 */
  @Column({ type: 'decimal', precision: 6, scale: 4 })
  correlation: number;

  /** Rolling average so single windows do not cause false alarms. */
  @Column({ type: 'decimal', precision: 6, scale: 4 })
  smoothedCorrelation: number;

  /** Previous smoothed value, used to report the direction of travel. */
  @Column({ type: 'decimal', precision: 6, scale: 4 })
  previousSmoothed: number;

  @Column({ type: 'int' })
  observations: number;

  @Column({ type: 'varchar', length: 20 })
  regime: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}