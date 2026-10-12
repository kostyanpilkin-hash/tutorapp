import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Student, StudentInput } from "@/types/student";
import { studentToInput } from "@/types/student";
import { api } from "@/lib/api";
import { CURRENCIES } from "@/lib/money";
import { COMMON_TIMEZONES, getTimezoneOffset, messengerUrl } from "@/lib/contacts";
import { StudentAvatar } from "./StudentAvatar";
import { LinkifiedText } from "@/components/LinkifiedText";
import { textHasLinks } from "@/lib/linkify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Textarea } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
  "#06b6d4", "#84cc16", "#f97316", "#6366f1", "#eab308", "#a855f7", "#0ea5e9",
  "#10b981", "#f43f5e", "#8b5cf6", "#14b8a6", "#0d9488", "#7c3aed", "#db2777",
];

interface Props {
  open: boolean;
  student?: Student | null;
  tutorTimezone: string;
  onClose: () => void;
  onSaved: (student: Student) => void;
  /** Поверх вложенных оверлеев (например, выбора учеников) */
  elevated?: boolean;
}

function toInput(s: Student): StudentInput {
  return studentToInput(s);
}

export function StudentFormDialog({ open, student, tutorTimezone, onClose, onSaved, elevated }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<StudentInput>({
    name: "",
    notes: "",
    lessonNote: "",
    defaultDuration: 60,
    defaultCurrency: "USD",
    paidLessons: 0,
  });
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoKey, setPhotoKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [previousCurrency, setPreviousCurrency] = useState<string>("USD");
  const [previousLink, setPreviousLink] = useState<string | null>(null);
  const [currencyChangeDialog, setCurrencyChangeDialog] = useState<{
    open: boolean;
    oldCurrency: string;
    newCurrency: string;
  } | null>(null);
  const [updateCostDialog, setUpdateCostDialog] = useState<{
    open: boolean;
    studentId: string;
    oldCurrency: string;
    newCurrency: string;
  } | null>(null);
  const [linkUpdateDialog, setLinkUpdateDialog] = useState<{
    open: boolean;
    count: number;
    link: string | null;
  } | null>(null);
  const [newCost, setNewCost] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    if (student) {
      setForm(toInput(student));
      setPhotoPath(student.photoPath ?? null);
      setCreatedId(null);
      setPreviousCurrency(student.defaultCurrency || "USD");
      setPreviousLink(student.defaultLink ?? null);
    } else {
      setForm({ name: "", notes: "", lessonNote: "", defaultDuration: 60, defaultCurrency: "USD", paidLessons: 0 });
      setPhotoPath(null);
      setCreatedId(null);
      setPreviousCurrency("USD");
      setPreviousLink(null);
    }
  }, [open, student]);

  const set = <K extends keyof StudentInput>(key: K, value: StudentInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const needsTimezone = form.timezone && form.timezone !== tutorTimezone;

  const studentId = student?.id ?? createdId;

  const handleLinkUpdate = async () => {
    const targetId = student?.id ?? createdId;
    if (!targetId || (previousLink ?? null) === (form.defaultLink ?? null)) {
      onClose();
      return;
    }
    const count = await api.countStudentLessonsForLinkUpdate(targetId, form.defaultLink || null);
    if (count === 0) {
      onClose();
      return;
    }
    setLinkUpdateDialog({ open: true, count, link: form.defaultLink || null });
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const targetId = student?.id ?? createdId;
    const currencyChanged =
      targetId && form.defaultCurrency && form.defaultCurrency !== previousCurrency;
    if (currencyChanged) {
      setCurrencyChangeDialog({
        open: true,
        oldCurrency: previousCurrency,
        newCurrency: form.defaultCurrency!,
      });
      return;
    }
    setSaving(true);
    try {
      await doSave();
      await handleLinkUpdate();
    } finally {
      setSaving(false);
    }
  };

  const doSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload: StudentInput = {
        ...form,
        parents: [form.parentName, form.parentPhone, form.parentMessenger]
          .filter((v) => v && String(v).trim())
          .join(", ") || null,
      };
      if (student) {
        const saved = await api.updateStudent(student.id, payload);
        onSaved(saved);
      } else if (createdId) {
        const saved = await api.updateStudent(createdId, payload);
        onSaved(saved);
      } else {
        const saved = await api.createStudent(payload);
        setCreatedId(saved.id);
        onSaved(saved);
        if (window.confirm(t("students.addPhotoNow"))) {
          const path = await api.pickStudentPhoto(saved.id);
          if (path) {
            setPhotoPath(path);
            setPhotoKey((k) => k + 1);
          }
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCurrencyChoice = async (updateAll: boolean) => {
    const dlg = currencyChangeDialog;
    setCurrencyChangeDialog(null);
    if (!dlg) return;
    if (updateAll) {
      setNewCost(form.defaultCost?.toString() ?? "");
      setUpdateCostDialog({
        open: true,
        studentId: student?.id ?? createdId ?? "",
        oldCurrency: dlg.oldCurrency,
        newCurrency: dlg.newCurrency,
      });
    } else {
      setSaving(true);
      try {
        await doSave();
        await handleLinkUpdate();
      } finally {
        setSaving(false);
      }
    }
  };

  const confirmUpdateCost = async () => {
    const dlg = updateCostDialog;
    setUpdateCostDialog(null);
    if (!dlg) return;
    const cost = Number(newCost);
    if (Number.isNaN(cost) || cost <= 0) return;
    setSaving(true);
    try {
      await doSave();
      await api.updateStudentLessonsCurrency(dlg.studentId, dlg.newCurrency, cost);
      await handleLinkUpdate();
    } finally {
      setSaving(false);
    }
  };

  const confirmLinkUpdate = async () => {
    const dlg = linkUpdateDialog;
    setLinkUpdateDialog(null);
    if (!dlg) return;
    const targetId = student?.id ?? createdId;
    if (!targetId) return;
    setSaving(true);
    try {
      await api.updateStudentLessonsLink(targetId, dlg.link);
    } finally {
      setSaving(false);
    }
    onClose();
  };

  const skipLinkUpdate = () => {
    setLinkUpdateDialog(null);
    onClose();
  };

  const pickPhoto = async () => {
    if (!studentId) return;
    const path = await api.pickStudentPhoto(studentId);
    if (path) {
      setPhotoPath(path);
      setPhotoKey((k) => k + 1);
    }
  };

  const removePhoto = async () => {
    if (!studentId) return;
    const updated = await api.removeStudentPhoto(studentId);
    setPhotoPath(updated.photoPath ?? null);
  };

  const openMessenger = () => {
    const url = messengerUrl(form.messenger, form.phone);
    if (url) void openUrl(url);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[90vh] max-w-lg overflow-y-auto",
          elevated && "z-[120]",
        )}
        overlayClassName={elevated ? "z-[115]" : undefined}
      >
        <DialogHeader>
          <DialogTitle>{student ? t("students.edit") : t("students.new")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {studentId && (
            <div className="flex items-center gap-3">
              <StudentAvatar
                key={photoKey}
                photoPath={photoPath}
                name={form.name}
                color={form.color}
                className="h-16 w-16"
                textClassName="text-lg"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void pickPhoto()}>
                  {t("students.photo")}
                </Button>
                {photoPath && (
                  <Button size="sm" variant="outline" onClick={() => void removePhoto()}>
                    {t("students.removePhoto")}
                  </Button>
                )}
              </div>
            </div>
          )}

          <div>
            <Label>{t("students.name")}</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("students.phone")}</Label>
              <Input value={form.phone || ""} onChange={(e) => set("phone", e.target.value || null)} />
            </div>
            <div>
              <Label>{t("students.email")}</Label>
              <Input value={form.email || ""} onChange={(e) => set("email", e.target.value || null)} />
            </div>
          </div>
          <div>
            <Label>{t("students.messenger")}</Label>
            <div className="flex gap-2">
              <Input
                className="flex-1"
                value={form.messenger || ""}
                onChange={(e) => set("messenger", e.target.value || null)}
                placeholder="@username"
              />
              {(form.messenger || form.phone) && (
                <Button type="button" variant="outline" onClick={openMessenger}>
                  {t("students.openMessenger")}
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{t("students.parents")}</p>
            <div>
              <Label>{t("students.parentName")}</Label>
              <Input value={form.parentName || ""} onChange={(e) => set("parentName", e.target.value || null)} />
            </div>
            <div>
              <Label>{t("students.parentPhone")}</Label>
              <Input value={form.parentPhone || ""} onChange={(e) => set("parentPhone", e.target.value || null)} />
            </div>
            <div>
              <Label>{t("students.parentMessenger")}</Label>
              <Input value={form.parentMessenger || ""} onChange={(e) => set("parentMessenger", e.target.value || null)} placeholder="@username" />
            </div>
          </div>
          <div>
            <Label>{t("students.birthDate")}</Label>
            <Input type="date" value={form.birthDate || ""} onChange={(e) => set("birthDate", e.target.value || null)} />
          </div>
          <div>
            <Label>{t("students.timezone")}</Label>
            <Select
              value={form.timezone || "__none__"}
              onValueChange={(v) => set("timezone", v === "__none__" ? null : v)}
            >
              <SelectTrigger><SelectValue placeholder={t("students.timezoneOptional")} /></SelectTrigger>
              <SelectContent portal={false}>
                <SelectItem value="__none__">{t("students.timezoneSame")}</SelectItem>
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz} ({getTimezoneOffset(tz)})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsTimezone && (
              <p className="mt-1 text-xs text-muted-foreground">{t("students.timezoneHint")}</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>{t("students.defaultCost")}</Label>
              <Input
                type="number"
                value={form.defaultCost ?? ""}
                onChange={(e) => set("defaultCost", e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div>
              <Label>{t("students.defaultCurrency")}</Label>
              <Select
                value={form.defaultCurrency || "USD"}
                onValueChange={(v) => set("defaultCurrency", v as StudentInput["defaultCurrency"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent portal={false}>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("students.defaultDuration")}</Label>
              <Input
                type="number"
                value={form.defaultDuration ?? 60}
                onChange={(e) => set("defaultDuration", Number(e.target.value))}
              />
            </div>
          </div>
          <div>
            <Label>{t("students.paidLessons")}</Label>
            <p className="mb-1 text-xs text-muted-foreground">{t("students.paidLessonsHint")}</p>
            <Input
              type="number"
              min="0"
              value={form.paidLessons ?? 0}
              onChange={(e) => set("paidLessons", Math.max(0, Number(e.target.value)))}
            />
          </div>
          <div>
            <Label>{t("students.defaultLink")}</Label>
            <div className="flex gap-2">
              <Input value={form.defaultLink || ""} onChange={(e) => set("defaultLink", e.target.value || null)} />
              {form.defaultLink?.trim() && (
                <Button type="button" variant="outline" onClick={() => void openUrl(form.defaultLink!)}>
                  {t("lesson.openLink")}
                </Button>
              )}
            </div>
          </div>
          <div>
            <Label>{t("students.color")}</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="h-7 w-7 rounded-full ring-offset-2"
                  style={{
                    backgroundColor: c,
                    outline: form.color === c ? `2px solid ${c}` : undefined,
                  }}
                  onClick={() => set("color", c)}
                />
              ))}
            </div>
          </div>
          <div>
            <Label>{t("students.notes")}</Label>
            <p className="mb-1 text-xs text-muted-foreground">{t("students.lessonNoteHint")}</p>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            {textHasLinks(form.notes) && (
              <LinkifiedText className="mt-1.5 text-sm" text={form.notes} />
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>{t("students.cancel")}</Button>
            <Button disabled={saving || !form.name.trim()} onClick={() => void save()}>
              {t("students.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog
      open={currencyChangeDialog?.open ?? false}
      onOpenChange={(v) => !v && setCurrencyChangeDialog(null)}
    >
      <DialogContent className="max-w-md z-[130]" overlayClassName="z-[125]">
        <DialogHeader>
          <DialogTitle>{t("students.currencyChangedTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("students.currencyChangedDesc", {
            old: currencyChangeDialog?.oldCurrency,
            new: currencyChangeDialog?.newCurrency,
          })}
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={() => handleCurrencyChoice(true)}>
            {t("students.currencyUpdateAll")}
          </Button>
          <Button variant="outline" onClick={() => handleCurrencyChoice(false)}>
            {t("students.currencyFutureOnly")}
          </Button>
          <Button variant="ghost" onClick={() => setCurrencyChangeDialog(null)}>
            {t("students.cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog
      open={updateCostDialog?.open ?? false}
      onOpenChange={(v) => !v && setUpdateCostDialog(null)}
    >
      <DialogContent className="max-w-md z-[130]" overlayClassName="z-[125]">
        <DialogHeader>
          <DialogTitle>{t("students.newCostTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("students.newCostDesc", { currency: updateCostDialog?.newCurrency })}
        </p>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={newCost}
          onChange={(e) => setNewCost(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setUpdateCostDialog(null)}>
            {t("students.cancel")}
          </Button>
          <Button
            disabled={!newCost || Number(newCost) <= 0}
            onClick={() => void confirmUpdateCost()}
          >
            {t("students.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog
      open={linkUpdateDialog?.open ?? false}
      onOpenChange={(v) => !v && skipLinkUpdate()}
    >
      <DialogContent className="max-w-md z-[130]" overlayClassName="z-[125]">
        <DialogHeader>
          <DialogTitle>{t("students.linkUpdateTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("students.linkUpdateDesc", { count: linkUpdateDialog?.count })}
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={() => void confirmLinkUpdate()}>
            {t("students.linkUpdateAction")}
          </Button>
          <Button variant="outline" onClick={skipLinkUpdate}>
            {t("students.linkUpdateSkip")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
