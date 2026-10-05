// Isolated browser fixture; only mocked HTTP, no app bootstrap, login or database.
import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { I18nProvider } from "../../src/lib/i18n/context";
import "../../src/index.css";

const PageEditor = lazy(() => import("../../src/pages/admin/website/PageEditor"));

function Fixture() {
  const [location] = useLocation();
  const pageId = location.match(/\/pages\/(\d+)\/edit$/)?.[1];
  return pageId || window.location.search.includes("editor")
    ? <Suspense fallback={<p>Loading editor fixture</p>}><PageEditor id={Number(pageId || 1)} /></Suspense>
    : <h1>Pages list fixture</h1>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider><Fixture /></I18nProvider></QueryClientProvider>);
