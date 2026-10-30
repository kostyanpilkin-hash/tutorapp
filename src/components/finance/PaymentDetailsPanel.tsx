import { useEffect, useState } from "react";
import { Copy, CreditCard, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { keys } from "@/lib/queryKeys";
import { useToastStore } from "@/stores/toastStore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label, Textarea } from "@/components/ui/label";

const SETTINGS_KEY = "payment_details";

interface PaymentDetailsGroup {
  id: string;
  title: string;
  details: string;
}

const INITIAL_GROUPS: PaymentDetailsGroup[] = [];

function parseGroups(raw: string | undefined): PaymentDetailsGroup[] {
  if (raw === undefined) return INITIAL_GROUPS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PaymentDetailsGroup =>
        typeof item?.id === "string" &&
        typeof item?.title === "string" &&
        typeof item?.details === "string",
    );
  } catch {
    return [];
  }
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `details-${Date.now()}`;
}

export function PaymentDetailsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");

  const settingsQuery = useQuery({
    queryKey: keys.settings(),
    queryFn: () => api.getSettings(),
  });
  const groups = parseGroups(settingsQuery.data?.[SETTINGS_KEY]);
  const loading = settingsQuery.isPending;

  // Заполнить дефолтными реквизитами при первом запуске
  useEffect(() => {
    if (settingsQuery.data && settingsQuery.data[SETTINGS_KEY] === undefined) {
      void api
        .setSetting(SETTINGS_KEY, JSON.stringify(parseGroups(undefined)))
        .then(() => queryClient.invalidateQueries({ queryKey: keys.settings() }));
    }
  }, [settingsQuery.data, queryClient]);

  const persist = async (next: PaymentDetailsGroup[]) => {
    await api.setSetting(SETTINGS_KEY, JSON.stringify(next));
    await queryClient.invalidateQueries({ queryKey: keys.settings() });
  };

  const openCreate = () => {
    setEditingId(null);
    setTitle("");
    setDetails("");
    setDialogOpen(true);
  };

  const openEdit = (group: PaymentDetailsGroup) => {
    setEditingId(group.id);
    setTitle(group.title);
    setDetails(group.details);
    setDialogOpen(true);
  };

  const save = async () => {
    const cleanTitle = title.trim();
    const cleanDetails = details.trim();
    if (!cleanTitle || !cleanDetails) {
      useToastStore.getState().error(t("finance.paymentDetails.required"));
      return;
    }

    const next = editingId
      ? groups.map((group) =>
          group.id === editingId
            ? { ...group, title: cleanTitle, details: cleanDetails }
            : group,
        )
      : [...groups, { id: createId(), title: cleanTitle, details: cleanDetails }];

    await persist(next);
    setDialogOpen(false);
    useToastStore.getState().success(t("finance.paymentDetails.saved"));
  };

  const remove = async (group: PaymentDetailsGroup) => {
    if (!window.confirm(t("finance.paymentDetails.deleteConfirm", { name: group.title }))) {
      return;
    }
    await persist(groups.filter((item) => item.id !== group.id));
    useToastStore.getState().info(t("finance.paymentDetails.deleted"));
  };

  const copy = async (group: PaymentDetailsGroup) => {
    await navigator.clipboard.writeText(group.details);
    useToastStore.getState().success(t("finance.paymentDetails.copied"));
  };

  return (
    <>
      <section className="rounded-2xl border border-border bg-card/90 p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              <h3 className="font-display text-xl font-semibold tracking-tight">
                {t("finance.paymentDetails.title")}
              </h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("finance.paymentDetails.hint")}
            </p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("finance.paymentDetails.add")}
          </Button>
        </div>

        {loading ? (
          <div className="grid animate-pulse gap-3 md:grid-cols-2">
            <div className="h-36 rounded-xl bg-muted" />
            <div className="h-36 rounded-xl bg-muted" />
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
            <p className="font-medium">{t("finance.paymentDetails.empty")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("finance.paymentDetails.emptyHint")}
            </p>
            <Button className="mt-4" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("finance.paymentDetails.add")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {groups.map((group) => (
              <article
                key={group.id}
                className="animate-fade-up flex min-h-48 flex-col rounded-xl border border-border bg-background/70 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-semibold">{group.title}</h4>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("finance.paymentDetails.edit")}
                      onClick={() => openEdit(group)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("finance.paymentDetails.delete")}
                      onClick={() => void remove(group)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <pre className="mt-2 max-h-44 flex-1 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-muted-foreground">
                  {group.details}
                </pre>
                <Button className="mt-4 w-full" onClick={() => void copy(group)}>
                  <Copy className="h-4 w-4" />
                  {t("finance.paymentDetails.copy")}
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? t("finance.paymentDetails.editTitle")
                : t("finance.paymentDetails.newTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="payment-details-title">
                {t("finance.paymentDetails.name")}
              </Label>
              <Input
                id="payment-details-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("finance.paymentDetails.namePlaceholder")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="payment-details-body">
                {t("finance.paymentDetails.details")}
              </Label>
              <Textarea
                id="payment-details-body"
                className="min-h-64 resize-y font-mono"
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                placeholder={t("finance.paymentDetails.detailsPlaceholder")}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t("students.cancel")}
              </Button>
              <Button onClick={() => void save()}>{t("students.save")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
