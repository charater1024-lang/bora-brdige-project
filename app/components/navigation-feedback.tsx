"use client";

import { useEffect, useState } from "react";

import styles from "./navigation-feedback.module.css";

type Locale = "ko" | "en" | "ja" | "zh";

const SHOW_DELAY_MS = 160;

const statusCopy: Record<Locale, string> = {
  ko: "새 화면으로 이동하고 있어요",
  en: "Opening the next page",
  ja: "次の画面に移動しています",
  zh: "正在前往下一页面",
};

function readLocale(): Locale {
  try {
    const saved = window.localStorage.getItem("bora-locale");
    return saved === "en" || saved === "ja" || saved === "zh" ? saved : "ko";
  } catch {
    return "ko";
  }
}

/**
 * App Router mounts this component through app/loading.tsx only after a route
 * transition really suspends. That lifecycle is the source of truth: clicks
 * cancelled by OAuth handlers, disabled anchors, downloads, and hash-only
 * changes never create a false loading state, while a slow history navigation
 * remains visible until the destination content commits.
 */
export function NavigationFeedbackStatus({ locale }: { locale: Locale }) {
  return <div className={styles.feedback} data-bora-navigation-feedback>
    <span className={styles.progress} aria-hidden="true" />
    <p className={styles.status} role="status" aria-live="polite">
      <span aria-hidden="true" />
      {statusCopy[locale]}
    </p>
  </div>;
}

export function NavigationFeedback() {
  const [visible, setVisible] = useState(false);
  const [locale, setLocale] = useState<Locale>("ko");

  useEffect(() => {
    const body = document.body;
    const previousAriaBusy = body.getAttribute("aria-busy");
    const syncLocale = () => setLocale(readLocale());
    const showTimer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);

    syncLocale();
    body.setAttribute("data-bora-navigation-pending", "true");
    body.setAttribute("aria-busy", "true");
    window.addEventListener("storage", syncLocale);
    window.addEventListener("bora-locale-change", syncLocale);

    return () => {
      window.clearTimeout(showTimer);
      window.removeEventListener("storage", syncLocale);
      window.removeEventListener("bora-locale-change", syncLocale);
      body.removeAttribute("data-bora-navigation-pending");
      if (previousAriaBusy === null) body.removeAttribute("aria-busy");
      else body.setAttribute("aria-busy", previousAriaBusy);
    };
  }, []);

  if (!visible) return null;
  return <NavigationFeedbackStatus locale={locale} />;
}
