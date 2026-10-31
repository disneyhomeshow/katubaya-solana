// What the connected wallet is on Katūbayá: program admin, warehouse operator, farmer, customer (and which
// warehouses confirmed it), or new.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { Address } from "@solana/kit";
import {
  WarehouseCustomerStatus,
  type CustomerProfile,
  type FarmerProfile,
  type ProgramConfig,
  type Warehouse,
  type WarehouseCustomer,
} from "../generated";
import {
  fetchConfig,
  fetchCustomerProfile,
  fetchFarmerProfile,
  fetchWarehouses,
  listCustomerLinks,
  listWarehousesByOperator,
  type Account,
} from "../solana/accounts";
import { useWallet } from "../wallet/WalletProvider";
import { useAsync } from "./useAsync";

export type WarehouseLink = { link: Account<WarehouseCustomer>; warehouse: Account<Warehouse> | undefined };

export type Profile = {
  config: Account<ProgramConfig> | null;
  /** The wallet holds the program key (`config.admin`). */
  isAdmin: boolean;
  /** Warehouses this wallet operates, A–Z. */
  operated: Account<Warehouse>[];
  farmer: Account<FarmerProfile> | null;
  farmerWarehouse: Account<Warehouse> | null;
  customer: Account<CustomerProfile> | null;
  links: WarehouseLink[];
  confirmed: WarehouseLink[];
  pending: WarehouseLink[];
  revoked: WarehouseLink[];
};

export type Session = {
  wallet: Address | undefined;
  profile: Profile | undefined;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
};

async function loadProfile(wallet: Address | undefined): Promise<Profile> {
  const [config, farmer, customer, links, operated] = await Promise.all([
    fetchConfig(),
    wallet ? fetchFarmerProfile(wallet) : null,
    wallet ? fetchCustomerProfile(wallet) : null,
    wallet ? listCustomerLinks(wallet) : [],
    wallet ? listWarehousesByOperator(wallet) : [],
  ]);
  const warehouses = await fetchWarehouses([
    ...links.map((l) => l.data.warehouse),
    ...(farmer ? [farmer.data.warehouse] : []),
  ]);
  const withWarehouse = links
    .map((link) => ({ link, warehouse: warehouses.get(link.data.warehouse) }))
    .sort((a, b) => (a.warehouse?.data.name ?? "").localeCompare(b.warehouse?.data.name ?? ""));
  const by = (s: WarehouseCustomerStatus) => withWarehouse.filter((l) => l.link.data.status === s);
  return {
    config,
    isAdmin: !!wallet && !!config && config.data.admin === wallet,
    operated,
    farmer,
    farmerWarehouse: farmer ? (warehouses.get(farmer.data.warehouse) ?? null) : null,
    customer,
    links: withWarehouse,
    confirmed: by(WarehouseCustomerStatus.Confirmed),
    pending: by(WarehouseCustomerStatus.Pending),
    revoked: by(WarehouseCustomerStatus.Revoked),
  };
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address } = useWallet();
  const state = useAsync(() => loadProfile(address), [address]);
  // While someone waits on a warehouse, check again every 20 s so the screen opens by itself.
  const waiting =
    !!state.data && ((state.data.farmer && !state.data.farmer.data.warehouseApproved) || state.data.pending.length > 0);
  const { reload } = state;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 20000);
    return () => clearInterval(timer);
  }, [waiting, reload]);
  const value = useMemo<Session>(
    () => ({
      wallet: address,
      profile: state.data,
      loading: state.loading && !state.data,
      error: state.error,
      reload: state.reload,
    }),
    [address, state.data, state.loading, state.error, state.reload],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}
