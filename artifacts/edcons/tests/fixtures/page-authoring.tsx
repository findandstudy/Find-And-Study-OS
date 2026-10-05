// Local browser fixture only; no app bootstrap, authentication or database.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "wouter";
import WebsitePages from "../../src/pages/admin/website/Pages";
import PageEditor from "../../src/pages/admin/website/PageEditor";
import ProgramDetail from "../../src/pages/public/ProgramDetail";
import UniversityDetail from "../../src/pages/public/UniversityDetail";
import CountryDetail from "../../src/pages/public/CountryDetail";
import CityDetail from "../../src/pages/public/CityDetail";
import DetailContentEditor from "../../src/pages/admin/website/DetailContentEditor";
import { DETAIL_CONTENT_KINDS } from "../../src/lib/website/detailContentContract";
import { PublicLayout } from "../../src/components/layout/PublicLayout";
import { ThemeProvider } from "../../src/contexts/ThemeContext";
import { I18nProvider } from "../../src/lib/i18n/context";
import "../../src/index.css";

function Fixture() {
  const [location] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const detailKind = params.get("detail");
  const kind = DETAIL_CONTENT_KINDS.find(value => value === detailKind);
  if (kind) {
    const collection = { destination: "countries", city: "cities", university: "universities", program: "programs" }[kind];
    return <DetailContentEditor target={{ kind, entityId: 42, locale: "en", title: "Synthetic catalogue record", sourceEditPath: "/admin/catalog", canonicalPath: `/en/${collection}/fixture-42` }} onClose={() => {}} />;
  }
  const publicKind = new URLSearchParams(window.location.search).get("public");
  if (publicKind) return <ThemeProvider><PublicLayout>{publicKind === "program" ? <ProgramDetail routeKey="a-level-145793" /> : publicKind === "country" ? <CountryDetail slug="united-kingdom" /> : publicKind === "city" ? <CityDetail routeKey="london-2" /> : <UniversityDetail routeKey="abbey-dld-colleges-1563" />}</PublicLayout></ThemeProvider>;
  const pageId = location.match(/\/pages\/(\d+)\/edit$/)?.[1];
  return pageId || window.location.search.includes("editor") ? <PageEditor id={Number(pageId || 1)} /> : <WebsitePages />;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider><Fixture /></I18nProvider></QueryClientProvider>);
