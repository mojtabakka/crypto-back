import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from 'typeorm';

@Entity('klines')
@Unique(['symbol', 'interval', 'openTime'])
export class KlineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Index()
  @Column({ type: 'varchar', length: 10 })
  interval: string;

  @Index()
  @Column({ type: 'bigint' })
  openTime: number;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  open: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  high: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  low: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  close: string;

  @Column({ type: 'decimal', precision: 30, scale: 8 })
  volume: string;

  @Column({ type: 'bigint' })
  closeTime: number;

  @Column({ type: 'decimal', precision: 30, scale: 8 })
  quoteVolume: string;

  @Column({ type: 'int' })
  trades: number;

  @Column({ type: 'decimal', precision: 30, scale: 8 })
  takerBuyBaseVolume: string;

  @Column({ type: 'decimal', precision: 30, scale: 8 })
  takerBuyQuoteVolume: string;
}
