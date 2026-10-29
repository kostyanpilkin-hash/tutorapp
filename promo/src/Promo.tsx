import {
  AbsoluteFill,
  Sequence,
  Audio,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
} from "remotion";
import type { ReactNode } from "react";

const BG = "#0b1020";
const ACCENT = "#22c55e";
const CARD = "#141a2e";
const BORDER = "#262f4a";
const TEXT = "#f1f5f9";
const MUTED = "#8a94b8";

const FadeIn = ({
  children,
  delay = 0,
  from = 40,
}: {
  children: ReactNode;
  delay?: number;
  from?: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14 } });
  return (
    <div
      style={{
        opacity: interpolate(s, [0, 1], [0, 1]),
        transform: `translateY(${interpolate(s, [0, 1], [from, 0])}px)`,
      }}
    >
      {children}
    </div>
  );
};

const Logo = ({ size = 96 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <rect x="4" y="8" width="56" height="48" rx="10" fill={ACCENT} opacity={0.15} />
    <rect x="4" y="8" width="56" height="48" rx="10" stroke={ACCENT} strokeWidth="4" />
    <line x1="4" y1="22" x2="60" y2="22" stroke={ACCENT} strokeWidth="4" />
    <rect x="12" y="30" width="12" height="8" rx="3" fill={ACCENT} />
    <rect x="30" y="30" width="12" height="8" rx="3" fill="#3b82f6" />
    <rect x="12" y="44" width="12" height="8" rx="3" fill="#a855f7" />
  </svg>
);

const Intro = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1200px 700px at 50% 35%, #16224a 0%, ${BG} 70%)`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 32,
    }}
  >
    <FadeIn delay={5}>
      <Logo size={120} />
    </FadeIn>
    <FadeIn delay={18}>
      <h1 style={{ fontSize: 96, fontWeight: 800, color: TEXT, margin: 0 }}>
        Tutor<span style={{ color: ACCENT }}>App</span>
      </h1>
    </FadeIn>
    <FadeIn delay={35}>
      <p style={{ fontSize: 38, color: MUTED, margin: 0 }}>
        Календарь, ученики и финансы репетитора — в одном месте
      </p>
    </FadeIn>
  </AbsoluteFill>
);

const WEEK_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт"];
const LESSONS = [
  { day: 0, row: 0, color: "#3b82f6", name: "Иван — Математика" },
  { day: 1, row: 1, color: "#22c55e", name: "*** — Английский" },
  { day: 2, row: 0, color: "#a855f7", name: "Артём — Физика" },
  { day: 3, row: 1, color: "#f59e0b", name: "София — Химия" },
  { day: 4, row: 0, color: "#ef4444", name: "Группа — Разговорный" },
];

const CalendarScene = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: BG,
        padding: 80,
        display: "flex",
        flexDirection: "column",
        gap: 40,
      }}
    >
      <FadeIn delay={0}>
        <h2 style={{ fontSize: 64, fontWeight: 700, color: TEXT, margin: 0 }}>
          Расписание на неделю
        </h2>
      </FadeIn>
      <div
        style={{
          flex: 1,
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 24,
          padding: 32,
          display: "grid",
          gridTemplateColumns: `repeat(5, 1fr)`,
          gap: 20,
        }}
      >
        {WEEK_DAYS.map((d, i) => (
          <div key={d} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ color: MUTED, fontSize: 28, fontWeight: 600 }}>{d}</div>
            {LESSONS.filter((l) => l.day === i).map((l, j) => (
              <FadeIn key={j} delay={15 + i * 8 + j * 4} from={30}>
                <div
                  style={{
                    background: "#1b2340",
                    border: `1px solid ${BORDER}`,
                    borderLeft: `6px solid ${l.color}`,
                    borderRadius: 14,
                    padding: "18px 16px",
                    color: TEXT,
                    fontSize: 24,
                    fontWeight: 600,
                  }}
                >
                  {l.name}
                </div>
              </FadeIn>
            ))}
          </div>
        ))}
      </div>
      <FadeIn delay={60}>
        <p style={{ fontSize: 34, color: MUTED, margin: 0 }}>
          Повторяющиеся занятия, переносы и исключения — без лишней ручной работы
        </p>
      </FadeIn>
    </AbsoluteFill>
  );
};

const FEATURES = [
  { icon: "🔔", title: "Напоминания", text: "Снуз, автозапуск, уведомления в фоне" },
  { icon: "🔁", title: "Серии занятий", text: "Перенос и удаление целой серии" },
  { icon: "💳", title: "Оплата и долги", text: "Предоплата, частичная оплата, история" },
  { icon: "🌍", title: "Валюты и пояса", text: "USD, EUR, BYN, RUB и часовые пояса" },
];

const FeaturesScene = () => (
  <AbsoluteFill
    style={{
      background: BG,
      padding: 100,
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 36,
      alignContent: "center",
    }}
  >
    {FEATURES.map((f, i) => (
      <FadeIn key={f.title} delay={i * 12}>
        <div
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 24,
            padding: "44px 40px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <span style={{ fontSize: 56 }}>{f.icon}</span>
          <span style={{ fontSize: 40, fontWeight: 700, color: TEXT }}>{f.title}</span>
          <span style={{ fontSize: 28, color: MUTED }}>{f.text}</span>
        </div>
      </FadeIn>
    ))}
  </AbsoluteFill>
);

const FinanceScene = () => {
  const frame = useCurrentFrame();
  const bars = [140, 220, 90, 260, 180, 300, 240];
  return (
    <AbsoluteFill
      style={{
        background: BG,
        padding: 80,
        display: "flex",
        flexDirection: "column",
        gap: 48,
      }}
    >
      <FadeIn delay={0}>
        <h2 style={{ fontSize: 64, fontWeight: 700, color: TEXT, margin: 0 }}>
          Финансы под контролем
        </h2>
      </FadeIn>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-end",
          gap: 40,
          padding: "0 60px",
        }}
      >
        {bars.map((h, i) => {
          const s = spring({ frame: frame - 15 - i * 6, fps: 30, config: { damping: 16 } });
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: interpolate(s, [0, 1], [0, h * 2]),
                background: `linear-gradient(180deg, ${ACCENT} 0%, #15803d 100%)`,
                borderRadius: 14,
              }}
            />
          );
        })}
      </div>
      <FadeIn delay={55}>
        <div style={{ display: "flex", gap: 24 }}>
          {["USD", "EUR", "BYN", "RUB"].map((c) => (
            <span
              key={c}
              style={{
                background: "#1b2340",
                border: `1px solid ${BORDER}`,
                borderRadius: 12,
                padding: "14px 28px",
                fontSize: 30,
                fontWeight: 700,
                color: TEXT,
              }}
            >
              {c}
            </span>
          ))}
        </div>
      </FadeIn>
    </AbsoluteFill>
  );
};

const THEMES = [
  "#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#14b8a6",
  "#eab308", "#ec4899", "#6366f1", "#84cc16", "#06b6d4", "#f97316",
  "#94a3b8", "#8b5cf6", "#10b981", "#f43f5e", "#d946ef", "#0ea5e9",
];

const ThemesScene = () => (
  <AbsoluteFill
    style={{
      background: BG,
      padding: 100,
      display: "flex",
      flexDirection: "column",
      gap: 48,
      justifyContent: "center",
    }}
  >
    <FadeIn delay={0}>
      <h2 style={{ fontSize: 64, fontWeight: 700, color: TEXT, margin: 0 }}>
        18 тем оформления
      </h2>
    </FadeIn>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: 28,
      }}
    >
      {THEMES.map((c, i) => (
        <FadeIn key={c} delay={10 + i * 3} from={24}>
          <div
            style={{
              height: 110,
              borderRadius: 20,
              background: `linear-gradient(135deg, ${c}55 0%, ${CARD} 100%)`,
              border: `2px solid ${c}`,
            }}
          />
        </FadeIn>
      ))}
    </div>
    <FadeIn delay={70}>
      <p style={{ fontSize: 34, color: MUTED, margin: 0 }}>
        *** и тёмные — с живым предпросмотром в настройках
      </p>
    </FadeIn>
  </AbsoluteFill>
);

const Outro = () => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [90, 119], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 700px at 50% 55%, #16224a 0%, ${BG} 70%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 36,
        opacity: fade,
      }}
    >
      <FadeIn delay={0}>
        <Logo size={110} />
      </FadeIn>
      <FadeIn delay={12}>
        <h2 style={{ fontSize: 72, fontWeight: 800, color: TEXT, margin: 0 }}>
          Tutor<span style={{ color: ACCENT }}>App</span>
        </h2>
      </FadeIn>
      <FadeIn delay={30}>
        <p style={{ fontSize: 36, color: MUTED, margin: 0 }}>Windows и macOS</p>
      </FadeIn>
    </AbsoluteFill>
  );
};

export const Promo = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: BG, fontFamily: "Manrope, Segoe UI, sans-serif" }}>
      <Audio src={staticFile("music.wav")} volume={0.4} />
      <Sequence durationInFrames={150}>
        <Intro />
      </Sequence>
      <Sequence from={150} durationInFrames={270}>
        <CalendarScene />
      </Sequence>
      <Sequence from={420} durationInFrames={210}>
        <FeaturesScene />
      </Sequence>
      <Sequence from={630} durationInFrames={180}>
        <FinanceScene />
      </Sequence>
      <Sequence from={810} durationInFrames={120}>
        <ThemesScene />
      </Sequence>
      <Sequence from={930} durationInFrames={120}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
