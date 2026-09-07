import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type Ema21Strength = 'JUST_ABOVE' | 'ABOVE' | 'STRONG' | 'EXTREME';

@Entity('weekly_ema21_signals')
export class WeeklyEma21SignalEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ length: 50 })
  symbol: string;

  @Column({ type: 'enum', enum: ['JUST_ABOVE', 'ABOVE', 'STRONG', 'EXTREME'] })
  strength: Ema21Strength;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  priceVsEma21: number;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  currentPrice: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  ema21: number | null;

  @Column({ type: 'varchar', length: 50, default: 'BINANCE' })
  exchange: string;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
