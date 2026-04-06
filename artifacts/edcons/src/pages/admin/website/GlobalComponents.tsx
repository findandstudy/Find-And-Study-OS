import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Component } from "lucide-react";

export default function WebsiteGlobalComponents() {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Component className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Global Components</h1>
        <p className="text-muted-foreground">Manage reusable website components. Coming soon.</p>
      </div>
    </DashboardLayout>
  );
}
