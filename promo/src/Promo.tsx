import {
  AbsoluteFill,
  Sequence,
  Audio,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
} from "remotion";
import type { ReactNode } from "react";

const BLACK = "#000000";
const WHITE = "#f5f5f7"; // Apple white
const GRAY = "#86868b"; // Apple gray
const ACCENT = "#22c55e";

const FONT = '"Segoe UI", "SF Pro Display", Manrope, sans-serif';

// One statement per screen — big white text fading+scaling in, holding, out.
const TextSlide = ({ text, size = 118 }: { text: string; size?: number }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const inS = spring({ frame, fps: 30, config: { damping: 200 } });
  const opacity =
    interpolate(inS, [0, 1], [0, 1]) *
    interpolate(
      frame,
      [durationInFrames - 15, durationInFrames - 1],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BLACK,
        justifyContent: "center",
        alignItems: "center",
        padding: 120,
      }}
    >
      <div
        style={{
          opacity,
          transform: `scale(${interpolate(inS, [0, 1], [0.94, 1])})`,
          fontSize: size,
          fontWeight: 600,
          color: WHITE,
          fontFamily: FONT,
          letterSpacing: "-0.02em",
          textAlign: "center",
          lineHeight: 1.15,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

// Real screenshot floating on black — rises with soft scale, caption under it.
const ShotSlide = ({
  src,
  caption,
}: {
  src: string;
  caption?: string;
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const s = spring({ frame, fps: 30, config: { damping: 26, mass: 1.1 } });
  const out = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames - 1],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BLACK,
        justifyContent: "center",
        alignItems: "center",
        gap: 44,
        opacity: out,
      }}
    >
      <div
        style={{
          transform: `scale(${interpolate(s, [0, 1], [0.88, 1])}) translateY(${interpolate(s, [0, 1], [50, 0])}px)`,
          borderRadius: 22,
          overflow: "hidden",
          border: "1px solid #26262a",
          boxShadow: "0 40px 120px rgba(0,0,0,0.9), 0 0 80px rgba(255,255,255,0.04)",
        }}
      >
        <Img src={staticFile(src)} style={{ width: 1280, display: "block" }} />
      </div>
      {caption && (
        <div
          style={{
            fontSize: 44,
            fontWeight: 500,
            color: GRAY,
            fontFamily: FONT,
            letterSpacing: "-0.01em",
            opacity: interpolate(inSProxy(frame), [0, 1], [0, 1]),
          }}
        >
          {caption}
        </div>
      )}
    </AbsoluteFill>
  );
};

// delayed fade for caption text
function inSProxy(frame: number) {
  return interpolate(frame, [18, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

const Logo = ({ size = 100 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <rect x="4" y="8" width="56" height="48" rx="10" stroke={ACCENT} strokeWidth="4" />
    <line x1="4" y1="22" x2="60" y2="22" stroke={ACCENT} strokeWidth="4" />
    <rect x="12" y="30" width="12" height="8" rx="3" fill={ACCENT} />
    <rect x="30" y="30" width="12" height="8" rx="3" fill="#f5f5f7" opacity={0.7} />
    <rect x="12" y="44" width="12" height="8" rx="3" fill="#f5f5f7" opacity={0.4} />
  </svg>
);

const Outro = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fade = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames - 1],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BLACK,
        justifyContent: "center",
        alignItems: "center",
        gap: 40,
        opacity: fade,
      }}
    >
      <Fade delay={4} from={30}>
        <Logo size={110} />
      </Fade>
      <Fade delay={14} from={30}>
        <div
          style={{
            fontSize: 110,
            fontWeight: 700,
            color: WHITE,
            fontFamily: FONT,
            letterSpacing: "-0.02em",
          }}
        >
          Tutor<span style={{ color: ACCENT }}>App</span>
        </div>
      </Fade>
      <Fade delay={28} from={24}>
        <div
          style={{
            fontSize: 38,
            fontWeight: 400,
            color: GRAY,
            fontFamily: FONT,
          }}
        >
          Сделано для репетиторов. Windows · macOS
        </div>
      </Fade>
    </AbsoluteFill>
  );
};

const Fade = ({
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
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
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

const SEC = 30;

export const Promo = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: BLACK, fontFamily: FONT }}>
      <Audio src={staticFile("music.wav")} volume={0.32} />

      {/* 0–3s: brand */}
      <Sequence durationInFrames={3 * SEC}>
        <TextSlide text="TutorApp." size={140} />
      </Sequence>

      {/* 3–6s: hook */}
      <Sequence from={3 * SEC} durationInFrames={3 * SEC}>
        <TextSlide text="Всё расписание — в одном взгляде." size={92} />
      </Sequence>

      {/* 6–10s: calendar */}
      <Sequence from={6 * SEC} durationInFrames={4 * SEC}>
        <ShotSlide src="shots/calendar.png" caption="Календарь." />
      </Sequence>

      {/* 10–12.5s */}
      <Sequence from={10 * SEC} durationInFrames={2.5 * SEC}>
        <TextSlide text="Каждый ученик — под рукой." size={96} />
      </Sequence>

      {/* 12.5–17s: students */}
      <Sequence from={12.5 * SEC} durationInFrames={4.5 * SEC}>
        <ShotSlide src="shots/students.png" caption="Ученики." />
      </Sequence>

      {/* 17–19.5s */}
      <Sequence from={17 * SEC} durationInFrames={2.5 * SEC}>
        <TextSlide text="Финансы. Прозрачно." size={104} />
      </Sequence>

      {/* 19.5–24s: finance */}
      <Sequence from={19.5 * SEC} durationInFrames={4.5 * SEC}>
        <ShotSlide src="shots/finance.png" caption="Долги, предоплата, валюты." />
      </Sequence>

      {/* 24–26.5s */}
      <Sequence from={24 * SEC} durationInFrames={2.5 * SEC}>
        <TextSlide text="Ваш стиль. 18 тем." size={104} />
      </Sequence>

      {/* 26.5–31s: settings/themes */}
      <Sequence from={26.5 * SEC} durationInFrames={4.5 * SEC}>
        <ShotSlide src="shots/settings.png" caption="Живой предпросмотр." />
      </Sequence>

      {/* 31–35s: today */}
      <Sequence from={31 * SEC} durationInFrames={4 * SEC}>
        <ShotSlide src="shots/today.png" caption="Сегодня — только важное." />
      </Sequence>

      {/* 35–40s: outro */}
      <Sequence from={35 * SEC} durationInFrames={5 * SEC}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
