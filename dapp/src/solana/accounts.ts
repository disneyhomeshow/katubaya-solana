// Reads from the chain through the Codama client: PDAs, decoders and discriminators all come from
// src/generated. getProgramAccounts filters on the discriminator and on fixed-offset pubkey fields.
import {
  fetchEncodedAccount,
  getBase58Decoder,
  parseBase64RpcAccount,
  type Address,
  type Account,
  type Base58EncodedBytes,
  type EncodedAccount,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  FARMER_CORE_PROGRAM_ADDRESS,
  FARMER_PROFILE_DISCRIMINATOR,
  LOT_OFFER_DISCRIMINATOR,
  ORDER_DISCRIMINATOR,
  WAREHOUSE_CUSTOMER_DISCRIMINATOR,
  WAREHOUSE_DISCRIMINATOR,
  decodeFarmerProfile,
  decodeLotOffer,
  decodeOrder,
  decodeWarehouse,
  decodeWarehouseCustomer,
  fetchAllMaybeFarmerProfile,
  fetchAllMaybeWarehouse,
  fetchMaybeCustomerProfile,
  fetchMaybeFarmerProfile,
  fetchMaybeLotOffer,
  fetchMaybeOrder,
  fetchMaybeProgramConfig,
  findConfigPda,
  findCustomerProfilePda,
  findEscrowPda,
  findFarmerProfilePda,
  type CustomerProfile,
  type FarmerProfile,
  type LotOffer,
  type Order,
  type ProgramConfig,
  type Warehouse,
  type WarehouseCustomer,
} from "../generated";
import { rpc } from "./rpc";

export type { Account };

// Byte offsets of the pubkey fields we filter on (8-byte discriminator first).
const OFFSET = {
  warehouseOperator: 16n,
  warehouseCustomerWarehouse: 8n,
  farmerProfileAuthority: 8n,
  farmerProfileWarehouse: 40n,
  warehouseCustomerCustomer: 40n,
  lotOfferFarmer: 8n,
  lotOfferWarehouse: 40n,
  orderOffer: 16n,
  orderFarmer: 48n,
  orderWarehouse: 80n,
  orderCustomer: 112n,
};

const b58 = getBase58Decoder();

function memcmp(offset: bigint, bytes: ReadonlyUint8Array | string) {
  return {
    memcmp: {
      offset,
      bytes: (typeof bytes === "string" ? bytes : b58.decode(bytes)) as Base58EncodedBytes,
      encoding: "base58" as const,
    },
  };
}

async function programAccounts<T extends object>(
  discriminator: ReadonlyUint8Array,
  decode: (account: EncodedAccount) => Account<T>,
  filters: ReturnType<typeof memcmp>[] = [],
): Promise<Account<T>[]> {
  const result = await rpc
    .getProgramAccounts(FARMER_CORE_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [memcmp(0n, discriminator), ...filters],
    })
    .send();
  return result.map(({ pubkey, account }) => decode(parseBase64RpcAccount(pubkey, account)));
}

// ---- Config and warehouses

export async function fetchConfig(): Promise<Account<ProgramConfig> | null> {
  const [pda] = await findConfigPda();
  const account = await fetchMaybeProgramConfig(rpc, pda);
  return account.exists ? account : null;
}

export async function listWarehouses(): Promise<Account<Warehouse>[]> {
  const all = await programAccounts(WAREHOUSE_DISCRIMINATOR, decodeWarehouse);
  return all.sort((a, b) => a.data.name.localeCompare(b.data.name));
}

export async function listWarehousesByOperator(operator: Address): Promise<Account<Warehouse>[]> {
  const all = await programAccounts(WAREHOUSE_DISCRIMINATOR, decodeWarehouse, [memcmp(OFFSET.warehouseOperator, operator)]);
  return all.sort((a, b) => a.data.name.localeCompare(b.data.name));
}

export async function fetchWarehouse(address: Address): Promise<Account<Warehouse> | null> {
  return (await fetchWarehouses([address])).get(address) ?? null;
}

export async function fetchWarehouses(addresses: Address[]): Promise<Map<string, Account<Warehouse>>> {
  const unique = [...new Set(addresses)];
  if (!unique.length) return new Map();
  const found = await fetchAllMaybeWarehouse(rpc, unique);
  return new Map(found.filter((a) => a.exists).map((a) => [a.address as string, a as Account<Warehouse>]));
}

// ---- Profiles

export async function fetchFarmerProfile(wallet: Address): Promise<Account<FarmerProfile> | null> {
  const [pda] = await findFarmerProfilePda({ farmer: wallet });
  const account = await fetchMaybeFarmerProfile(rpc, pda);
  return account.exists ? account : null;
}

export async function fetchFarmerProfiles(wallets: Address[]): Promise<Map<string, Account<FarmerProfile>>> {
  const unique = [...new Set(wallets)];
  if (!unique.length) return new Map();
  const pdas = await Promise.all(unique.map(async (farmer) => (await findFarmerProfilePda({ farmer }))[0]));
  const found = await fetchAllMaybeFarmerProfile(rpc, pdas);
  return new Map(
    found.filter((a) => a.exists).map((a) => [(a as Account<FarmerProfile>).data.authority as string, a as Account<FarmerProfile>]),
  );
}

export async function fetchCustomerProfile(wallet: Address): Promise<Account<CustomerProfile> | null> {
  const [pda] = await findCustomerProfilePda({ customer: wallet });
  const account = await fetchMaybeCustomerProfile(rpc, pda);
  return account.exists ? account : null;
}

/** Every warehouse link (pending, confirmed or revoked) of a customer wallet. */
export async function listCustomerLinks(customer: Address): Promise<Account<WarehouseCustomer>[]> {
  return programAccounts(WAREHOUSE_CUSTOMER_DISCRIMINATOR, decodeWarehouseCustomer, [
    memcmp(OFFSET.warehouseCustomerCustomer, customer),
  ]);
}

/** Every customer request a warehouse received, whatever its status. */
export async function listCustomerLinksByWarehouse(warehouse: Address): Promise<Account<WarehouseCustomer>[]> {
  return programAccounts(WAREHOUSE_CUSTOMER_DISCRIMINATOR, decodeWarehouseCustomer, [
    memcmp(OFFSET.warehouseCustomerWarehouse, warehouse),
  ]);
}

export async function listAllCustomerLinks(): Promise<Account<WarehouseCustomer>[]> {
  return programAccounts(WAREHOUSE_CUSTOMER_DISCRIMINATOR, decodeWarehouseCustomer);
}

/** Farmers who registered with a warehouse, approved or not. */
export async function listFarmersByWarehouse(warehouse: Address): Promise<Account<FarmerProfile>[]> {
  return programAccounts(FARMER_PROFILE_DISCRIMINATOR, decodeFarmerProfile, [memcmp(OFFSET.farmerProfileWarehouse, warehouse)]);
}

export async function listAllFarmers(): Promise<Account<FarmerProfile>[]> {
  return programAccounts(FARMER_PROFILE_DISCRIMINATOR, decodeFarmerProfile);
}

export async function listFarmersByWallet(wallet: Address): Promise<Account<FarmerProfile>[]> {
  return programAccounts(FARMER_PROFILE_DISCRIMINATOR, decodeFarmerProfile, [
    memcmp(OFFSET.farmerProfileAuthority, wallet),
  ]);
}

// ---- Offers

export async function listOffersByWarehouse(warehouse: Address): Promise<Account<LotOffer>[]> {
  return programAccounts(LOT_OFFER_DISCRIMINATOR, decodeLotOffer, [memcmp(OFFSET.lotOfferWarehouse, warehouse)]);
}

export async function listAllOffers(): Promise<Account<LotOffer>[]> {
  return programAccounts(LOT_OFFER_DISCRIMINATOR, decodeLotOffer);
}

export async function listOffersByFarmer(farmer: Address): Promise<Account<LotOffer>[]> {
  const all = await programAccounts(LOT_OFFER_DISCRIMINATOR, decodeLotOffer, [memcmp(OFFSET.lotOfferFarmer, farmer)]);
  return all.sort((a, b) => Number(b.data.createdAt - a.data.createdAt));
}

export async function fetchOffer(offer: Address): Promise<Account<LotOffer> | null> {
  const account = await fetchMaybeLotOffer(rpc, offer);
  return account.exists ? account : null;
}

// ---- Orders

function newestFirst(orders: Account<Order>[]): Account<Order>[] {
  return orders.sort((a, b) => Number(b.data.createdAt - a.data.createdAt));
}

export async function listOrdersByCustomer(customer: Address): Promise<Account<Order>[]> {
  return newestFirst(await programAccounts(ORDER_DISCRIMINATOR, decodeOrder, [memcmp(OFFSET.orderCustomer, customer)]));
}

export async function listOrdersByFarmer(farmer: Address): Promise<Account<Order>[]> {
  return newestFirst(await programAccounts(ORDER_DISCRIMINATOR, decodeOrder, [memcmp(OFFSET.orderFarmer, farmer)]));
}

export async function listOrdersByWarehouse(warehouse: Address): Promise<Account<Order>[]> {
  return newestFirst(await programAccounts(ORDER_DISCRIMINATOR, decodeOrder, [memcmp(OFFSET.orderWarehouse, warehouse)]));
}

export async function listAllOrders(): Promise<Account<Order>[]> {
  return newestFirst(await programAccounts(ORDER_DISCRIMINATOR, decodeOrder));
}

/** Whether an account (a token account, usually) exists on chain. */
export async function accountExists(address: Address): Promise<boolean> {
  return (await fetchEncodedAccount(rpc, address)).exists;
}

export async function listOrdersByOffer(offer: Address): Promise<Account<Order>[]> {
  return newestFirst(await programAccounts(ORDER_DISCRIMINATOR, decodeOrder, [memcmp(OFFSET.orderOffer, offer)]));
}

export async function fetchOrder(order: Address): Promise<Account<Order> | null> {
  const account = await fetchMaybeOrder(rpc, order);
  return account.exists ? account : null;
}

// ---- Tokens

export type MintInfo = { address: Address; decimals: number; tokenProgram: Address };

const mintCache = new Map<string, Promise<MintInfo | null>>();

/** Decimals and owning token program (SPL Token or Token-2022) of a mint. */
export function fetchMint(mint: Address): Promise<MintInfo | null> {
  let cached = mintCache.get(mint);
  if (!cached) {
    cached = fetchEncodedAccount(rpc, mint).then((account) => {
      // Mint layout: mint_authority COption<Pubkey> (36), supply u64 (8), decimals u8.
      if (!account.exists || account.data.length < 45) return null;
      return { address: mint, decimals: account.data[44], tokenProgram: account.programAddress };
    });
    cached.catch(() => mintCache.delete(mint));
    mintCache.set(mint, cached);
  }
  return cached;
}

export async function tokenAccountOf(owner: Address, mint: MintInfo): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: mint.address, tokenProgram: mint.tokenProgram });
  return ata;
}

/** Balance of a token account in minor units; null when the account does not exist. */
export async function tokenBalance(tokenAccount: Address): Promise<bigint | null> {
  const account = await fetchEncodedAccount(rpc, tokenAccount);
  if (!account.exists || account.data.length < 72) return null;
  // Token account layout: mint (32), owner (32), amount u64 LE.
  return new DataView(account.data.buffer, account.data.byteOffset + 64, 8).getBigUint64(0, true);
}

export async function escrowOf(order: Address): Promise<Address> {
  const [pda] = await findEscrowPda({ order });
  return pda;
}

export async function rentFor(bytes: number): Promise<bigint> {
  return rpc.getMinimumBalanceForRentExemption(BigInt(bytes)).send();
}
