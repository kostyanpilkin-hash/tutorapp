import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  Bell,
  Blocks,
  BookOpen,
  CalendarDays,
  Clock,
  Database,
  Globe,
  GraduationCap,
  Languages,
  MessageSquare,
  Palette,
  Power,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import QRCode from "qrcode";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/stores/settingsStore";
import { api } from "@/lib/api";
import { keys } from "@/lib/queryKeys";
import type { MessageTemplate } from "@/lib/messageTemplates";
import { loadMessageTemplates, saveMessageTemplates } from "@/lib/messageTemplates";
import { useToastStore } from "@/stores/toastStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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

const SECTIONS = [
  { id: "general", icon: SlidersHorizontal },
  { id: "appearance", icon: Palette },
  { id: "lessons", icon: GraduationCap },
  { id: "reminders", icon: Bell },
  { id: "templates", icon: MessageSquare },
  { id: "integrations", icon: Blocks },
  { id: "data", icon: Database },
  { id: "help", icon: BookOpen },
] as const;

type SettingsSection = (typeof SECTIONS)[number]["id"];

function SettingRow({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

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
  } = useSettingsStore(
    useShallow((s) => ({
      language: s.language,
      theme: s.theme,
      timezone: s.timezone,
      defaultDuration: s.defaultDuration,
      defaultReminders: s.defaultReminders,
      defaultCalendarView: s.defaultCalendarView,
      setLanguage: s.setLanguage,
      setTimezone: s.setTimezone,
      setDefaultCalendarView: s.setDefaultCalendarView,
      setDefaultDuration: s.setDefaultDuration,
      setDefaultReminders: s.setDefaultReminders,
    })),
  );
  const toast = useToastStore(
    useShallow((s) => ({ error: s.error, info: s.info, success: s.success })),
  );
  const queryClient = useQueryClient();
  const [autostart, setAutostart] = useState(false);
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
  const [section, setSection] = useState<SettingsSection>("general");
  const [helpOpen, setHelpOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const phoneQuery = useQuery({
    queryKey: keys.phone.links(),
    queryFn: () => api.getPhoneLinks(),
  });
  const phoneLinks = phoneQuery.data ?? [];
  const [phoneIdx, setPhoneIdx] = useState(0);
  const phoneLink = phoneLinks[phoneIdx] ?? phoneLinks[0] ?? null;
  const [phoneQr, setPhoneQr] = useState("");
  const reloadPhone = () => queryClient.invalidateQueries({ queryKey: ["phone"] });

  const [tgToken, setTgToken] = useState("");
  const tgQuery = useQuery({
    queryKey: keys.tg.status(),
    queryFn: () => api.tgStatus(),
    refetchInterval: 4000,
  });
  const tgState = tgQuery.data ?? null;
  const [tgCode, setTgCode] = useState("");
  const [tgUsername, setTgUsername] = useState("");
  const [tgBusy, setTgBusy] = useState(false);
  const [tgError, setTgError] = useState("");
  const reloadTg = () => queryClient.invalidateQueries({ queryKey: ["tg"] });

  const dbPathQuery = useQuery({
    queryKey: keys.meta.dbPath(),
    queryFn: () => api.getDbPath(),
    staleTime: Infinity,
  });
  const dbPath = dbPathQuery.data ?? "";

  useEffect(() => {
    void isEnabled().then(setAutostart);
    void loadMessageTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    setPhoneIdx(0);
  }, [phoneQuery.data]);

  useEffect(() => {
    if (!phoneLink) {
      setPhoneQr("");
      return;
    }
    void QRCode.toString(phoneLink, { type: "svg", margin: 1 }).then(setPhoneQr).catch(() => setPhoneQr(""));
  }, [phoneLink]);

  const setPhone = async (enabled: boolean) => {
    await api.setPhoneServer(enabled);
    await reloadPhone();
  };
  const resetPhoneKey = async () => {
    if (!window.confirm(t("settings.phoneResetConfirm"))) return;
    await api.resetPhoneKey();
    await reloadPhone();
  };

  const tgConnect = async () => {
    if (!tgToken.trim()) return;
    setTgBusy(true); setTgError("");
    try {
      const r = await api.tgConnect(tgToken.trim());
      setTgUsername(r.username);
      setTgCode(r.code);
      setTgToken("");
      await reloadTg();
    } catch (e) {
      setTgError(String(e));
    } finally {
      setTgBusy(false);
    }
  };
  const tgDisconnect = async () => {
    setTgBusy(true);
    try {
      await api.tgDisconnect();
      setTgCode(""); setTgUsername("");
      await reloadTg();
    } finally {
      setTgBusy(false);
    }
  };
  const tgTest = async () => {
    try { await api.tgTest(); } catch (e) { setTgError(String(e)); }
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

  const toggleAutostart = async (enabled: boolean) => {
    if (enabled) {
      await enable();
    } else {
      await disable();
    }
    setAutostart(await isEnabled());
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

  const generalSection = (
    <>
      <SettingRow icon={Languages} label={t("settings.language")}>
        <Select value={language} onValueChange={(v) => void changeLang(v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ru">Русский</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="be">Беларуская</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow icon={Globe} label={t("settings.timezone")}>
        <Select value={timezone} onValueChange={(v) => void setTimezone(v)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {COMMON_TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>{tz} ({getTimezoneOffset(tz)})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow icon={CalendarDays} label={t("settings.defaultCalendarView")}>
        <Select value={defaultCalendarView} onValueChange={(v) => void setDefaultCalendarView(v as CalendarView)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="week">{t("views.week")}</SelectItem>
            <SelectItem value="month">{t("views.month")}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow icon={Power} label={t("settings.autostart")}>
        <Switch checked={autostart} onCheckedChange={(v) => void toggleAutostart(v)} />
      </SettingRow>
    </>
  );

  const appearanceSection = (
    <>
      <SettingRow icon={Palette} label={t("settings.theme")} hint={t(`settings.themes.${theme}`)}>
        <div className="flex items-center gap-3">
          <ThemePreview theme={theme} className="w-28" />
          <Button
            type="button"
            variant="outline"
            onClick={() => setThemePickerOpen(true)}
          >
            {t("settings.chooseTheme")}
          </Button>
        </div>
      </SettingRow>
      <ThemePickerDialog open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
    </>
  );

  const lessonsSection = (
    <SettingRow icon={Clock} label={t("settings.defaultDuration")} hint={t("settings.durationHint")}>
      <div className="flex gap-2">
        <Input
          type="number"
          min={15}
          max={240}
          className="w-24"
          value={durationDraft}
          onChange={(e) => setDurationDraft(e.target.value)}
        />
        <Button variant="outline" onClick={() => void saveDuration()}>{t("settings.save")}</Button>
      </div>
    </SettingRow>
  );

  const remindersSection = (
    <>
      <SettingRow icon={Bell} label={t("lesson.reminderFirst")}>
        <Select value={reminder1} onValueChange={setReminder1}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {REMINDER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)}>{t(o.key)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow icon={Bell} label={t("lesson.reminderSecond")}>
        <Select value={reminder2 || "__none__"} onValueChange={(v) => setReminder2(v === "__none__" ? "" : v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("settings.noSecondReminder")}</SelectItem>
            {REMINDER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)}>{t(o.key)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow icon={Bell} label={t("lesson.reminderThird")}>
        <Select value={reminder3 || "__none__"} onValueChange={(v) => setReminder3(v === "__none__" ? "" : v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("settings.noThirdReminder")}</SelectItem>
            {REMINDER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)}>{t(o.key)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <Button variant="outline" onClick={() => void saveReminders()}>{t("settings.saveReminders")}</Button>
    </>
  );

  const templatesSection = (
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
  );

  const integrationsSection = (
    <>
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Label>{t("settings.phoneTitle")}</Label>
            {phoneLink && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {t("settings.phoneRunning")} · :{new URL(phoneLink).port}
              </span>
            )}
          </div>
          <Switch checked={!!phoneLink} onCheckedChange={(v) => void setPhone(v)} />
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.phoneHint")}</p>
        {phoneLink && (
          <>
            {phoneLinks.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {phoneLinks.map((l, i) => (
                  <button
                    key={l}
                    onClick={() => setPhoneIdx(i)}
                    className={`rounded-full px-2.5 py-0.5 font-mono text-xs transition ${
                      i === phoneIdx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    {new URL(l).hostname}
                  </button>
                ))}
              </div>
            )}
            <p className="break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">{phoneLink}</p>
            {phoneQr && (
              <div
                className="inline-block rounded-lg bg-white p-2 [&>svg]:h-40 [&>svg]:w-40"
                dangerouslySetInnerHTML={{ __html: phoneQr }}
              />
            )}
            <p className="text-xs text-muted-foreground">{t("settings.phoneFirewall")}</p>
            <Button variant="ghost" size="sm" onClick={() => void resetPhoneKey()}>
              {t("settings.phoneResetKey")}
            </Button>
          </>
        )}
      </div>

      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Label>{t("settings.tgTitle")}</Label>
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 text-xs",
              tgState?.linked ? "text-emerald-500" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                tgState?.linked ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            {tgState?.linked
              ? t("settings.tgStatusLinked", { user: tgState.username || tgUsername || "bot" })
              : t("settings.tgStatusOff")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.tgHint")}</p>
        {tgState?.lastError && (
          <p className="rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-500">{tgState.lastError}</p>
        )}
        {!tgState?.linked ? (
          <>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="123456789:AAH…"
                value={tgToken}
                onChange={(e) => setTgToken(e.target.value)}
              />
              <Button variant="outline" disabled={tgBusy || !tgToken.trim()} onClick={() => void tgConnect()}>
                {t("settings.tgConnect")}
              </Button>
            </div>
            {tgUsername && !tgState?.linked && (
              <p className="text-xs text-muted-foreground">@{tgUsername}</p>
            )}
            {tgCode && !tgState?.linked && (
              <div className="rounded bg-muted px-3 py-2 text-sm">
                {t("settings.tgCodeHint")}
                <span className="ml-2 font-mono text-xl font-bold tracking-widest">{tgCode}</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => void tgTest()}>{t("settings.tgTest")}</Button>
            <Button variant="ghost" size="sm" onClick={() => void tgDisconnect()}>{t("settings.tgDisconnect")}</Button>
          </div>
        )}
        {tgError && <p className="text-xs text-red-500">{tgError}</p>}
      </div>
    </>
  );

  const dataSection = (
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
  );

  const helpSection = (
    <Button variant="outline" onClick={() => setHelpOpen(true)} className="w-full">
      <BookOpen className="mr-2 h-4 w-4" />
      {t("settings.help")}
    </Button>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">{t("app.settings")}</h2>
      <div className="mt-4 flex gap-6">
        <nav className="flex w-48 shrink-0 flex-col gap-1">
          {SECTIONS.map(({ id, icon: Icon }) => (
            <Button
              key={id}
              variant={section === id ? "default" : "ghost"}
              className="justify-start"
              onClick={() => setSection(id)}
            >
              <Icon className="mr-2 h-4 w-4" />
              {t(`settings.sections.${id}`)}
            </Button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-3">
          {section === "general" && generalSection}
          {section === "appearance" && appearanceSection}
          {section === "lessons" && lessonsSection}
          {section === "reminders" && remindersSection}
          {section === "templates" && templatesSection}
          {section === "integrations" && integrationsSection}
          {section === "data" && dataSection}
          {section === "help" && helpSection}
        </div>
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
                <li><kbd className="bg-muted px-1 rounded">Ctrl+K</kbd> - {t("help.shortcuts.palette")}</li>
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
