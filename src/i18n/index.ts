import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { be, en, ru } from "./locales";

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
    be: { translation: be },
  },
  lng: "ru",
  fallbackLng: "ru",
  interpolation: { escapeValue: false },
});

export default i18n;
