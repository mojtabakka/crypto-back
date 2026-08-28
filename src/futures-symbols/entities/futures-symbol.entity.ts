import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('futures_symbols')
export class FuturesSymbolEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ length: 50 })
  symbol: string;

  @Column({ length: 50 })
  pair: string;

  @Column({ length: 30 })
  contractType: string;

  @Column({ length: 20 })
  status: string;

  @Column({ length: 20 })
  baseAsset: string;

  @Column({ length: 20 })
  quoteAsset: string;

  @Column({ length: 20 })
  marginAsset: string;

  @Column({ type: 'int' })
  pricePrecision: number;

  @Column({ type: 'int' })
  quantityPrecision: number;

  @Column({ type: 'bigint', nullable: true })
  deliveryDate: number | null;

  @Column({ type: 'bigint', nullable: true })
  onboardDate: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
