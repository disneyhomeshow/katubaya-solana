// Katūbayá design system, consumed as published: tokens.css, bundle.css and bundle.js are copied
// verbatim from the design-system artifact; this module only exposes window.Katubaya with its types.
import "./react-global";
import "./bundle.js";
import "./tokens.css";
import "./bundle.css";
import type { OrderStatusCode, Tone, IconName, TransactionLine, TableColumn, UnitCode } from "./katubaya";

const K = window.Katubaya;

export const Icon = K.Icon;
export const Button = K.Button;
export const Badge = K.Badge;
export const OrderStatus = K.OrderStatus;
export const Lifecycle = K.Lifecycle;
export const Amount = K.Amount;
export const Address = K.Address;
export const Field = K.Field;
export const Input = K.Input;
export const Select = K.Select;
export const OfferCard = K.OfferCard;
export const OfferPhoto = K.OfferPhoto;
export const PhotoPicker = K.PhotoPicker;
export const Table = K.Table;
export const Notice = K.Notice;
export const EmptyState = K.EmptyState;
export const Transaction = K.Transaction;
export const formatMinor = K.formatMinor;
export const formatQty = K.formatQty;

export type { OrderStatusCode, Tone, IconName, TransactionLine, TableColumn, UnitCode };
