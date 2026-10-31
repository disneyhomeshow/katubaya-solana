import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// The design system first: it installs window.React for its bundle and loads tokens and component styles.
import "./design-system";
import "./styles/app.css";
import { App } from "./App";
import { SessionProvider } from "./state/session";
import { TxProvider } from "./tx/TxProvider";
import { WalletProvider } from "./wallet/WalletProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <SessionProvider>
          <TxProvider>
            <App />
          </TxProvider>
        </SessionProvider>
      </WalletProvider>
    </BrowserRouter>
  </StrictMode>,
);
