"use client";

import type { MouseEvent, ReactNode } from "react";
import { parseSafeMarkdown, type SafeMarkdownSegment } from "@/lib/ai/safe-markdown";
import { safePublicHttpUrl } from "@/lib/public-data/urls";

export type AiEvidenceSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  reviewedAt: string;
  excerpt: string;
  publishedAt?: string | null;
  expiresAt?: string | null;
  kind: "knowledge" | "public-catalog" | "law" | "statistic" | "indicator";
};

function sourceDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : null;
}

/** Only allow API-listed sources actually cited by this answer into the UI. */
export function citedSafeSources(value: unknown, content: string): AiEvidenceSource[] {
  if (!Array.isArray(value)) return [];
  const citedIds = new Set([...content.matchAll(/\[([^\]\r\n]{1,180})\]/gu)].map((match) => match[1]));
  const seen = new Set<string>();
  return value.slice(0, 24).flatMap((raw): AiEvidenceSource[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const source = raw as Record<string, unknown>;
    if (typeof source.id !== "string" || !citedIds.has(source.id) || seen.has(source.id)
      || typeof source.title !== "string" || typeof source.publisher !== "string") return [];
    const url = safePublicHttpUrl(source.url);
    if (!url) return [];
    seen.add(source.id);
    const kind = source.kind === "public-catalog" || source.kind === "law" || source.kind === "statistic" || source.kind === "indicator"
      ? source.kind : "knowledge";
    return [{
      id: source.id,
      title: source.title.slice(0, 300),
      publisher: source.publisher.slice(0, 160),
      url,
      reviewedAt: sourceDate(source.reviewedAt) ?? "",
      excerpt: typeof source.excerpt === "string" ? source.excerpt.slice(0, 4_000) : "",
      publishedAt: sourceDate(source.publishedAt),
      expiresAt: sourceDate(source.expiresAt),
      kind,
    }];
  });
}

export function citationTargetId(prefix: string, sourceNumber: number) {
  return `${prefix.replace(/[^a-zA-Z0-9_-]/gu, "-") || "ai-source"}-${sourceNumber}`;
}

function revealCitation(event: MouseEvent<HTMLAnchorElement>, targetId: string) {
  const target = document.getElementById(targetId);
  if (!target) return;
  event.preventDefault();
  let ancestor: HTMLElement | null = target;
  while (ancestor) {
    if (ancestor.tagName === "DETAILS") (ancestor as HTMLDetailsElement).open = true;
    ancestor = ancestor.parentElement;
  }
  target.querySelector("summary")?.focus({ preventScroll: true });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
}

type Citation = { number: number; title: string; targetId: string };

function citationSegments(text: string, key: string, citations: ReadonlyMap<string, Citation>, citationLabel: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\[([^\]\r\n]{1,180})\]/gu)) {
    const citation = citations.get(match[1]);
    if (!citation) continue;
    const position = match.index ?? 0;
    if (position > cursor) nodes.push(text.slice(cursor, position));
    nodes.push(<a
      className="ai-citation"
      key={`${key}-source-${position}`}
      href={`#${citation.targetId}`}
      aria-label={`${citationLabel} ${citation.number}: ${citation.title}`}
      aria-controls={citation.targetId}
      onClick={(event) => revealCitation(event, citation.targetId)}
    >[{citation.number}]</a>);
    cursor = position + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function inlineMarkdown(segments: SafeMarkdownSegment[], lineKey: string, citations: ReadonlyMap<string, Citation>, citationLabel: string): ReactNode[] {
  return segments.map((segment, index) =>
    segment.bold
      ? <strong key={`${lineKey}-${index}`}>{citationSegments(segment.text, `${lineKey}-${index}`, citations, citationLabel)}</strong>
      : citationSegments(segment.text, `${lineKey}-${index}`, citations, citationLabel),
  );
}

/**
 * Deliberately small Markdown surface for model output. React escapes every
 * text node, so provider-authored HTML or scripts are never interpreted.
 */
export default function SafeMarkdown({ content, sources = [], citationPrefix = "ai-source", citationLabel = "출처" }: {
  content: string;
  sources?: readonly AiEvidenceSource[];
  citationPrefix?: string;
  citationLabel?: string;
}) {
  const lines = parseSafeMarkdown(content);
  const citations = new Map(citedSafeSources(sources, content).map((source, index) => [source.id, {
    number: index + 1,
    title: source.title,
    targetId: citationTargetId(citationPrefix, index + 1),
  }]));
  return (
    <div className="safe-markdown">
      {lines.map((line, index) => {
        if (line.kind === "bullet") {
          return (
            <div className="safe-markdown-bullet" key={`line-${index}`}>
              <span aria-hidden="true">•</span>
              <p>{inlineMarkdown(line.segments, `line-${index}`, citations, citationLabel)}</p>
            </div>
          );
        }
        if (line.kind === "blank") return <span className="safe-markdown-break" key={`line-${index}`} aria-hidden="true" />;
        return <p key={`line-${index}`}>{inlineMarkdown(line.segments, `line-${index}`, citations, citationLabel)}</p>;
      })}
    </div>
  );
}
