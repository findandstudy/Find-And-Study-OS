import { useI18n } from "@/hooks/use-i18n";

interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
}

export function calcPasswordStrength(password: string): StrengthResult {
  if (!password) return { score: 0, label: "", color: "" };
  const hasMin = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasLong = password.length >= 12;
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  const score = [hasMin, hasUpper, hasDigit, hasLong || hasSpecial].filter(Boolean).length as 0 | 1 | 2 | 3 | 4;

  return { score, label: "", color: "" };
}

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < 8) return "min8";
  if (!/[A-Z]/.test(password)) return "needsUpper";
  if (!/[0-9]/.test(password)) return "needsDigit";
  return null;
}

const LEVEL_CONFIG = [
  { color: "bg-destructive", textColor: "text-destructive" },
  { color: "bg-orange-400", textColor: "text-orange-500" },
  { color: "bg-yellow-400", textColor: "text-yellow-500" },
  { color: "bg-emerald-500", textColor: "text-emerald-600" },
];

interface Props {
  password: string;
}

export function PasswordStrengthIndicator({ password }: Props) {
  const { t } = useI18n();

  if (!password) return null;

  const { score } = calcPasswordStrength(password);

  const labels = [
    t("password.weak"),
    t("password.fair"),
    t("password.good"),
    t("password.strong"),
  ];

  const levelIdx = Math.max(0, score - 1);
  const config = LEVEL_CONFIG[levelIdx];
  const labelText = labels[levelIdx];

  const requirements = [
    { met: password.length >= 8, text: t("password.req8Chars") },
    { met: /[A-Z]/.test(password), text: t("password.reqUppercase") },
    { met: /[0-9]/.test(password), text: t("password.reqDigit") },
  ];

  return (
    <div className="space-y-2 mt-1.5">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                n <= score ? config.color : "bg-secondary"
              }`}
            />
          ))}
        </div>
        <span className={`text-xs font-semibold ${config.textColor} min-w-[40px] text-right`}>
          {labelText}
        </span>
      </div>
      <ul className="space-y-0.5">
        {requirements.map((r) => (
          <li key={r.text} className={`text-xs flex items-center gap-1.5 ${r.met ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
            <span className={`w-3 h-3 rounded-full flex items-center justify-center shrink-0 ${r.met ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-secondary"}`}>
              {r.met ? (
                <svg viewBox="0 0 10 10" className="w-2 h-2 fill-emerald-600 dark:fill-emerald-400"><path d="M1.5 5L4 7.5 8.5 3"/></svg>
              ) : (
                <span className="w-1 h-1 rounded-full bg-muted-foreground/40 block" />
              )}
            </span>
            {r.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
