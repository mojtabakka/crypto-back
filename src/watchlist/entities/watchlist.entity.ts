import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('watchlist')
export class WatchlistEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ length: 50 })
  symbol: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
