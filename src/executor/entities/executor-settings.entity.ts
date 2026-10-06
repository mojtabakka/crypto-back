import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Per-user execution settings. Secrets are intentionally absent: this
 * system runs in paper mode and never holds exchange credentials.
 */
@Entity('executor_settings')
export class ExecutorSettingsEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  username: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  /** 'PAPER' is the only supported mode in this build. */
  @Column({ type: 'varchar', length: 10, default: 'PAPER' })
  mode: string;

  @Column({ type: 'varchar', length: 50, default: 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT' })
  symbols: string;

  /** Fraction of equity risked per trade, e.g. 0.01 for 1%. */
  @Column({ type: 'decimal', precision: 6, scale: 4, default: 0.01 })
  riskPerTrade: number;

  @Column({ type: 'int', default: 10 })
  leverage: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 10000 })
  startingEquity: number;

  /** Stop distance as a multiple of ATR. */
  @Column({ type: 'int', default: 2 })
  atrStopMultiple: number;

  @Column({ type: 'int', default: 3 })
  atrTargetMultiple: number;

  /** Minimum signal score required to open a position. */
  @Column({ type: 'int', default: 60 })
  minSignalScore: number;

  @Column({ type: 'boolean', default: true })
  trailingStop: boolean;

  @Column({ type: 'boolean', default: true })
  breakEven: boolean;

  /** Caps how many positions can be open at once, protecting capital. */
  @Column({ type: 'int', default: 3 })
  maxConcurrentPositions: number;

  @CreateDateColumn()
  createdAt: Date;
}