import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, addYears, format } from "date-fns";
import { ru, enUS, be as beLocale } from "date-fns/locale";
import type { FinancePeriod, FinanceReport } from "@/types/lesson";
import type { DebtEntry } from "@/types/student";
import { api } from "@/lib/api";
import { PaymentDetailsPanel } from "@/components/finance/PaymentDetailsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, numberLocaleFromLang, sortCurrencies } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toastStore";

const locales = { ru, en: enUS, be: beLocale };

const PERIODS: FinancePeriod[] = ["day", "week", "month", "year", "custom"];

function localAnchorIso(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).toISOString();
}

function AmountList({
  title,
  items,
  className,
  locale,
}: {
  title: string;
  items: { currency: string; amount: number }[];
  className?: string;
  locale: string;
}) {
  const sorted = sortCurrencies(items.map((i) => i.currency))
    .map((currency) => items.find((i) => i.currency === currency)!)
    .filter(Boolean);

  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>
      {sorted.length === 0 ? (
        <p className="text-2xl font-semibold">—</p>
      ) : (
        <div className="space-y-1">
          {sorted.map((item) => (
            <p key={item.currency} className="text-2xl font-semibold tabular-nums">
              {formatMoney(item.amount, item.currency, locale)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function DebtsList({
  debts,
  locale,
  payingDebt,
  onMarkPaid,
  t,
}: {
  debts: DebtEntry[];
  locale: string;
  payingDebt: string | null;
  onMarkPaid: (debt: DebtEntry) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: debts.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 37,
    overscan: 10,
    getItemKey: (index) => `${debts[index].lessonId}-${debts[index].studentId}`,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const padTop = virtualItems.length ? virtualItems[0].start : 0;
  const padBottom = virtualItems.length
    ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
    : 0;

  const totals = new Map<string, number>();
  for (const d of debts) {
    totals.set(d.currency, (totals.get(d.currency) ?? 0) + d.cost);
  }
  const totalItems = sortCurrencies([...totals.keys()]).map((currency) => ({
    currency,
    amount: totals.get(currency)!,
  }));

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{t("finance.debtsTitle")}</h3>
        {totalItems.length > 0 && (
          <div className="flex gap-3 text-sm">
            {totalItems.map((item) => (
              <span key={item.currency} className="font-semibold text-amber-600 tabular-nums">
                {formatMoney(item.amount, item.currency, locale)}
              </span>
            ))}
          </div>
        )}
      </div>
      {debts.length === 0 ? (
        <div className="py-6 text-center">
          <p className="font-display text-base font-semibold">{t("finance.debtsEmpty")}</p>
        </div>
      ) : (
        <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 pr-4">{t("finance.debtsDate")}</th>
                <th className="pb-2 pr-4">{t("finance.historyStudent")}</th>
                <th className="pb-2 pr-4">{t("lesson.subject")}</th>
                <th className="pb-2 pr-4">{t("lesson.status")}</th>
                <th className="pb-2 pr-4">{t("finance.debtsAmount")}</th>
                <th className="pb-2 text-right">{t("finance.payment")}</th>
              </tr>
            </thead>
            <tbody>
              {padTop > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={6} style={{ height: padTop, padding: 0, border: 0 }} />
                </tr>
              )}
              {virtualItems.map((vi) => {
                const d = debts[vi.index];
                return (
                <tr
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  className="border-b border-border/50"
                >
                  <td className="py-2 pr-4 text-muted-foreground">
                    {format(new Date(d.startAt), "dd.MM.yyyy HH:mm")}
                  </td>
                  <td className="py-2 pr-4 font-medium">{d.studentName}</td>
                  <td className="py-2 pr-4">{d.subject || "—"}</td>
                  <td className="py-2 pr-4">
                    {t(`status.${d.status}`, d.status)}
                  </td>
                  <td className="py-2 pr-4 font-semibold text-amber-600 tabular-nums">
                    {formatMoney(d.cost, d.currency, locale)}
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      size="sm"
                      onClick={() => onMarkPaid(d)}
                      disabled={payingDebt === `${d.lessonId}-${d.studentId}`}
                    >
                      {t("finance.paid")}
                    </Button>
                  </td>
                </tr>
              );
              })}
              {padBottom > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={6} style={{ height: padBottom, padding: 0, border: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function FinancePanel() {
  const { t, i18n } = useTranslation();
  const locale = locales[i18n.language as keyof typeof locales] || ru;
  const [tab, setTab] = useState<"report" | "debts" | "details">("report");
  const [period, setPeriod] = useState<FinancePeriod>("month");
  const [anchor, setAnchor] = useState(new Date());
  const [customFrom, setCustomFrom] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [debts, setDebts] = useState<DebtEntry[]>([]);
  const [payingDebt, setPayingDebt] = useState<string | null>(null);
  const showSuccess = useToastStore((state) => state.success);

  const loadDebts = useCallback(async () => {
    try {
      setDebts(await api.getDebtLessons());
    } catch {
      setDebts([]);
    }
  }, []);

  useEffect(() => {
    if (tab === "debts") void loadDebts();
  }, [tab, loadDebts]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fromIso = customFrom ? new Date(`${customFrom}T00:00:00`).toISOString() : undefined;
      const toIso = customTo ? new Date(`${customTo}T23:59:59`).toISOString() : undefined;
      const data = await api.getFinanceReport(
        period,
        localAnchorIso(anchor),
        period === "custom" ? fromIso : undefined,
        period === "custom" ? toIso : undefined,
      );
      setReport(data);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [period, anchor, customFrom, customTo]);

  const markDebtPaid = async (debt: DebtEntry) => {
    const key = `${debt.lessonId}-${debt.studentId}`;
    setPayingDebt(key);
    try {
      await api.markDebtPaid(debt.lessonId, debt.studentId);
      await Promise.all([loadDebts(), load()]);
      showSuccess(t("finance.paymentRecorded"));
    } finally {
      setPayingDebt(null);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const shiftAnchor = (dir: -1 | 1) => {
    setAnchor((a) => {
      if (period === "day") return addDays(a, dir);
      if (period === "week") return addDays(a, dir * 7);
      if (period === "month") return addMonths(a, dir);
      if (period === "year") return addYears(a, dir);
      return a;
    });
  };

  const periodLabel = () => {
    if (period === "custom") return `${customFrom} — ${customTo}`;
    return format(anchor, "MMM yyyy", { locale });
  };

  const chartCurrencies = sortCurrencies([
    ...new Set(report?.timeline.map((p) => p.currency) ?? []),
  ]);

  const chartByCurrency = chartCurrencies.map((currency) => {
    const points = report?.timeline.filter((p) => p.currency === currency) ?? [];
    const labels = [...new Set(points.map((p) => p.label))];
    return {
      currency,
      data: labels.map((label) => {
        const point = points.find((p) => p.label === label);
        return {
          name: label,
          earned: point?.earned ?? 0,
          debt: point?.debt ?? 0,
          expected: point?.expected ?? 0,
        };
      }),
    };
  });

  const numberLocale = numberLocaleFromLang(i18n.language);

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-auto p-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{t("finance.title")}</h2>
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          <Button
            size="sm"
            variant={tab === "report" ? "default" : "ghost"}
            onClick={() => setTab("report")}
          >
            {t("finance.tabs.report")}
          </Button>
          <Button
            size="sm"
            variant={tab === "debts" ? "default" : "ghost"}
            onClick={() => setTab("debts")}
          >
            {t("finance.tabs.debts")}
          </Button>
          <Button
            size="sm"
            variant={tab === "details" ? "default" : "ghost"}
            onClick={() => setTab("details")}
          >
            {t("finance.tabs.details")}
          </Button>
        </div>
      </div>

      {tab === "debts" ? (
        <DebtsList
          debts={debts}
          locale={numberLocale}
          payingDebt={payingDebt}
          onMarkPaid={markDebtPaid}
          t={t}
        />
      ) : tab === "details" ? (
        <PaymentDetailsPanel />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={period === p ? "default" : "outline"}
                  onClick={() => setPeriod(p)}
                >
                  {t(`finance.period.${p}`)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {period !== "custom" ? (
              <>
                <Button size="icon" variant="outline" onClick={() => shiftAnchor(-1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-48 text-center font-medium">{periodLabel()}</span>
                <Button size="icon" variant="outline" onClick={() => shiftAnchor(1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>
                  {t("finance.today")}
                </Button>
              </>
            ) : (
              <>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-40" />
                <span className="text-muted-foreground">—</span>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-40" />
                <span className="min-w-48 text-center text-sm font-medium">{periodLabel()}</span>
              </>
            )}
          </div>

          {loading && !report && (
            <div className="grid animate-pulse gap-3 md:grid-cols-3">
              <div className="h-24 rounded-xl bg-muted" />
              <div className="h-24 rounded-xl bg-muted" />
              <div className="h-24 rounded-xl bg-muted" />
            </div>
          )}

          {report && (
            <>
              <div className="grid animate-fade-up gap-3 md:grid-cols-3">
                <AmountList title={t("finance.earned")} items={report.earned} className="border-green-200" locale={numberLocale} />
                <AmountList title={t("finance.debt")} items={report.debt} className="border-amber-200" locale={numberLocale} />
                <AmountList title={t("finance.expected")} items={report.expected} className="border-blue-200" locale={numberLocale} />
              </div>

              {chartByCurrency.length > 0 && (
                <div className="space-y-4">
                  {chartByCurrency.map(({ currency, data }) => (
                    <div key={currency} className="rounded-xl border border-border bg-card p-4">
                      <h3 className="mb-4 font-medium">
                        {t("finance.chartTitle")} · {currency}
                      </h3>
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip
                            formatter={(value, name) => [
                              formatMoney(Number(value), currency, numberLocale),
                              String(name),
                            ]}
                          />
                          <Legend />
                          <Bar dataKey="earned" name={t("finance.earned")} fill="#22c55e" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="debt" name={t("finance.debt")} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="expected" name={t("finance.expected")} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-3 font-medium">{t("finance.bySubject")}</h3>
                {report.bySubject.length === 0 ? (
                  <div className="py-6 text-center">
                    <p className="font-display text-base font-semibold">{t("finance.noData")}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t("today.emptyHint")}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="pb-2 pr-4">{t("lesson.subject")}</th>
                          <th className="pb-2 pr-4">{t("lesson.currency")}</th>
                          <th className="pb-2 pr-4">{t("finance.earned")}</th>
                          <th className="pb-2 pr-4">{t("finance.debt")}</th>
                          <th className="pb-2">{t("finance.expected")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.bySubject.map((row) => (
                          <tr key={`${row.subject}-${row.currency}`} className="border-b border-border/50">
                            <td className="py-2 pr-4 font-medium">{row.subject}</td>
                            <td className="py-2 pr-4">{row.currency}</td>
                            <td className="py-2 pr-4 text-green-600">
                              {row.earned ? formatMoney(row.earned, row.currency, numberLocale) : "—"}
                            </td>
                            <td className="py-2 pr-4 text-amber-600">
                              {row.debt ? formatMoney(row.debt, row.currency, numberLocale) : "—"}
                            </td>
                            <td className="py-2 text-blue-600">
                              {row.expected ? formatMoney(row.expected, row.currency, numberLocale) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
