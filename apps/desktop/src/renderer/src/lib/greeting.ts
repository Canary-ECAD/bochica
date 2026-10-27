import type { TFunction } from "i18next";

// The big heading on New session. It changes once a day between a time-of-day greeting,
// "Happy <weekday>" and a plain "New task", so the screen doesn't feel the same every morning.

function dayOfYear(date: Date): number {
  return Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000);
}

export function greeting(t: TFunction, language: string, now: Date = new Date()): string {
  switch (dayOfYear(now) % 3) {
    case 0: {
      const hour = now.getHours();
      if (hour >= 5 && hour < 12) return t("greeting.morning");
      if (hour >= 12 && hour < 20) return t("greeting.afternoon");
      return t("greeting.evening");
    }
    case 1:
      return t("greeting.weekday", {
        day: new Intl.DateTimeFormat(language, { weekday: "long" }).format(now),
      });
    default:
      return t("greeting.newTask");
  }
}
