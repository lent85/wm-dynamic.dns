import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { App } from "./App.js";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "rgb(15, 23, 42)",
              color: "rgb(241, 245, 249)",
              border: "1px solid rgb(51, 65, 85)",
            },
          }}
        />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
