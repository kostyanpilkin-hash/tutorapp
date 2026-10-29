import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { BookOpen } from "lucide-react";
import QRCode from "qrcode";
import { useSettingsStore } from "@/stores/settingsStore";
import { api } from "@/lib/api";
import type { MessageTemplate } from "@/lib/messageTemplates";
import { loadMessageTemplates, saveMessageTemplates } from "@/lib/messageTemplates";
import { useToastStore } from "@/stores/toastStore";
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
import type { CalendarView } from "@/types/lesson";
import { COMMON_TIMEZONES, getTimezoneOffset } from "@/lib/contacts";
import { ThemePreview } from "@/components/settings/ThemePreview";
import { ThemePickerDialog } from "@/components/settings/ThemePickerDialog";
import i18n from "@/i18n";

const REMINDER_OPTIONS = [
  { value: 1440, key: "reminder.dayBefore" },
  { value: 60, key: "reminder.hourBefore" },
  { value: 30, key: "reminder.min30" },
  { value: 15, key: "reminder.min15" },
  { value: 5, key: "reminder.min5" },
  { value: 0, key: "reminder.atStart" },
] as const;

export function SettingsPanel() {
  const { t } = useTranslation();
  const {
    language,
    theme,
    timezone,
    defaultDuration,
    defaultReminders,
    defaultCalendarView,
    setLanguage,
    setTimezone,
    setDefaultCalendarView,
    setDefaultDuration,
    setDefaultReminders,
  } = useSettingsStore();
  const toast = useToastStore();
  const [autostart, setAutostart] = useState(false);
  const [dbPath, setDbPath] = useState("");
  const [durationDraft, setDurationDraft] = useState(String(defaultDuration));
  const [reminder1, setReminder1] = useState(String(defaultReminders[0] ?? 15));
  const [reminder2, setReminder2] = useState(
    defaultReminders.length > 1 ? String(defaultReminders[1]) : "",
  );
  const [reminder3, setReminder3] = useState(
    defaultReminders.length > 2 ? String(defaultReminders[2]) : "",
  );
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [phoneLink, setPhoneLink] = useState<string | null>(null);
  const [phoneQr, setPhoneQr] = useState("");

  useEffect(() => {
    void isEnabled().then(setAutostart);
    void api.getDbPath().then(setDbPath).catch(() => setDbPath(""));
    void loadMessageTemplates().then(setTemplates).catch(() => setTemplates([]));
    void api.getPhoneLink().then(setPhoneLink).catch(() => setPhoneLink(null));
  }, []);

  useEffect(() => {
    if (!phoneLink) {
      setPhoneQr("");
      return;
    }
    void QRCode.toString(phoneLink, { type: "svg", margin: 1 }).then(setPhoneQr).catch(() => setPhoneQr(""));
  }, [phoneLink]);

  const togglePhone = async () => {
    await api.setPhoneServer(!phoneLink);
    await api.getPhoneLink().then(setPhoneLink).catch(() => setPhoneLink(null));
  };

  useEffect(() => {
    setDurationDraft(String(defaultDuration));
  }, [defaultDuration]);

  useEffect(() => {
    setReminder1(String(defaultReminders[0] ?? 15));
    setReminder2(defaultReminders.length > 1 ? String(defaultReminders[1]) : "");
    setReminder3(defaultReminders.length > 2 ? String(defaultReminders[2]) : "");
  }, [defaultReminders]);

  const changeLang = async (lang: string) => {
    await setLanguage(lang);
    void i18n.changeLanguage(lang);
  };

  const toggleAutostart = async () => {
    if (autostart) {
      await disable();
      setAutostart(false);
    } else {
      await enable();
      setAutostart(true);
    }
  };

  const saveDuration = async () => {
    const n = Number(durationDraft);
    if (!Number.isFinite(n) || n < 15) {
      toast.error(t("settings.durationInvalid"));
      return;
    }
    await setDefaultDuration(n);
    toast.success(t("settings.saved"));
  };

  const saveReminders = async () => {
    const list = [Number(reminder1)];
    if (reminder2 !== "") list.push(Number(reminder2));
    if (reminder3 !== "") list.push(Number(reminder3));
    if (list.some((n) => Number.isNaN(n) || n < 0)) {
      toast.error(t("settings.remindersInvalid"));
      return;
    }
    await setDefaultReminders(list);
    toast.success(t("settings.saved"));
  };

  const updateTemplate = (id: string, patch: Partial<MessageTemplate>) => {
    setTemplates((current) => current.map((template) => (
      template.id === id ? { ...template, ...patch } : template
    )));
  };

  const addTemplate = () => {
    setTemplates((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        title: "",
        body: "",
      },
    ]);
  };

  const removeTemplate = (id: string) => {
    setTemplates((current) => current.filter((template) => template.id !== id));
  };

  const saveTemplates = async () => {
    const cleaned = templates
      .map((template) => ({
        ...template,
        title: template.title.trim(),
        body: template.body.trim(),
      }))
      .filter((template) => template.title || template.body);
    if (cleaned.some((template) => !template.title || !template.body)) {
      toast.error(t("settings.templateInvalid"));
      return;
    }
    await saveMessageTemplates(cleaned);
    setTemplates(cleaned);
    toast.success(t("settings.saved"));
  };

  const doBackup = async () => {
    setBusy(true);
    try {
      const path = await api.backupDatabase();
      if (path) toast.success(`${t("settings.backupDone")}: ${path}`);
      else toast.info(t("settings.backupCancelled"));
    } finally {
      setBusy(false);
    }
  };

  const copyPath = async () => {
    if (!dbPath) return;
    await navigator.clipboard.writeText(dbPath);
    toast.success(t("settings.pathCopied"));
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">{t("app.settings")}</h2>
      <div className="grid gap-3">
        <div>
          <Label>{t("settings.language")}</Label>
          <Select value={language} onValueChange={(v) => void changeLang(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ru">Русский</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="be">Беларуская</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("settings.theme")}</Label>
          <div className="flex items-center gap-3">
            <ThemePreview theme={theme} className="w-28" />
            <span className="text-sm font-medium">{t(`settings.themes.${theme}`)}</span>
            <Button
              type="button"
              variant="outline"
              className="ml-auto"
              onClick={() => setThemePickerOpen(true)}
            >
              {t("settings.chooseTheme")}
            </Button>
          </div>
          <ThemePickerDialog open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
        </div>
        <div>
          <Label>{t("settings.timezone")}</Label>
          <Select value={timezone} onValueChange={(v) => void setTimezone(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMMON_TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>{tz} ({getTimezoneOffset(tz)})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("settings.defaultCalendarView")}</Label>
          <Select value={defaultCalendarView} onValueChange={(v) => void setDefaultCalendarView(v as CalendarView)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">{t("views.day")}</SelectItem>
              <SelectItem value="week">{t("views.week")}</SelectItem>
              <SelectItem value="month">{t("views.month")}</SelectItem>
              <SelectItem value="agenda">{t("views.agenda")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-2">
          <Label>{t("settings.defaultDuration")}</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              min={15}
              max={240}
              value={durationDraft}
              onChange={(e) => setDurationDraft(e.target.value)}
            />
            <Button variant="outline" onClick={() => void saveDuration()}>{t("settings.save")}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("settings.durationHint")}</p>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-2">
          <Label>{t("settings.defaultReminders")}</Label>
          <div className="grid gap-2 md:grid-cols-3">
            <div>
              <Label className="text-xs">{t("lesson.reminderFirst")}</Label>
              <Select value={reminder1} onValueChange={setReminder1}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REMINDER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{t(o.key)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("lesson.reminderSecond")}</Label>
              <Select value={reminder2 || "__none__"} onValueChange={(v) => setReminder2(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("settings.noSecondReminder")}</SelectItem>
                  {REMINDER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{t(o.key)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("lesson.reminderThird")}</Label>
              <Select value={reminder3 || "__none__"} onValueChange={(v) => setReminder3(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("settings.noThirdReminder")}</SelectItem>
                  {REMINDER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{t(o.key)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button variant="outline" onClick={() => void saveReminders()}>{t("settings.saveReminders")}</Button>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-3">
          <div>
            <Label>{t("settings.messageTemplates")}</Label>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.messageTemplatesHint")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.templateVariablesLabel")}: <code>{"{{name}}, {{parentName}}, {{link}}, {{subject}}, {{time}}"}</code>
            </p>
          </div>
          <div className="space-y-3">
            {templates.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("settings.templatesEmpty")}</p>
            )}
            {templates.map((template) => (
              <div key={template.id} className="rounded-lg border border-border p-3 space-y-2">
                <div>
                  <Label className="text-xs">{t("settings.templateTitle")}</Label>
                  <Input
                    value={template.title}
                    onChange={(e) => updateTemplate(template.id, { title: e.target.value })}
                    placeholder={t("settings.templateTitlePlaceholder")}
                  />
                </div>
                <div>
                  <Label className="text-xs">{t("settings.templateBody")}</Label>
                  <Textarea
                    value={template.body}
                    onChange={(e) => updateTemplate(template.id, { body: e.target.value })}
                    placeholder={t("settings.templateBodyPlaceholder")}
                    className="min-h-[120px]"
                  />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => removeTemplate(template.id)}>
                    {t("settings.deleteTemplate")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={addTemplate}>{t("settings.addTemplate")}</Button>
            <Button variant="outline" onClick={() => void saveTemplates()}>{t("settings.saveTemplates")}</Button>
          </div>
        </div>

        <Button variant="outline" onClick={() => void toggleAutostart()}>
          {t("settings.autostart")}: {autostart ? t("settings.on") : t("settings.off")}
        </Button>

        <div className="rounded-lg border border-border p-3 space-y-2">
          <Label>{t("settings.data")}</Label>
          <p className="break-all text-xs text-muted-foreground">{dbPath || "—"}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copyPath()} disabled={!dbPath}>
              {t("settings.copyPath")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void doBackup()} disabled={busy}>
              {t("settings.backup")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void api.createDesktopShortcut().then(() => toast.success(t("settings.shortcutDone")))}>
              {t("settings.shortcut")}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-2">
          <Label>{t("settings.phoneTitle")}</Label>
          <p className="text-xs text-muted-foreground">{t("settings.phoneHint")}</p>
          <Button variant="outline" onClick={() => void togglePhone()}>
            {t("settings.phoneToggle")}: {phoneLink ? t("settings.on") : t("settings.off")}
          </Button>
          {phoneLink && (
            <>
              <p className="break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">{phoneLink}</p>
              {phoneQr && (
                <div
                  className="inline-block rounded-lg bg-white p-2 [&>svg]:h-40 [&>svg]:w-40"
                  dangerouslySetInnerHTML={{ __html: phoneQr }}
                />
              )}
              <p className="text-xs text-muted-foreground">{t("settings.phoneFirewall")}</p>
            </>
          )}
        </div>

        <Button variant="outline" onClick={() => setHelpOpen(true)} className="w-full">
          <BookOpen className="mr-2 h-4 w-4" />
          {t("settings.help")}
        </Button>
      </div>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("settings.helpTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="mb-2 font-semibold">{t("help.quickStart.title")}</h3>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>{t("help.quickStart.step1")}</li>
                <li>{t("help.quickStart.step2")}</li>
                <li>{t("help.quickStart.step3")}</li>
                <li>{t("help.quickStart.step4")}</li>
              </ol>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">{t("help.students.title")}</h3>
              <p className="text-muted-foreground">{t("help.students.description")}</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground mt-2">
                <li>{t("help.students.create")}</li>
                <li>{t("help.students.edit")}</li>
                <li>{t("help.students.archive")}</li>
                <li>{t("help.students.paidLessons")}</li>
              </ul>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">{t("help.lessons.title")}</h3>
              <p className="text-muted-foreground">{t("help.lessons.description")}</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground mt-2">
                <li>{t("help.lessons.create")}</li>
                <li>{t("help.lessons.recurring")}</li>
                <li>{t("help.lessons.dragDrop")}</li>
                <li>{t("help.lessons.contextMenu")}</li>
                <li>{t("help.lessons.editScope")}</li>
              </ul>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">{t("help.calendar.title")}</h3>
              <p className="text-muted-foreground">{t("help.calendar.description")}</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground mt-2">
                <li>{t("help.calendar.views")}</li>
                <li>{t("help.calendar.navigation")}</li>
                <li>{t("help.calendar.doubleClick")}</li>
              </ul>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">{t("help.finance.title")}</h3>
              <p className="text-muted-foreground">{t("help.finance.description")}</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground mt-2">
                <li>{t("help.finance.tracking")}</li>
                <li>{t("help.finance.paymentDetails")}</li>
                <li>{t("help.finance.reports")}</li>
              </ul>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">{t("help.reminders.title")}</h3>
              <p className="text-muted-foreground">{t("help.reminders.description")}</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground mt-2">
                <li>{t("help.reminders.setup")}</li>
                <li>{t("help.reminders.default")}</li>
                <li>{t("help.reminders.snooze")}</li>
              </ul>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">{t("help.shortcuts.title")}</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li><kbd className="bg-muted px-1 rounded">Ctrl+N</kbd> - {t("help.shortcuts.newLesson")}</li>
                <li><kbd className="bg-muted px-1 rounded">Ctrl+1</kbd> - {t("help.shortcuts.today")}</li>
                <li><kbd className="bg-muted px-1 rounded">Ctrl+2</kbd> - {t("help.shortcuts.calendar")}</li>
                <li><kbd className="bg-muted px-1 rounded">Ctrl+3</kbd> - {t("help.shortcuts.students")}</li>
                <li><kbd className="bg-muted px-1 rounded">Ctrl+4</kbd> - {t("help.shortcuts.reminders")}</li>
                <li><kbd className="bg-muted px-1 rounded">Ctrl+5</kbd> - {t("help.shortcuts.finance")}</li>
                <li><kbd className="bg-muted px-1 rounded">Ctrl+6</kbd> - {t("help.shortcuts.settings")}</li>
              </ul>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">{t("help.data.title")}</h3>
              <p className="text-muted-foreground">{t("help.data.description")}</p>
              <p className="text-muted-foreground mt-2">{t("help.data.backup")}</p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
