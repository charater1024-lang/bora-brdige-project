export type GreetingLocale = "ko" | "en" | "ja" | "zh";

type GreetingPeriod = "morning" | "afternoon" | "evening" | "night";

const GREETINGS: Record<GreetingLocale, Record<GreetingPeriod | "neutral", string>> = {
  ko: {
    neutral: "안녕하세요",
    morning: "좋은 아침이에요",
    afternoon: "좋은 오후예요",
    evening: "좋은 저녁이에요",
    night: "편안한 밤이에요",
  },
  en: {
    neutral: "Hello",
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
    night: "Good night",
  },
  ja: {
    neutral: "こんにちは",
    morning: "おはようございます",
    afternoon: "こんにちは",
    evening: "こんばんは",
    night: "夜遅くまでお疲れさまです",
  },
  zh: {
    neutral: "您好",
    morning: "早上好",
    afternoon: "下午好",
    evening: "晚上好",
    night: "夜深了，欢迎回来",
  },
};

function greetingPeriod(hour: number): GreetingPeriod | null {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

/**
 * `Date#getHours()` is intentionally called by the browser component, so the
 * greeting follows the viewer's device time zone instead of the server's.
 */
export function localGreeting(locale: GreetingLocale, hour: number | null) {
  const period = hour === null ? null : greetingPeriod(hour);
  return GREETINGS[locale][period ?? "neutral"];
}

export function personalizedLocalGreeting(
  locale: GreetingLocale,
  hour: number | null,
  displayName?: string | null,
) {
  const greeting = localGreeting(locale, hour);
  const name = displayName?.trim();
  if (!name) return greeting;
  if (locale === "ko") return `${greeting}, ${name}님`;
  if (locale === "ja") return `${greeting}、${name}さん`;
  if (locale === "zh") return `${greeting}，${name}`;
  return `${greeting}, ${name}`;
}
