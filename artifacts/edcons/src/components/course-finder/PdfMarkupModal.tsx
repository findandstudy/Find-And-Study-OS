import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Info, DollarSign, ArrowRight, Eraser, AlertTriangle } from "lucide-react";

const MAX_MARKUP = 100_000;

type PdfMarkupModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentMarkup: number;
  onApply: (amount: number) => void;
  currency?: string;
  sampleFee?: number | null;
  hasMultipleCurrencies?: boolean;
};

function formatCurrency(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${amount.toLocaleString()}`;
  }
}

export function PdfMarkupModal({ open, onOpenChange, currentMarkup, onApply, currency = "USD", sampleFee, hasMultipleCurrencies }: PdfMarkupModalProps) {
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (open) {
      setAmount(currentMarkup > 0 ? String(currentMarkup) : "");
    }
  }, [open, currentMarkup]);

  const parsed = Number(amount) || 0;
  const numericAmount = Math.min(Math.max(0, Math.floor(parsed)), MAX_MARKUP);
  const preview = sampleFee != null && sampleFee > 0 ? sampleFee : 1000;
  const isValid = !hasMultipleCurrencies && Number.isFinite(numericAmount);

  function handleApply() {
    if (!isValid) return;
    onApply(numericAmount);
    onOpenChange(false);
  }

  function handleClear() {
    onApply(0);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" />
            PDF Fee Adjustment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
              This adjustment applies <strong>only to the PDF export</strong>. On-screen prices and database records remain unchanged.
            </p>
          </div>

          {hasMultipleCurrencies && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                Selected programs use different currencies. Fee adjustment is only available when all selected programs share the same currency.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-medium">Additional Service Fee ({currency})</Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="number"
                min={0}
                max={MAX_MARKUP}
                step={1}
                placeholder="0"
                value={amount}
                disabled={hasMultipleCurrencies}
                onChange={e => {
                  const v = e.target.value;
                  if (v === "" || Number(v) >= 0) setAmount(v);
                }}
                className="pl-9 h-11 rounded-xl text-lg font-semibold"
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Enter a whole number to add on top of each program's service fee in the PDF (max {MAX_MARKUP.toLocaleString()}).
            </p>
          </div>

          {numericAmount > 0 && !hasMultipleCurrencies && (
            <div className="p-4 bg-muted/50 rounded-xl border space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Preview (per program)</p>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Original Fee</p>
                  <p className="text-sm font-semibold">{formatCurrency(preview, currency)}</p>
                </div>
                <div className="flex items-center gap-1 text-primary">
                  <span className="text-sm font-bold">+</span>
                  <span className="text-sm font-bold">{formatCurrency(numericAmount, currency)}</span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">PDF Fee</p>
                  <p className="text-sm font-bold text-green-600 dark:text-green-400">{formatCurrency(preview + numericAmount, currency)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            {currentMarkup > 0 ? (
              <Button variant="ghost" size="sm" onClick={handleClear} className="text-destructive hover:text-destructive gap-1.5">
                <Eraser className="w-3.5 h-3.5" />
                Clear Markup
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleApply} disabled={!isValid || numericAmount <= 0} className="gap-1.5">
                Apply to PDF
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
