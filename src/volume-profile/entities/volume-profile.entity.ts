import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export type VolumeProfileSignal = 'LONG' | 'SHORT' | 'NEUTRAL';

@Entity('volume_profiles')
@Unique(['symbol', 'interval', 'timestamp'])
export class VolumeProfileEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Index()
  @Column({ type: 'varchar', length: 10 })
  interval: string;

  @Column({ type: 'bigint' })
  timestamp: number;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  poc: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  vah: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  val: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  currentPrice: string;

  @Column({ type: 'varchar', length: 10 })
  signal: VolumeProfileSignal;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  entryPrice: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  stopLoss: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  takeProfit: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  riskRewardRatio: string | null;

  @Column({ type: 'int' })
  totalVolNodes: number;

  @CreateDateColumn()
  createdAt: Date;
}
