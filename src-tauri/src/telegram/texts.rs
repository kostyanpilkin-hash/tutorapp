//! Bot texts. `lang` is the app language (ru/en/be).

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum L { Ru, En, Be }

pub fn lang(code: &str) -> L {
    match code {
        "en" => L::En,
        "be" => L::Be,
        _ => L::Ru,
    }
}

/// Slavic plural rule (ru/be): 1 → one, 2–4 → few, else many.
fn slav(n: i64, one: &'static str, few: &'static str, many: &'static str) -> &'static str {
    let n = n.rem_euclid(100);
    if (11..=14).contains(&n) {
        return many;
    }
    match n % 10 {
        1 => one,
        2..=4 => few,
        _ => many,
    }
}

pub struct T(pub L);
impl T {
    fn s(&self, ru: &'static str, en: &'static str, be: &'static str) -> &'static str {
        match self.0 { L::Ru => ru, L::En => en, L::Be => be }
    }
    pub fn welcome(&self) -> &'static str { self.s("Привет! Это бот TutorApp. Введите код из настроек приложения, чтобы привязать бот.", "Hi! This is the TutorApp bot. Enter the code from the app settings to link.", "Прывітанне! Гэта бот TutorApp. Увядзіце код з налад праграмы, каб прывязаць бот.") }
    pub fn code_ok(&self) -> &'static str { self.s("Бот привязан ✅", "Bot linked ✅", "Бот прывязаны ✅") }
    pub fn code_bad(&self) -> &'static str { self.s("Неверный или устаревший код.", "Invalid or expired code.", "Няслушны або састарэлы код.") }
    pub fn no_access(&self) -> &'static str { self.s("Бот не привязан. Откройте Настройки → Telegram-бот в приложении.", "Bot is not linked. Open Settings → Telegram bot in the app.", "Бот не прывязаны. Адкрыйце Налады → Telegram-бот у праграме.") }
    pub fn today(&self) -> &'static str { self.s("Сегодня", "Today", "Сёння") }
    pub fn tomorrow(&self) -> &'static str { self.s("Завтра", "Tomorrow", "Заўтра") }
    pub fn week(&self) -> &'static str { self.s("Неделя", "Week", "Тыдзень") }
    pub fn morning_digest(&self) -> &'static str { self.s("🌅 Утренняя сводка", "🌅 Morning digest", "🌅 Ранішняя зводка") }
    pub fn evening_digest(&self) -> &'static str { self.s("🌙 Вечерний итог", "🌙 Evening digest", "🌙 Вячэрні вынік") }
    pub fn debts(&self) -> &'static str { self.s("💸 Должники", "💸 Debts", "💸 Пазальнікі") }
    pub fn settings(&self) -> &'static str { self.s("⚙️ Настройки", "⚙️ Settings", "⚙️ Налады") }
    pub fn free_day(&self) -> &'static str { self.s("Сегодня свободно 🎉", "No lessons today 🎉", "Сёння вольна 🎉") }
    pub fn no_lessons(&self) -> &'static str { self.s("Занятий нет.", "No lessons.", "Заняткаў няма.") }
    pub fn no_debts(&self) -> &'static str { self.s("Должников нет ✅", "No debts ✅", "Пазальнікаў няма ✅") }
    pub fn done(&self) -> &'static str { self.s("✅ Проведено", "✅ Done", "✅ Праведзена") }
    pub fn no_show(&self) -> &'static str { self.s("❌ Не состоялось", "❌ No-show", "❌ Не адбылося") }
    pub fn paid(&self) -> &'static str { self.s("💰 Оплачено", "💰 Paid", "💰 Аплачана") }
    pub fn cancel(&self) -> &'static str { self.s("🚫 Отменить", "🚫 Cancel", "🚫 Адмяніць") }
    pub fn confirm_cancel(&self) -> &'static str { self.s("Отменить занятие?", "Cancel this lesson?", "Адмяніць занятак?") }
    pub fn yes(&self) -> &'static str { self.s("Да, отменить", "Yes, cancel", "Так, адмяніць") }
    pub fn back(&self) -> &'static str { self.s("« Назад", "« Back", "« Назад") }
    pub fn done_marked(&self) -> &'static str { self.s("Отмечено как проведённое ✅", "Marked as completed ✅", "Адзначана як праведзенае ✅") }
    pub fn no_show_marked(&self) -> &'static str { self.s("Отмечено: не состоялось ❌", "Marked as no-show ❌", "Адзначана: не адбылося ❌") }
    pub fn paid_marked(&self) -> &'static str { self.s("Оплата отмечена 💰", "Marked as paid 💰", "Аплата адзначана 💰") }
    pub fn cancelled_marked(&self) -> &'static str { self.s("Занятие отменено 🚫", "Lesson cancelled 🚫", "Занятак адменены 🚫") }
    /// "Занятие через 1 час" / "Lesson in 30 minutes" / "Занятак праз 2 гадзіны".
    pub fn reminder_title(&self, h: i64, m: i64) -> String {
        match self.0 {
            L::Ru => {
                let span = if h >= 24 {
                    "сутки".to_string()
                } else if h > 0 && m > 0 {
                    format!("{h} ч {m} мин")
                } else if h > 0 {
                    format!("{h} {}", slav(h, "час", "часа", "часов"))
                } else {
                    format!("{m} {}", slav(m, "минуту", "минуты", "минут"))
                };
                format!("Занятие через {span}")
            }
            L::En => {
                let span = if h >= 24 {
                    "24 hours".to_string()
                } else if h > 0 && m > 0 {
                    format!("{h}h {m}m")
                } else if h > 0 {
                    format!("{h} hour{}", if h == 1 { "" } else { "s" })
                } else {
                    format!("{m} minute{}", if m == 1 { "" } else { "s" })
                };
                format!("Lesson in {span}")
            }
            L::Be => {
                let span = if h >= 24 {
                    "суткі".to_string()
                } else if h > 0 && m > 0 {
                    format!("{h} г {m} хв")
                } else if h > 0 {
                    format!("{h} {}", slav(h, "гадзіну", "гадзіны", "гадзін"))
                } else {
                    format!("{m} {}", slav(m, "хвіліну", "хвіліны", "хвілін"))
                };
                format!("Занятак праз {span}")
            }
        }
    }
    pub fn cancelled_done(&self) -> &'static str { self.s("🚫 Отменено", "🚫 Cancelled", "🚫 Адменена") }
    pub fn lesson_now(&self) -> &'static str { self.s("Занятие сейчас", "Lesson starting now", "Занятак зараз") }
    pub fn field_student(&self) -> &'static str { self.s("Ученик", "Student", "Вучань") }
    pub fn field_time(&self) -> &'static str { self.s("Время", "Time", "Час") }
    pub fn field_link(&self) -> &'static str { self.s("Ссылка", "Link", "Спасылка") }
    pub fn field_subject(&self) -> &'static str { self.s("Предмет", "Subject", "Прадмет") }
    pub fn field_duration(&self) -> &'static str { self.s("Длительность", "Duration", "Працягласць") }
    pub fn field_notes(&self) -> &'static str { self.s("Заметки", "Notes", "Нататкі") }
    pub fn field_payment(&self) -> &'static str { self.s("Оплата", "Payment", "Аплата") }
    pub fn field_cost(&self) -> &'static str { self.s("Цена", "Cost", "Кошт") }
    pub fn notify_offsets(&self) -> &'static str { self.s("Напоминания за:", "Remind before:", "Нагадванні за:") }
    pub fn msg_fields(&self) -> &'static str { self.s("Поля сообщения:", "Message fields:", "Палі паведамлення:") }
    pub fn summary_label(&self) -> &'static str { self.s("Итог дня:", "Day summary:", "Вынік дня:") }
    pub fn unpaid_label(&self) -> &'static str { self.s("Не оплачено:", "Unpaid:", "Не аплачана:") }
    pub fn link_text(&self) -> &'static str { self.s("Ссылка", "Link", "Спасылка") }
    pub fn test_ok(&self) -> &'static str { self.s("Связь с TutorApp работает ✅", "TutorApp connection works ✅", "Сувязь з TutorApp працуе ✅") }
    pub fn not_linked(&self) -> &'static str { self.s("Неверная команда. Используйте кнопки ниже.", "Unknown command. Use the buttons below.", "Невядомая каманда. Выкарыстоўвайце кнопкі ніжэй.") }
    pub fn paid_label(&self) -> &'static str { self.s("оплачено", "paid", "аплачана") }
    pub fn unpaid_word(&self) -> &'static str { self.s("не оплачено", "unpaid", "не аплачана") }
    pub fn day_free(&self) -> &'static str { self.s("свободно", "free", "вольна") }
    pub fn minutes(&self, n: i64) -> String {
        match self.0 {
            L::Ru => format!("{n} мин"),
            L::En => format!("{n} min"),
            L::Be => format!("{n} хв"),
        }
    }
    pub fn stats_lessons(&self, n: usize) -> String {
        match self.0 {
            L::Ru => format!("{n} занятий"),
            L::En => format!("{n} lessons"),
            L::Be => format!("{n} заняткаў"),
        }
    }
    pub fn stats_done(&self, n: usize) -> String {
        match self.0 {
            L::Ru => format!("{n} проведено"),
            L::En => format!("{n} done"),
            L::Be => format!("{n} праведзена"),
        }
    }
    pub fn stats_left(&self, n: usize) -> String {
        match self.0 {
            L::Ru => format!("{n} впереди"),
            L::En => format!("{n} ahead"),
            L::Be => format!("{n} наперадзе"),
        }
    }
}
