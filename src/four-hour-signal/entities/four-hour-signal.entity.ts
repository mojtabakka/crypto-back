import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type SignalType = 'PULLBACK' | 'REAPPROACH';
export type SignalDirection = 'BULLISH' | 'BEARISH';

@Entity('four_hour_signals')
export class FourHourSignalEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ length: 50 })
  symbol: string;

  @Column({ type: 'enum', enum: ['PULLBACK', 'REAPPROACH'] })
  signalType: SignalType;

  @Column({ type: 'enum', enum: ['BULLISH', 'BEARISH'] })
  direction: SignalDirection;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  score: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  priceChange: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  oiChange: number | null;

  @Column({ type: 'int', default: 0 })
  touchCount: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  priceVsEma50: number | null;

  @Column({ type: 'decimal', precision: 20, scale: 8, default: 0 })
  currentPrice: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  ema50: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  currentDistance: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  breakoutDay: string | null;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
