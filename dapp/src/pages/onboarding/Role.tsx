// Design: "Onboarding · Choose a profile" (OnboardRole).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { NetworkNotices } from "../../components/States";
import { Button, Notice } from "../../design-system";

type Role = "customer" | "farmer";

export function Role() {
  const [role, setRole] = useState<Role>("customer");
  const navigate = useNavigate();
  const go = (r: Role) => navigate(r === "customer" ? "/customer/warehouse" : "/farmer/register");
  return (
    <Layout area="onboarding">
      <div className="page page-narrow">
        <NetworkNotices />
        <div className="stack gap-2">
          <h1 className="t-display">How will you use katūbayá?</h1>
          <p className="t-body muted">
            This wallet has no profile yet. Pick one to start; a profile is a small account on Solana that your wallet pays the rent
            for.
          </p>
        </div>
        <fieldset className="role-grid">
          <legend className="sr-only">Choose a profile</legend>
          <label className="role">
            <span className="role-head">
              <input type="radio" name="role" checked={role === "customer"} onChange={() => setRole("customer")} />
              <span className="t-heading">I buy harvests</span>
            </span>
            <span>
              Create a customer profile and ask a warehouse near you to confirm you. Once it has your address, you can order any offer
              it routes.
            </span>
            <span className="t-small muted">Next: choose a warehouse</span>
          </label>
          <label className="role">
            <span className="role-head">
              <input type="radio" name="role" checked={role === "farmer"} onChange={() => setRole("farmer")} />
              <span className="t-heading">I sell my harvest</span>
            </span>
            <span>
              Create a farmer profile with your farm's name and ask a warehouse to approve you. Then publish offers it will deliver.
            </span>
            <span className="t-small muted">Next: your farm and warehouse</span>
          </label>
        </fieldset>
        <div className="row">
          <Button variant="primary" size="lg" onClick={() => go(role)}>
            {role === "customer" ? "Continue as a customer" : "Continue as a farmer"}
          </Button>
          <Button size="lg" onClick={() => go(role === "customer" ? "farmer" : "customer")}>
            {role === "customer" ? "Continue as a farmer" : "Continue as a customer"}
          </Button>
        </div>
        <Notice tone="info" title="Run a warehouse?">
          Warehouses are created by the program admin. Connect the operator wallet you gave them and your queue opens directly.
        </Notice>
      </div>
    </Layout>
  );
}
