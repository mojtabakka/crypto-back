import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum TradeSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum TradeStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

@Index(['username', 'symbol'], { unique: true })
@Entity('positions')
export class PositionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  username: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Column({ type: 'enum', enum: TradeSide })
  side: TradeSide;

  @Column({ type: 'enum', enum: TradeStatus, default: TradeStatus.OPEN })
  status: TradeStatus;

  @Column({ type: 'varchar', length: 20 })
  mode: string;

  @Column({ type: 'varchar', length: 30 })
  signal: string;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  entryPrice: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  quantity: number;

  @Column({ type: 'int' })
  leverage: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  stopLoss: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  takeProfit: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  originalStopLoss: number;

  @Column({ type: 'int', default: 0 })
  breakEvenArmed: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  highestFavorablePrice: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  lowestFavorablePrice: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  exitPrice: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  exitReason: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true })
  pnlPercent: number | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  pnlUsd: number | null;

  @Column({ type: 'bigint' })
  openedAt: number;

  @Column({ type: 'bigint', nullable: true })
  closedAt: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}