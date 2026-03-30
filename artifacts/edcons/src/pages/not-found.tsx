import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useI18n } from "@/hooks/use-i18n";

export default function NotFound() {
  const { t, localePath } = useI18n();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6 text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground mb-2">{t("notFound.title")}</h1>
          <p className="text-sm text-muted-foreground mb-6">
            {t("notFound.description")}
          </p>
          <Button asChild>
            <Link href={localePath("/")}>{t("notFound.goHome")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
