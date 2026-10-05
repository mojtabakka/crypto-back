import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum AlertCondition {
  ABOVE = 'above',
  BELOW = 'below',
}

export enum AlertStatus {
  ACTIVE = 'active',
  TRIGGERED = 'triggered',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

@Entity('price_alerts')
export class PriceAlertEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  username: string;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  symbol: string;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  targetPrice: number;

  @Column({ type: 'enum', enum: AlertCondition })
  condition: AlertCondition;

  @Column({ type: 'enum', enum: AlertStatus, default: AlertStatus.ACTIVE })
  status: AlertStatus;

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  triggeredPrice: number | null;

  @Column({ type: 'timestamp', nullable: true })
  triggeredAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}