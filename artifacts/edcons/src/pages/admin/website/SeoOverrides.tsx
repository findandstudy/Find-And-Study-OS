import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Search } from "lucide-react";

export default function WebsiteSeoOverrides() {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Search className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">SEO Overrides</h1>
        <p className="text-muted-foreground">Manage per-page SEO settings. Coming soon.</p>
      </div>
    </DashboardLayout>
  );
}
