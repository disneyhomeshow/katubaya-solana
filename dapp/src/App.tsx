import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoadError, Loading } from "./components/States";
import { Connect } from "./pages/onboarding/Connect";
import { Role } from "./pages/onboarding/Role";
import { ChooseWarehouse } from "./pages/customer/ChooseWarehouse";
import { CustomerPending } from "./pages/customer/Pending";
import { Market } from "./pages/customer/Market";
import { Checkout } from "./pages/customer/Checkout";
import { Orders } from "./pages/customer/Orders";
import { OrderDetail } from "./pages/customer/OrderDetail";
import { FarmerRegister } from "./pages/farmer/Register";
import { FarmerPending } from "./pages/farmer/Pending";
import { FarmerOffers } from "./pages/farmer/Offers";
import { FarmerPublish } from "./pages/farmer/Publish";
import { FarmerManageOffer } from "./pages/farmer/ManageOffer";
import { FarmerSales } from "./pages/farmer/Sales";
import { WarehouseYard } from "./pages/warehouse/Yard";
import { ProgramMap } from "./pages/admin/ProgramMap";
import { useSession } from "./state/session";

/** "/" opens the screen that matches what the connected wallet holds. */
function Home() {
  const { wallet, profile, loading, error, reload } = useSession();
  if (!wallet) return <Connect />;
  if (loading || !profile) {
    return (
      <Layout area="onboarding">
        <div className="page">{error ? <LoadError error={error} onRetry={reload} /> : <Loading />}</div>
      </Layout>
    );
  }
  // A program that was never set up has nothing to show anyone but the wallet that sets it up.
  if (profile.isAdmin || !profile.config) return <Navigate to="/admin" replace />;
  if (profile.operated.length) return <Navigate to="/warehouse" replace />;
  if (profile.farmer) return <Navigate to="/farmer" replace />;
  if (profile.confirmed.length) return <Navigate to="/market" replace />;
  if (profile.pending.length) return <Navigate to="/customer/pending" replace />;
  if (profile.customer) return <Navigate to="/customer/warehouse" replace />;
  return <Navigate to="/start" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/connect" element={<Connect />} />
      <Route path="/start" element={<Role />} />
      <Route path="/market" element={<Market />} />
      <Route path="/offers/:offer" element={<Checkout />} />
      <Route path="/orders" element={<Orders />} />
      <Route path="/orders/:order" element={<OrderDetail />} />
      <Route path="/customer/warehouse" element={<ChooseWarehouse />} />
      <Route path="/customer/pending" element={<CustomerPending />} />
      <Route path="/farmer" element={<FarmerOffers />} />
      <Route path="/farmer/register" element={<FarmerRegister />} />
      <Route path="/farmer/pending" element={<FarmerPending />} />
      <Route path="/farmer/publish" element={<FarmerPublish />} />
      <Route path="/farmer/offers/:offer" element={<FarmerManageOffer />} />
      <Route path="/farmer/sales" element={<FarmerSales />} />
      <Route path="/warehouse" element={<WarehouseYard />} />
      <Route path="/warehouse/:warehouse" element={<WarehouseYard />} />
      <Route path="/admin" element={<ProgramMap />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
