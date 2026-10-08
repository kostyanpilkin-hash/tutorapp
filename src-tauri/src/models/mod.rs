use serde::{Deserialize, Serialize};
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub lesson_id: String,
    pub minutes_before: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonStudent {
    pub student_id: String,
    pub name: String,
    pub cost: Option<f64>,
    pub currency: Option<String>,
    pub payment_status: String,
    pub color: Option<String>,
    pub timezone: Option<String>,
    #[serde(default)]
    pub lesson_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lesson {
    pub id: String,
    pub student_name: String,
    pub subject: String,
    pub start_at: String,
    pub duration_minutes: i64,
    pub cost: Option<f64>,
    pub currency: Option<String>,
    pub link: Option<String>,
    pub notes: String,
    pub materials: String,
    pub materials_link: Option<String>,
    pub status: String,
    pub payment_status: String,
    pub recurrence_rule: Option<String>,
    pub recurrence_parent_id: Option<String>,
    pub recurrence_instance_date: Option<String>,
    pub color: Option<String>,
    pub students: Vec<LessonStudent>,
    pub reminders: Vec<Reminder>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct LessonStudentInput {
    #[validate(length(min = 1))]
    pub student_id: String,
    pub cost: Option<f64>,
    pub currency: Option<String>,
    pub payment_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct LessonInput {
    #[validate(length(max = 100))]
    pub subject: String,
    #[validate(length(min = 1))]
    pub start_at: String,
    #[validate(range(min = 15, max = 240))]
    pub duration_minutes: i64,
    pub cost: Option<f64>,
    pub currency: Option<String>,
    pub link: Option<String>,
    pub notes: String,
    pub materials: String,
    pub materials_link: Option<String>,
    #[validate(custom(function = "validate_lesson_status"))]
    pub status: String,
    #[validate(custom(function = "validate_payment_status"))]
    pub payment_status: String,
    pub recurrence_rule: Option<String>,
    pub recurrence_parent_id: Option<String>,
    pub recurrence_instance_date: Option<String>,
    pub color: Option<String>,
    #[validate(length(min = 1, message = "Выберите хотя бы одного ученика"))]
    pub students: Vec<LessonStudentInput>,
    pub reminders: Vec<i64>,
    #[serde(default)]
    pub force: bool,
}

fn validate_lesson_status(s: &str) -> Result<(), validator::ValidationError> {
    matches!(s, "scheduled" | "completed" | "cancelled" | "no_show")
        .then_some(())
        .ok_or_else(|| validator::ValidationError::new("invalid_status"))
}

fn validate_payment_status(s: &str) -> Result<(), validator::ValidationError> {
    matches!(s, "paid" | "unpaid")
        .then_some(())
        .ok_or_else(|| validator::ValidationError::new("invalid_payment_status"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlapInfo {
    pub id: String,
    pub student_name: String,
    pub start_at: String,
    pub duration_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Student {
    pub id: String,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub messenger: Option<String>,
    pub parents: Option<String>,
    pub parent_name: Option<String>,
    pub parent_phone: Option<String>,
    pub parent_messenger: Option<String>,
    pub birth_date: Option<String>,
    pub notes: String,
    #[serde(default)]
    pub lesson_note: String,
    pub timezone: Option<String>,
    pub default_cost: Option<f64>,
    pub default_currency: Option<String>,
    pub default_link: Option<String>,
    pub default_duration: Option<i64>,
    pub color: Option<String>,
    pub photo_path: Option<String>,
    pub paid_lessons: i64,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct StudentInput {
    #[validate(length(min = 1, max = 100))]
    pub name: String,
    #[validate(email)]
    pub email: Option<String>,
    pub phone: Option<String>,
    pub messenger: Option<String>,
    pub parents: Option<String>,
    pub parent_name: Option<String>,
    pub parent_phone: Option<String>,
    pub parent_messenger: Option<String>,
    pub birth_date: Option<String>,
    pub notes: String,
    #[serde(default)]
    pub lesson_note: String,
    pub timezone: Option<String>,
    pub default_cost: Option<f64>,
    pub default_currency: Option<String>,
    pub default_link: Option<String>,
    #[validate(range(min = 15, max = 240))]
    pub default_duration: Option<i64>,
    pub color: Option<String>,
    #[serde(default)]
    pub paid_lessons: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyAmount {
    pub currency: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectAmount {
    pub subject: String,
    pub currency: String,
    pub earned: f64,
    pub debt: f64,
    pub expected: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePoint {
    pub label: String,
    pub earned: f64,
    pub debt: f64,
    pub expected: f64,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceReport {
    pub period: String,
    pub from: String,
    pub to: String,
    pub earned: Vec<CurrencyAmount>,
    pub debt: Vec<CurrencyAmount>,
    pub expected: Vec<CurrencyAmount>,
    pub by_subject: Vec<SubjectAmount>,
    pub timeline: Vec<TimelinePoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentFinance {
    pub earned: Vec<CurrencyAmount>,
    pub debt: Vec<CurrencyAmount>,
    pub expected: Vec<CurrencyAmount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentSettingsLog {
    pub id: String,
    pub student_id: String,
    pub field: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub changed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtEntry {
    pub lesson_id: String,
    pub student_id: String,
    pub student_name: String,
    pub subject: String,
    pub start_at: String,
    pub status: String,
    pub cost: f64,
    pub currency: String,
}
