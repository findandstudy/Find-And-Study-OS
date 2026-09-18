// Local browser fixture only; no app bootstrap, authentication or database.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "wouter";
import WebsitePages from "../../src/pages/admin/website/Pages";
import PageEditor from "../../src/pages/admin/website/PageEditor";
import ProgramDetail from "../../src/pages/public/ProgramDetail";
import UniversityDetail from "../../src/pages/public/UniversityDetail";
import { PublicLayout } from "../../src/components/layout/PublicLayout";
import { ThemeProvider } from "../../src/contexts/ThemeContext";
import { I18nProvider } from "../../src/lib/i18n/context";
import "../../src/index.css";

function Fixture() {
  const [location] = useLocation();
  const publicKind = new URLSearchParams(window.location.search).get("public");
  if (publicKind) return <ThemeProvider><PublicLayout>{publicKind === "program" ? <ProgramDetail routeKey="a-level-145793" /> : <UniversityDetail routeKey="abbey-dld-colleges-1563" />}</PublicLayout></ThemeProvider>;
  return location.includes("/pages/1/edit") || window.location.search.includes("editor") ? <PageEditor id={1} /> : <WebsitePages />;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider><Fixture /></I18nProvider></QueryClientProvider>);
