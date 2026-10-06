import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('correlation_snapshots')
export class CorrelationSnapshotEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 10 })
  interval: string;

  @Column({ type: 'varchar', length: 10 })
  benchmark: string;

  @Column({ type: 'int' })
  symbolCount: number;

  /**
   * Matrix stored row-major as a JSON 2D array of numbers (-1..1).
   * symbols holds the ordering so the matrix stays square and readable.
   */
  @Column({ type: 'simple-json' })
  symbols: string[];

  @Column({ type: 'simple-json' })
  matrix: number[][];

  @Column({ type: 'simple-json' })
  clusters: { name: string; symbols: string[] }[];

  /** Average pairwise correlation, a single number for regime detection. */
  @Column({ type: 'decimal', precision: 6, scale: 4 })
  averageCorrelation: number;

  @CreateDateColumn()
  createdAt: Date;
}