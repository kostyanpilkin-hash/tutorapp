use super::*;
use crate::models::LessonStudentInput;

fn conn() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    crate::db::migrations::run(&c).unwrap();
    c.execute_batch(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone', 'UTC');
         INSERT INTO students (id, name, created_at, updated_at) VALUES ('s1', 'Anna', '1', '1'), ('s2', 'Boris', '1', '1');",
    )
    .unwrap();
    c
}

struct Row<'a> {
    id: &'a str,
    start: &'a str,
    status: &'a str,
    rule: Option<&'a str>,
    parent: Option<&'a str>,
    idate: Option<&'a str>,
    student: &'a str,
    pay: &'a str,
}

fn row(c: &Connection, r: Row) {
    c.execute(
        "INSERT INTO lessons (id, student_name, subject, start_at, duration_minutes, cost, currency, notes, materials, status, payment_status,
                              recurrence_rule, recurrence_parent_id, recurrence_instance_date, created_at, updated_at)
         VALUES (?1, 'x', 'Math', ?2, 60, 100, 'USD', '', '', ?3, ?7, ?4, ?5, ?6, '1', '1')",
        params![r.id, r.start, r.status, r.rule, r.parent, r.idate, r.pay],
    )
    .unwrap();
    c.execute(
        "INSERT INTO lesson_students (lesson_id, student_id, cost, currency, payment_status) VALUES (?1, ?2, 100, 'USD', ?3)",
        params![r.id, r.student, r.pay],
    )
    .unwrap();
}

fn exception(c: &Connection, id: &str, start: &str, status: &str, idate: &str, pay: &str) {
    row(c, Row { id, start, status, rule: None, parent: Some("p1"), idate: Some(idate), student: "s1", pay });
}

fn single(c: &Connection, id: &str, start: &str, student: &str) {
    row(c, Row { id, start, status: "scheduled", rule: None, parent: None, idate: None, student, pay: "unpaid" });
}

fn series(c: &Connection, rule: &str) {
    row(c, Row { id: "p1", start: "2026-11-02T15:00:00Z", status: "scheduled", rule: Some(rule), parent: None, idate: None, student: "s1", pay: "unpaid" });
    c.execute("INSERT INTO reminders (id, lesson_id, minutes_before) VALUES ('r-p1', 'p1', 60)", []).unwrap();
}

fn template(start: &str) -> LessonInput {
    LessonInput {
        subject: "Math".into(),
        start_at: start.into(),
        duration_minutes: 60,
        cost: Some(100.0),
        currency: Some("USD".into()),
        link: None,
        notes: "".into(),
        materials: "".into(),
        materials_link: None,
        status: "scheduled".into(),
        payment_status: "unpaid".into(),
        recurrence_rule: None,
        recurrence_parent_id: None,
        recurrence_instance_date: None,
        color: None,
        students: vec![LessonStudentInput { student_id: "s1".into(), cost: None, currency: None, payment_status: None }],
        reminders: vec![60],
        force: false,
    }
}

fn forced(start: &str) -> LessonInput {
    LessonInput { force: true, ..template(start) }
}

fn split(c: &Connection, slot: &str, t: &LessonInput) -> Result<String, String> {
    split_series(c, &SplitRequest { parent_id: "p1", instance_date: slot, template: t, rule_override: None })
        .map(|r| r.new_parent_id)
}

fn rule_of(c: &Connection, id: &str) -> String {
    c.query_row("SELECT recurrence_rule FROM lessons WHERE id = ?1", [id], |r| r.get(0)).unwrap()
}

fn parent_of(c: &Connection, id: &str) -> String {
    c.query_row("SELECT recurrence_parent_id FROM lessons WHERE id = ?1", [id], |r| r.get(0)).unwrap()
}

/// (row id, date, HH:MM, status) of the visible schedule.
fn schedule(c: &Connection) -> Vec<(String, String, String, String)> {
    let d = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
    collect(c, chrono_tz::UTC, d("2026-10-01"), d("2027-03-01"))
        .unwrap()
        .into_iter()
        .map(|o| (o.row_id, o.start_utc.format("%Y-%m-%d").to_string(), o.start_utc.format("%H:%M").to_string(), o.status))
        .collect()
}

fn dates_of(s: &[(String, String, String, String)], id: &str) -> Vec<String> {
    s.iter().filter(|o| o.0 == id).map(|o| format!("{} {}", o.1, o.2)).collect()
}

/// Everything a split may touch, as text — equal before/after means "no change".
fn snapshot(c: &Connection) -> String {
    let q = |sql: &str| -> String {
        let mut st = c.prepare(sql).unwrap();
        let n = st.column_count();
        st.query_map([], |r| Ok((0..n).map(|i| format!("{:?}", r.get_ref(i).unwrap())).collect::<Vec<_>>().join("|")))
            .unwrap()
            .map(|r| r.unwrap())
            .collect::<Vec<_>>()
            .join("\n")
    };
    [
        q("SELECT id, start_at, status, payment_status, recurrence_rule, recurrence_parent_id, recurrence_instance_date FROM lessons ORDER BY id"),
        q("SELECT lesson_id, student_id, cost, payment_status FROM lesson_students ORDER BY lesson_id, student_id"),
        q("SELECT id, lesson_id, minutes_before FROM reminders ORDER BY id"),
        q("SELECT COUNT(*) FROM lesson_archive"),
        q("SELECT COUNT(*) FROM activity_log WHERE action = 'series_split'"),
    ]
    .join("\n--\n")
}

// Regression C: MO COUNT=8 from 02.11, slot 23.11 moved back to 09.11 14:40.
#[test]
fn split_move_back_keeps_history_before_original_slot() {
    let c = conn();
    series(&c, "FREQ=WEEKLY;BYDAY=MO;COUNT=8");
    let before = snapshot(&c);

    // The new series overlaps the kept history (09 and 16 at 15:00): needs confirmation.
    let err = split(&c, "2026-11-23T15:00:00.000Z", &template("2026-11-09T14:40:00.000Z")).unwrap_err();
    assert!(err.starts_with("OVERLAP:"), "{err}");
    assert_eq!(snapshot(&c), before, "refused split must not change anything");

    let new_id = split(&c, "2026-11-23T15:00:00.000Z", &forced("2026-11-09T14:40:00.000Z")).unwrap();
    assert_eq!(rule_of(&c, "p1"), "FREQ=WEEKLY;BYDAY=MO;COUNT=3");
    assert_eq!(rule_of(&c, &new_id), "FREQ=WEEKLY;BYDAY=MO;COUNT=5");
    let s = schedule(&c);
    assert_eq!(dates_of(&s, "p1"), ["2026-11-02 15:00", "2026-11-09 15:00", "2026-11-16 15:00"]);
    assert_eq!(
        dates_of(&s, &new_id),
        ["2026-11-09 14:40", "2026-11-16 14:40", "2026-11-23 14:40", "2026-11-30 14:40", "2026-12-07 14:40"]
    );
}

// Regression B: a failure while writing the new series leaves everything as it was.
#[test]
fn split_failure_leaves_original_unchanged() {
    let c = conn();
    series(&c, "FREQ=WEEKLY;BYDAY=MO;COUNT=8");
    exception(&c, "ex30", "2026-11-30T15:00:00Z", "scheduled", "2026-11-30T15:00:00.000Z", "paid");
    c.execute_batch("CREATE TRIGGER boom BEFORE INSERT ON reminders BEGIN SELECT RAISE(ABORT, 'boom'); END;").unwrap();
    let before = snapshot(&c);
    let err = split(&c, "2026-11-23T15:00:00.000Z", &template("2026-11-23T14:00:00.000Z")).unwrap_err();
    assert!(err.contains("boom"), "{err}");
    assert_eq!(snapshot(&c), before);
}

#[test]
fn split_refuses_to_move_finalized_future_lessons() {
    let c = conn();
    series(&c, "FREQ=WEEKLY;BYDAY=MO;COUNT=8");
    exception(&c, "done30", "2026-11-30T15:00:00Z", "completed", "2026-11-30T15:00:00.000Z", "paid");
    let before = snapshot(&c);
    let err = split(&c, "2026-11-23T15:00:00.000Z", &template("2026-11-23T14:00:00.000Z")).unwrap_err();
    assert!(err.contains("30.11.2026"), "{err}");
    assert_eq!(snapshot(&c), before);
}

#[test]
fn split_keeps_history_and_moves_future_exceptions_with_payments() {
    let c = conn();
    series(&c, "FREQ=WEEKLY;BYDAY=MO;COUNT=8");
    // History before the slot: untouched.
    exception(&c, "done16", "2026-11-16T15:00:00Z", "completed", "2026-11-16T15:00:00.000Z", "paid");
    // Future: a prepaid lesson, a cancelled one (legacy date-only key) and one moved individually to 18:00.
    exception(&c, "paid30", "2026-11-30T15:00:00Z", "scheduled", "2026-11-30T15:00:00.000Z", "paid");
    c.execute("INSERT INTO reminders (id, lesson_id, minutes_before) VALUES ('r-paid30', 'paid30', 30)", []).unwrap();
    exception(&c, "off07", "2026-12-07T15:00:00Z", "cancelled", "2026-12-07", "unpaid");
    exception(&c, "late14", "2026-12-14T18:00:00Z", "scheduled", "2026-12-14T15:00:00.000Z", "unpaid");

    // Monday 15:00 -> Wednesday 16:00 from 23.11.
    let new_id = split(&c, "2026-11-23T15:00:00.000Z", &template("2026-11-25T16:00:00.000Z")).unwrap();
    assert_eq!(rule_of(&c, &new_id), "FREQ=WEEKLY;BYDAY=WE;COUNT=5");
    assert_eq!(parent_of(&c, "done16"), "p1");
    for id in ["paid30", "off07", "late14"] {
        assert_eq!(parent_of(&c, id), new_id, "{id}");
    }
    let pay: String = c.query_row("SELECT payment_status FROM lesson_students WHERE lesson_id = 'paid30'", [], |r| r.get(0)).unwrap();
    assert_eq!(pay, "paid");
    let rem: i64 = c.query_row("SELECT COUNT(*) FROM reminders WHERE lesson_id = 'paid30'", [], |r| r.get(0)).unwrap();
    assert_eq!(rem, 1);

    let s = schedule(&c);
    assert_eq!(dates_of(&s, "p1"), ["2026-11-02 15:00", "2026-11-09 15:00"]);
    assert_eq!(dates_of(&s, "done16"), ["2026-11-16 15:00"]);
    assert_eq!(dates_of(&s, &new_id), ["2026-11-25 16:00", "2026-12-23 16:00"]);
    assert_eq!(dates_of(&s, "paid30"), ["2026-12-02 16:00"]);
    assert_eq!(dates_of(&s, "off07"), ["2026-12-09 16:00"]);
    // An individually moved lesson keeps its own time.
    assert_eq!(dates_of(&s, "late14"), ["2026-12-14 18:00"]);
    let per_day = |day: &str| s.iter().filter(|o| o.1 == day).count();
    assert_eq!(per_day("2026-11-30"), 0, "the old Monday slot is gone");
    assert_eq!(per_day("2026-12-02"), 1);
    assert_eq!(per_day("2026-12-09"), 1);
    assert_eq!(per_day("2026-12-16"), 0, "slot claimed by late14 (now on 14.12)");
}

#[test]
fn moving_earlier_the_same_day_does_not_conflict_with_itself() {
    let c = conn();
    series(&c, "FREQ=WEEKLY;BYDAY=MO;COUNT=8");
    let new_id = split(&c, "2026-11-23T15:00:00.000Z", &template("2026-11-23T14:40:00.000Z")).unwrap();
    assert_eq!(dates_of(&schedule(&c), &new_id)[0], "2026-11-23 14:40");
}

#[test]
fn adjacent_lesson_is_free_but_one_minute_overlap_is_not() {
    let c = conn();
    series(&c, "FREQ=WEEKLY;BYDAY=MO;COUNT=8");
    single(&c, "other", "2026-11-30T12:00:00Z", "s2");
    assert!(split(&c, "2026-11-23T15:00:00.000Z", &template("2026-11-23T11:00:00.000Z")).is_ok());

    let c = conn();
    series(&c, "FREQ=WEEKLY;BYDAY=MO;COUNT=8");
    single(&c, "other", "2026-11-30T12:00:00Z", "s2");
    let err = split(&c, "2026-11-23T15:00:00.000Z", &template("2026-11-23T11:01:00.000Z")).unwrap_err();
    assert_eq!(err, "OVERLAP:Boris");
}

#[test]
fn open_ended_series_with_interval_is_cut_by_until() {
    let c = conn();
    series(&c, "FREQ=WEEKLY;BYDAY=MO;INTERVAL=2");
    let new_id = split(&c, "2026-11-30", &template("2026-11-30T16:00:00.000Z")).unwrap();
    assert_eq!(rule_of(&c, "p1"), "FREQ=WEEKLY;BYDAY=MO;INTERVAL=2;UNTIL=2026-11-30T00:00:00.000Z");
    assert_eq!(rule_of(&c, &new_id), "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO");
    let s = schedule(&c);
    assert_eq!(dates_of(&s, "p1"), ["2026-11-02 15:00", "2026-11-16 15:00"]);
    assert_eq!(&dates_of(&s, &new_id)[..2], ["2026-11-30 16:00", "2026-12-14 16:00"]);
}

#[test]
fn slot_outside_the_series_is_rejected() {
    let c = conn();
    series(&c, "FREQ=WEEKLY;BYDAY=MO;COUNT=8");
    let before = snapshot(&c);
    assert!(split(&c, "2026-11-24T15:00:00.000Z", &template("2026-11-24T15:00:00.000Z")).is_err());
    assert!(split(&c, "2027-02-01T15:00:00.000Z", &template("2027-02-01T15:00:00.000Z")).is_err());
    assert_eq!(snapshot(&c), before);
}

#[test]
fn explicit_rule_from_the_form_is_used_as_is() {
    let c = conn();
    series(&c, "FREQ=WEEKLY;BYDAY=MO;COUNT=8");
    let t = template("2026-11-23T15:00:00.000Z");
    let new_id = split_series(
        &c,
        &SplitRequest { parent_id: "p1", instance_date: "2026-11-23T15:00:00.000Z", template: &t, rule_override: Some("FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4") },
    )
    .unwrap()
    .new_parent_id;
    assert_eq!(rule_of(&c, &new_id), "FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4");
    assert_eq!(rule_of(&c, "p1"), "FREQ=WEEKLY;BYDAY=MO;COUNT=3");
}
