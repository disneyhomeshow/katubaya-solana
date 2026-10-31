import type * as React from 'react';

/** The nine on-chain `OrderStatus` variants of the Katūbayá Bridge program. */
export type OrderStatusCode =
  | 'ESCROWED_PICKUP' | 'PENDING_DELIVERY_QUOTE' | 'DELIVERY_QUOTED' | 'ESCROWED_READY'
  | 'IN_TRANSIT' | 'FULFILLED' | 'REFUSED' | 'CANCELED' | 'EXPIRED';
export type FulfillmentMode = 'PICKUP' | 'DELIVERY';
/** `unit_code` as the program stores it: 1 g · 2 kg (grams) · 3 ml · 4 L (ml) · 10 unit · 11 bunch · 12 bag · 13 tray · 14 box */
export type UnitCode = 1 | 2 | 3 | 4 | 10 | 11 | 12 | 13 | 14;
export type Tone = 'canopy' | 'river' | 'amber' | 'urucum' | 'muted' | 'ink';
export type IconName = 'check' | 'copy' | 'truck' | 'package' | 'warehouse' | 'wallet' | 'leaf' | 'alert' | 'clock' | 'arrowRight' | 'close' | 'info' | 'image' | 'plus';

export interface IconProps { name: IconName; size?: number; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` at most once per view. `secondary` is the default. */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface BadgeProps { tone?: Tone; className?: string; children?: React.ReactNode }
export declare function Badge(props: BadgeProps): React.ReactElement;

export interface OrderStatusProps { status: OrderStatusCode; /** Override the fixed label (translations). */ label?: string; className?: string }
export declare function OrderStatus(props: OrderStatusProps): React.ReactElement;

export interface LifecycleProps { mode: FulfillmentMode; status: OrderStatusCode; /** Steps top to bottom, for widths under 480px. */ vertical?: boolean; className?: string }
export declare function Lifecycle(props: LifecycleProps): React.ReactElement;

export interface AmountProps {
  /** Integer minor units, as the chain returns them (number, bigint or numeric string). */
  minor: number | bigint | string;
  /** The mint's decimals; 6 for USDC. */
  decimals?: number;
  /** Mint symbol shown after the number. */
  symbol?: string;
  size?: 'md' | 'lg';
  /** Tint river: this amount is held in escrow. */
  escrow?: boolean;
  locale?: string;
  className?: string;
}
export declare function Amount(props: AmountProps): React.ReactElement;
export declare function formatMinor(minor: number | bigint | string, decimals?: number, locale?: string): string;
export declare function formatQty(baseUnits: number | string, unitCode: UnitCode): string;

export interface AddressProps { value: string; head?: number; tail?: number; /** Default true. */ copy?: boolean; className?: string }
export declare function Address(props: AddressProps): React.ReactElement;

export interface FieldProps {
  label: React.ReactNode;
  /** One control: an `Input`, `Select` or any element taking `id`. */
  children: React.ReactElement;
  hint?: React.ReactNode;
  /** Replaces the hint; marks the control invalid. */
  error?: React.ReactNode;
  optional?: boolean;
  /** Unit or symbol shown inside the control's right edge ("kg", "USDC"). */
  affix?: string;
  id?: string;
  className?: string;
}
export declare function Field(props: FieldProps): React.ReactElement;
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { /** Mono: for amounts, quantities and keys. */ mono?: boolean }
export declare function Input(props: InputProps): React.ReactElement;
export declare function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>): React.ReactElement;

export interface OfferCardProps {
  crop: string;
  cultivar?: string;
  unitCode: UnitCode;
  /** `qty_remaining` in base units. */
  qtyRemaining: number | string;
  /** `price_minor` per shown unit. */
  priceMinor: number | bigint | string;
  decimals?: number;
  symbol?: string;
  farmerName: string;
  farmerKey?: string;
  warehouseName?: string;
  /** Already formatted ("14 Nov"). */
  expires?: string;
  notes?: string;
  /** The cover photo's URL (photo storage, on-chain or off-chain, is still to be decided). Omitted: the well shows "No photo yet". */
  image?: string;
  /** Defaults to "Photo of <crop> <cultivar> by <farmer>". */
  imageAlt?: string;
  /** How many photos the offer has; above 1 a count shows on the photo. */
  photoCount?: number;
  active?: boolean;
  buyLabel?: string;
  onBuy?: () => void;
  className?: string;
}
export declare function OfferCard(props: OfferCardProps): React.ReactElement;

export interface OfferPhotoProps {
  src?: string;
  alt?: string;
  /** card: 4:3 well · hero: 4:3 with large radius (offer page) · tile: picker tile · thumb: 48px square in tables */
  size?: 'card' | 'hero' | 'tile' | 'thumb';
  count?: number;
  emptyLabel?: string;
  className?: string;
}
export declare function OfferPhoto(props: OfferPhotoProps): React.ReactElement;

export interface PhotoPickerProps {
  photos?: { src: string; alt?: string }[];
  /** Default 6. */
  max?: number;
  label?: string;
  hint?: React.ReactNode;
  onAdd?: () => void;
  className?: string;
}
export declare function PhotoPicker(props: PhotoPickerProps): React.ReactElement;

export interface TableColumn<Row = any> { key: string; header: React.ReactNode; align?: 'left' | 'right'; width?: string; render?: (row: Row) => React.ReactNode }
export interface TableProps<Row = any> { columns: TableColumn<Row>[]; rows: Row[]; rowKey?: (row: Row, index: number) => string | number; selected?: string | number; caption?: string; className?: string }
export declare function Table<Row = any>(props: TableProps<Row>): React.ReactElement;

export interface NoticeProps { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }
export declare function Notice(props: NoticeProps): React.ReactElement;

export interface EmptyStateProps { title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; icon?: IconName; className?: string }
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;

export interface TransactionLine { label: React.ReactNode; minor?: string | number | bigint; decimals?: number; symbol?: string; escrow?: boolean; value?: React.ReactNode; note?: React.ReactNode; total?: boolean }
export interface TransactionProps {
  title: React.ReactNode;
  /** The program instruction, shown in mono under the title: "create_order". */
  instruction?: string;
  /** sign: waiting for the wallet · sending: submitted · confirmed · failed: on-chain or simulation error · rejected: declined in the wallet */
  state?: 'sign' | 'sending' | 'confirmed' | 'failed' | 'rejected';
  children?: React.ReactNode;
  lines?: TransactionLine[];
  signature?: string;
  explorerHref?: string;
  error?: React.ReactNode;
  errorTitle?: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  /** Render as a page region instead of a dialog. */
  inline?: boolean;
  className?: string;
}
export declare function Transaction(props: TransactionProps): React.ReactElement;

declare global {
  interface Window {
    Katubaya: {
      Icon: typeof Icon; Button: typeof Button; Badge: typeof Badge; OrderStatus: typeof OrderStatus; Lifecycle: typeof Lifecycle;
      Amount: typeof Amount; Address: typeof Address; Field: typeof Field; Input: typeof Input; Select: typeof Select;
      OfferCard: typeof OfferCard; OfferPhoto: typeof OfferPhoto; PhotoPicker: typeof PhotoPicker; Table: typeof Table; Notice: typeof Notice; EmptyState: typeof EmptyState; Transaction: typeof Transaction;
      formatMinor: typeof formatMinor; formatQty: typeof formatQty;
    };
  }
}
