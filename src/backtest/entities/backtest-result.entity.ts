import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('backtest_results')
export class BacktestResultEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Index()
  @Column({ type: 'varchar', length: 10 })
  interval: string;

  /** Which entry rule produced the results. */
  @Column({ type: 'varchar', length: 40 })
  strategy: string;

  @Column({ type: 'int' })
  lookbackDays: number;

  @Column({ type: 'int' })
  totalTrades: number;

  @Column({ type: 'int' })
  winningTrades: number;

  @Column({ type: 'int' })
  losingTrades: number;

  /** winRate as a fraction 0..1 */
  @Column({ type: 'decimal', precision: 6, scale: 4 })
  winRate: number;

  /** grossProfit / grossLoss; > 1 means the edge survives fees */
  @Column({ type: 'decimal', precision: 8, scale: 4 })
  profitFactor: number;

  /** Net return over the tested window, as a fraction. */
  @Column({ type: 'decimal', precision: 8, scale: 4 })
  netReturn: number;

  /** Annualised Sharpe from per-trade returns. */
  @Column({ type: 'decimal', precision: 8, scale: 4 })
  sharpeRatio: number;

  /** Largest peak-to-trough decline of the equity curve, as a fraction. */
  @Column({ type: 'decimal', precision: 8, scale: 4 })
  maxDrawdown: number;

  @Column({ type: 'decimal', precision: 8, scale: 4 })
  averageRMultiple: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  averageHoldMs: number;

  @Column({ type: 'simple-json' })
  trades: {
    entryTime: number;
    exitTime: number;
    side: string;
    entryPrice: number;
    exitPrice: number;
    pnlPercent: number;
    rMultiple: number;
    exitReason: string;
    barsHeld: number;
  }[];

  /** Same window measured against simply holding the asset. */
  @Column({ type: 'decimal', precision: 8, scale: 4 })
  buyAndHoldReturn: number;

  @Column({ type: 'varchar', length: 20 })
  verdict: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;
}