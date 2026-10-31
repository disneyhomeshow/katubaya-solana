import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { Account } from "@solana/kit";
import { Layout } from "../../components/Layout";
import { ConnectFirst, Loading, NetworkNotices } from "../../components/States";
import type { FarmerProfile, Warehouse } from "../../generated";
import { useSession } from "../../state/session";
import type { Address } from "@solana/kit";

export type ApprovedFarmer = { wallet: Address; farmer: Account<FarmerProfile>; warehouse: Account<Warehouse> | null };

/** Farmer screens open only for an approved farmer; everyone else is sent to the step they are on. */
export function FarmerGate({ children }: { children: (farmer: ApprovedFarmer) => ReactNode }) {
  const { wallet, profile, loading } = useSession();
  if (!wallet) {
    return (
      <Layout area="farmer">
        <div className="page">
          <NetworkNotices />
          <ConnectFirst title="Connect a wallet to see your offers">Your offers live on Solana under your wallet. Katūbayá never holds your keys.</ConnectFirst>
        </div>
      </Layout>
    );
  }
  if (loading || !profile) {
    return (
      <Layout area="farmer">
        <div className="page">
          <Loading />
        </div>
      </Layout>
    );
  }
  if (!profile.farmer) return <Navigate to="/farmer/register" replace />;
  if (!profile.farmer.data.warehouseApproved) return <Navigate to="/farmer/pending" replace />;
  return <>{children({ wallet, farmer: profile.farmer, warehouse: profile.farmerWarehouse })}</>;
}
