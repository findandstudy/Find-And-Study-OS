import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { History } from "lucide-react";

export default function WebsitePublishHistory() {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <History className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Publish History</h1>
        <p className="text-muted-foreground">View page version history and publishing logs. Coming soon.</p>
      </div>
    </DashboardLayout>
  );
}
