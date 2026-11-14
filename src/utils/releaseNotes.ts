function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineMarkdown(escapedLine: string): string {
  let out = escapedLine;
  // Markdown links: [label](https://...)
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  // Inline code: `code`
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold: **text** or __text__
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic: *text*
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  return out;
}

/**
 * Converts simple release-note Markdown into safe HTML (XSS-escaped first).
 */
export function renderReleaseNotesHtml(markdown: string): string {
  if (!markdown || !markdown.trim()) return '';

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const htmlParts: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      htmlParts.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length <= 2 ? 3 : 4;
      const content = formatInlineMarkdown(escapeHtml(headingMatch[2]));
      htmlParts.push(`<h${level}>${content}</h${level}>`);
      continue;
    }

    const listMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (listMatch) {
      if (!inList) {
        htmlParts.push('<ul>');
        inList = true;
      }
      const content = formatInlineMarkdown(escapeHtml(listMatch[1]));
      htmlParts.push(`<li>${content}</li>`);
      continue;
    }

    closeList();
    htmlParts.push(`<p>${formatInlineMarkdown(escapeHtml(trimmed))}</p>`);
  }

  closeList();
  return htmlParts.join('\n');
}

/**
 * Formats an ISO or timestamp release date string according to the active locale.
 */
export function formatReleaseDate(dateStr?: string, localeCode?: string): string {
  if (!dateStr || !dateStr.trim()) return '';
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return dateStr;
  }
  try {
    return new Intl.DateTimeFormat(localeCode || undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(parsed);
  } catch {
    return dateStr;
  }
}
