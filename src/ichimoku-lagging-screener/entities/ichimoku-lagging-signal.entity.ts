import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export type IchimokuLaggingSignalType = 'LONG' | 'SHORT' | 'NEUTRAL';

@Entity('ichimoku_lagging_signals')
export class IchimokuLaggingSignalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string;

  @Column()
  exchange: string;

  @Column()
  interval: string;
}
