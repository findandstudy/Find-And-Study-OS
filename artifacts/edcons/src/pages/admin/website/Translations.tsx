import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Languages } from "lucide-react";

export default function WebsiteTranslations() {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Languages className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Translations</h1>
        <p className="text-muted-foreground">Manage website content translations. Coming soon.</p>
      </div>
    </DashboardLayout>
  );
}
