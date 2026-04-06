import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Layers } from "lucide-react";

export default function WebsiteCollections() {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Layers className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Collections</h1>
        <p className="text-muted-foreground">Manage offices, team members, FAQs, and testimonials. Coming soon.</p>
      </div>
    </DashboardLayout>
  );
}
