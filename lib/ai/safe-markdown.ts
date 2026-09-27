export type SafeMarkdownSegment = { text: string; bold: boolean };
export type SafeMarkdownLine = {
  kind: "paragraph" | "bullet" | "blank";
  segments: SafeMarkdownSegment[];
};

function inlineSegments(text: string): SafeMarkdownSegment[] {
  const segments: SafeMarkdownSegment[] = [];
  const bold = /\*\*([^*\n]+)\*\*/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = bold.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), bold: false });
    }
    segments.push({ text: match[1], bold: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), bold: false });
  return segments;
}

export function parseSafeMarkdown(content: string): SafeMarkdownLine[] {
  return content.replace(/\r\n?/gu, "\n").split("\n").map((line) => {
    const bullet = /^\s*[-*]\s+(.+)$/u.exec(line);
    if (bullet) return { kind: "bullet", segments: inlineSegments(bullet[1]) };
    if (!line.trim()) return { kind: "blank", segments: [] };
    return { kind: "paragraph", segments: inlineSegments(line) };
  });
}
