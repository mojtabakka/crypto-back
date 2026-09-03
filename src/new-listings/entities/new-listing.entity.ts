import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export type ListingStatus = 'NEW' | 'UPCOMING' | 'TRADING';

@Entity('new_listings')
@Unique(['symbol', 'exchange', 'listedDate'])
export class NewListingEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  exchange: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | null;

  @Index()
  @Column({ type: 'bigint' })
  listedDate: number;

  @Column({ type: 'varchar', length: 20, default: 'NEW' })
  status: ListingStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  announcementUrl: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
