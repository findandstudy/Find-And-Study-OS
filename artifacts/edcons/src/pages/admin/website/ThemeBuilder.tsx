import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Palette } from "lucide-react";

export default function WebsiteThemeBuilder() {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Palette className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Theme Builder</h1>
        <p className="text-muted-foreground">Customize website theme tokens and styles. Coming soon.</p>
      </div>
    </DashboardLayout>
  );
}
