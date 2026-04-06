import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ClipboardList } from "lucide-react";

export default function WebsiteForms() {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ClipboardList className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Forms</h1>
        <p className="text-muted-foreground">Build and manage website forms. Coming soon.</p>
      </div>
    </DashboardLayout>
  );
}
