import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BookOpen } from "lucide-react";

export default function WebsiteBlog() {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <BookOpen className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Blog</h1>
        <p className="text-muted-foreground">Manage blog posts, categories, and tags. Coming soon.</p>
      </div>
    </DashboardLayout>
  );
}
