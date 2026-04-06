import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Menu } from "lucide-react";

export default function WebsiteNavigation() {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Menu className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Navigation</h1>
        <p className="text-muted-foreground">Manage website navigation menus. Coming soon.</p>
      </div>
    </DashboardLayout>
  );
}
