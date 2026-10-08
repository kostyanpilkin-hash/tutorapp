const CURRENCY_ORDER = ["USD", "EUR", "BYN", "RUB"];

export function numberLocaleFromLang(lang: string): string {
  if (lang === "en") return "en-US";
  if (lang === "be") return "be-BY";
  return "ru-RU";
}

export function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString(locale)} ${currency}`;
  }
}

export function sortCurrencies(codes: string[]): string[] {
  return [...codes].sort((a, b) => {
    const ai = CURRENCY_ORDER.indexOf(a);
    const bi = CURRENCY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}
