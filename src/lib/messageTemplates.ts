import { api } from "@/lib/api";

export interface MessageTemplate {
  id: string;
  title: string;
  body: string;
}

export interface MessageTemplateVariables {
  name?: string | null;
  parentName?: string | null;
  link?: string | null;
  subject?: string | null;
  time?: string | null;
}

function normalizeTemplate(raw: unknown): MessageTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const template = raw as Record<string, unknown>;
  if (typeof template.id !== "string") return null;
  if (typeof template.title !== "string") return null;
  if (typeof template.body !== "string") return null;
  return {
    id: template.id,
    title: template.title,
    body: template.body,
  };
}

export async function loadMessageTemplates(): Promise<MessageTemplate[]> {
  const settings = await api.getSettings();
  try {
    const parsed = JSON.parse(settings.message_templates || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTemplate).filter((item): item is MessageTemplate => item !== null);
  } catch {
    return [];
  }
}

export async function saveMessageTemplates(templates: MessageTemplate[]): Promise<void> {
  await api.setSetting("message_templates", JSON.stringify(templates));
}

export function applyTemplate(body: string, variables: MessageTemplateVariables): string {
  return body.replace(/\{\{\s*(name|parentName|link|subject|time)\s*\}\}/g, (_, key: keyof MessageTemplateVariables) => {
    const value = variables[key];
    return value == null ? "" : String(value);
  });
}
