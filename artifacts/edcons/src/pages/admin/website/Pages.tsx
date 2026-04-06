import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { FileText } from "lucide-react";

export default function WebsitePages() {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FileText className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Pages</h1>
        <p className="text-muted-foreground">Manage your website pages. Coming soon.</p>
      </div>
    </DashboardLayout>
  );
}
