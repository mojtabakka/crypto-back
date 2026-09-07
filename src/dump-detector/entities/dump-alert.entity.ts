import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type DumpSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

@Entity('dump_alerts')
@Index(['symbol', 'exchange', 'detectedAt'])
export class DumpAlertEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'BINANCE' })
  exchange: string;

  @Column({ type: 'varchar', length: 10 })
  severity: DumpSeverity;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  priceChange1h: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  priceChange4h: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  priceChange24h: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  volumeChange1h: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  volumeChange24h: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  dumpScore: number;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  currentPrice: number;

  @Column({ type: 'bigint' })
  detectedAt: number;

  @Column({ type: 'text', nullable: true })
  reasons: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
