import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUPPORTED_CURRENCIES, CURRENCY_SYMBOLS } from "@/lib/currency";
import { useI18n } from "@/hooks/use-i18n";
import type { CurrencyFilter } from "@/hooks/use-currency-preference";

interface Props {
  value: CurrencyFilter;
  onChange: (v: CurrencyFilter) => void;
  includeAll?: boolean;
  className?: string;
  triggerClassName?: string;
}

export function CurrencySelector({ value, onChange, includeAll = true, className, triggerClassName }: Props) {
  const { t } = useI18n();
  return (
    <div className={className}>
      <Select value={value} onValueChange={(v) => onChange(v as CurrencyFilter)}>
        <SelectTrigger className={triggerClassName || "h-9 w-[180px]"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_CURRENCIES.map((c) => (
            <SelectItem key={c} value={c}>
              <span className="inline-flex items-center gap-2">
                <span className="text-muted-foreground w-4 inline-block text-center">{CURRENCY_SYMBOLS[c]}</span>
                <span>{c}</span>
              </span>
            </SelectItem>
          ))}
          {includeAll && (
            <SelectItem value="all">{t("currencyAllLabel")}</SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
