export type AstNode =
  | { type: 'text'; value: string }
  | { type: 'var'; name: string }
  | { type: 'shorthand'; prefix: string; name: string; suffix: string }
  | { type: 'if'; branches: Array<{ condition: string | null; body: AstNode[] }> };

export const KNOWN_LATEX_VAR_NAMES = new Set<string>([
  'henry_id',
  'kekule_id',
  'ordnungs_id',
  'zweig_id',
  'nachname',
  'vorname',
  'vollname',
  'sohn_tochter',
  'geschlecht',
  'generation',
  'generation_roemisch',
  'generation_badge',
  'rolle',
  'xref',
  'implex',
  'stamm_verweis',
  'lebensdaten',
  'geburtsdatum',
  'geburtsjahr',
  'geburtsort',
  'taufdatum',
  'taufort',
  'taufe',
  'sterbedatum',
  'sterbejahr',
  'sterbeort',
  'beerdigungsdatum',
  'beerdigungsort',
  'beerdigung',
  'hochzeitsdatum',
  'hochzeitsort',
  'hochzeit',
  'scheidung',
  'scheidungsdatum',
  'scheidungsort',
  'ehepartner',
  'beruf',
  'religion',
  'wohnort',
  'notizen',
  'kinder_anzahl',
  'unbekannter_elternteil',
  'ehe_nummer',
  'partner_name',
  'partner_vorname',
  'partner_nachname',
  'partner_lebensdaten',
  'partner_geburtsdatum',
  'partner_geburtsort',
  'partner_sterbedatum',
  'partner_sterbeort',
  'partner_beruf',
  'partner_verweis',
  'ist_unbekannt',
  'ist_stamm_anker',
  'hat_kinder',
]);

export function escapeLatexText(input: string): string {
  if (!input) return '';
  return input
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\$/g, '\\$')
    .replace(/&/g, '\\&')
    .replace(/#/g, '\\#')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/%/g, '\\%')
    .replace(/\u26AD/g, '\\ensuremath{\\infty}')
    .replace(/\u26AE/g, '\\ensuremath{\\not\\infty}')
    .replace(/\u2192/g, '\\textrightarrow{}');
}

export function escapeHtmlText(input: string): string {
  if (!input) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type CondToken =
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'not' }
  | { type: 'and' }
  | { type: 'or' }
  | { type: 'op'; value: '==' | '!=' | '>=' | '<=' | '>' | '<' }
  | { type: 'str'; value: string }
  | { type: 'ident'; value: string };

function tokenizeCondition(expr: string): CondToken[] {
  const tokens: CondToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (expr.startsWith('&&', i)) {
      tokens.push({ type: 'and' });
      i += 2;
      continue;
    }
    if (expr.startsWith('||', i)) {
      tokens.push({ type: 'or' });
      i += 2;
      continue;
    }
    if (expr.startsWith('==', i) || expr.startsWith('!=', i) || expr.startsWith('>=', i) || expr.startsWith('<=', i)) {
      tokens.push({ type: 'op', value: expr.slice(i, i + 2) as '==' | '!=' | '>=' | '<=' });
      i += 2;
      continue;
    }
    if (ch === '>' || ch === '<') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '!') {
      tokens.push({ type: 'not' });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let val = '';
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < expr.length) {
          i++;
        }
        val += expr[i];
        i++;
      }
      if (i < expr.length && expr[i] === quote) i++;
      tokens.push({ type: 'str', value: val });
      continue;
    }
    const identMatch = /^[a-zA-Z0-9_.-]+/.exec(expr.slice(i));
    if (identMatch) {
      const word = identMatch[0];
      const lower = word.toLowerCase();
      if (lower === 'and' || lower === 'und') tokens.push({ type: 'and' });
      else if (lower === 'or' || lower === 'oder') tokens.push({ type: 'or' });
      else if (lower === 'not' || lower === 'nicht') tokens.push({ type: 'not' });
      else tokens.push({ type: 'ident', value: word });
      i += word.length;
      continue;
    }
    i++;
  }
  return tokens;
}

export function evaluateConditionExpr(expr: string, rawVars: Record<string, string>): boolean {
  const tokens = tokenizeCondition(expr);
  if (tokens.length === 0) return false;
  let pos = 0;

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function resolveOperand(tok: CondToken): string {
    if (tok.type === 'str') return tok.value;
    if (tok.type === 'ident') {
      if (/^-?\d+(\.\d+)?$/.test(tok.value)) return tok.value;
      if (tok.value.toLowerCase() === 'true') return '1';
      if (tok.value.toLowerCase() === 'false') return '';
      return rawVars[tok.value] ?? '';
    }
    return '';
  }

  function parseOr(): boolean {
    let left = parseAnd();
    while (peek()?.type === 'or') {
      consume();
      const right = parseAnd();
      left = left || right;
    }
    return left;
  }

  function parseAnd(): boolean {
    let left = parseUnary();
    while (peek()?.type === 'and') {
      consume();
      const right = parseUnary();
      left = left && right;
    }
    return left;
  }

  function parseUnary(): boolean {
    if (peek()?.type === 'not') {
      consume();
      return !parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): boolean {
    const tok = peek();
    if (!tok) return false;
    if (tok.type === 'lparen') {
      consume();
      const val = parseOr();
      if (peek()?.type === 'rparen') consume();
      return val;
    }
    if (tok.type === 'ident' || tok.type === 'str') {
      const leftTok = consume();
      const next = peek();
      if (next && next.type === 'op') {
        consume();
        const rightTok = consume();
        const leftVal = resolveOperand(leftTok).trim();
        const rightVal = rightTok ? resolveOperand(rightTok).trim() : '';
        const leftNum = Number(leftVal);
        const rightNum = Number(rightVal);
        const bothNumeric =
          leftVal !== '' && rightVal !== '' && Number.isFinite(leftNum) && Number.isFinite(rightNum);

        switch (next.value) {
          case '==':
            return bothNumeric ? leftNum === rightNum : leftVal.toLowerCase() === rightVal.toLowerCase();
          case '!=':
            return bothNumeric ? leftNum !== rightNum : leftVal.toLowerCase() !== rightVal.toLowerCase();
          case '>':
            return bothNumeric ? leftNum > rightNum : leftVal > rightVal;
          case '<':
            return bothNumeric ? leftNum < rightNum : leftVal < rightVal;
          case '>=':
            return bothNumeric ? leftNum >= rightNum : leftVal >= rightVal;
          case '<=':
            return bothNumeric ? leftNum <= rightNum : leftVal <= rightVal;
        }
      }
      const val = resolveOperand(leftTok).trim();
      return val.length > 0;
    }
    consume();
    return false;
  }

  return parseOr();
}

interface RawToken {
  kind: 'text' | 'if' | 'elseif' | 'else' | 'endif' | 'var' | 'shorthand';
  value: string;
  prefix?: string;
  suffix?: string;
}

function tokenizeMask(template: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  let textBuf = '';

  const flushText = () => {
    if (textBuf) {
      tokens.push({ kind: 'text', value: textBuf });
      textBuf = '';
    }
  };

  while (i < template.length) {
    const ch = template[i];
    if (ch === '{') {
      const closeIdx = template.indexOf('}', i + 1);
      if (closeIdx !== -1) {
        const inner = template.slice(i + 1, closeIdx);
        // Must not contain another '{' inside our template tag
        if (!inner.includes('{')) {
          const trimmed = inner.trim();

          // 1. Control directives
          const ifMatch = /^(?:if|wenn)\s+(.+)$/i.exec(trimmed);
          if (ifMatch) {
            flushText();
            tokens.push({ kind: 'if', value: ifMatch[1].trim() });
            i = closeIdx + 1;
            continue;
          }
          const elseifMatch = /^(?:else\s*if|elseif|sonst\s*wenn)\s+(.+)$/i.exec(trimmed);
          if (elseifMatch) {
            flushText();
            tokens.push({ kind: 'elseif', value: elseifMatch[1].trim() });
            i = closeIdx + 1;
            continue;
          }
          if (/^(?:else|sonst)$/i.test(trimmed)) {
            flushText();
            tokens.push({ kind: 'else', value: '' });
            i = closeIdx + 1;
            continue;
          }
          if (/^(?:endif|endwenn)$/i.test(trimmed)) {
            flushText();
            tokens.push({ kind: 'endif', value: '' });
            i = closeIdx + 1;
            continue;
          }

          // 2. Shorthand optional token: {prefix?varnameSuffix} e.g. {, ?beruf} or { (wh. ?wohnort)}
          const shorthandMatch = /^([^?]*)\?([a-zA-Z0-9_]+)(.*)$/.exec(inner);
          if (shorthandMatch && KNOWN_LATEX_VAR_NAMES.has(shorthandMatch[2])) {
            flushText();
            tokens.push({
              kind: 'shorthand',
              prefix: shorthandMatch[1],
              value: shorthandMatch[2],
              suffix: shorthandMatch[3],
            });
            i = closeIdx + 1;
            continue;
          }

          // 3. Direct variable token: {varname}
          if (/^[a-zA-Z0-9_]+$/.test(trimmed) && KNOWN_LATEX_VAR_NAMES.has(trimmed)) {
            flushText();
            tokens.push({ kind: 'var', value: trimmed });
            i = closeIdx + 1;
            continue;
          }
        }
      }
    }
    textBuf += ch;
    i++;
  }

  flushText();
  return tokens;
}

export function parseMaskAst(template: string): AstNode[] {
  const tokens = tokenizeMask(template);
  let pos = 0;

  function parseBlock(stopKinds: Set<RawToken['kind']>): AstNode[] {
    const nodes: AstNode[] = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (stopKinds.has(tok.kind)) {
        return nodes;
      }
      pos++;
      if (tok.kind === 'text') {
        nodes.push({ type: 'text', value: tok.value });
      } else if (tok.kind === 'var') {
        nodes.push({ type: 'var', name: tok.value });
      } else if (tok.kind === 'shorthand') {
        nodes.push({
          type: 'shorthand',
          prefix: tok.prefix || '',
          name: tok.value,
          suffix: tok.suffix || '',
        });
      } else if (tok.kind === 'if') {
        const branches: Array<{ condition: string | null; body: AstNode[] }> = [];
        const stopSet = new Set<RawToken['kind']>(['elseif', 'else', 'endif']);
        branches.push({ condition: tok.value, body: parseBlock(stopSet) });

        while (pos < tokens.length && tokens[pos].kind === 'elseif') {
          const cond = tokens[pos].value;
          pos++;
          branches.push({ condition: cond, body: parseBlock(stopSet) });
        }
        if (pos < tokens.length && tokens[pos].kind === 'else') {
          pos++;
          branches.push({ condition: null, body: parseBlock(new Set(['endif'])) });
        }
        if (pos < tokens.length && tokens[pos].kind === 'endif') {
          pos++;
        }
        nodes.push({ type: 'if', branches });
      }
    }
    return nodes;
  }

  return parseBlock(new Set());
}

/**
 * Konvertiert einfache LaTeX-Formatierung in statischem Maskentext direkt in sicheres Preview-HTML.
 */
function staticLatexTextToPreviewHtml(raw: string): string {
  if (!raw) return '';
  let out = raw;
  // Normalize explicit line breaks
  out = out.replace(/\\newline\b/g, '[[LG_BR]]');
  out = out.replace(/\\\\/g, '[[LG_BR]]');
  out = out.replace(/\\par\b/g, '[[LG_BR]]');

  // Protect simple inline formatting tags inside mask text
  const replacements: Array<[RegExp, (m: string, g1: string) => string]> = [
    [/\\textbf\{([^{}]*)\}/g, (_m, g1) => `[[B_OPEN]]${g1}[[B_CLOSE]]`],
    [/\\textit\{([^{}]*)\}/g, (_m, g1) => `[[I_OPEN]]${g1}[[I_CLOSE]]`],
    [/\\emph\{([^{}]*)\}/g, (_m, g1) => `[[I_OPEN]]${g1}[[I_CLOSE]]`],
    [/\\textsc\{([^{}]*)\}/g, (_m, g1) => `[[SC_OPEN]]${g1}[[SC_CLOSE]]`],
    [/\\footnotesize\{([^{}]*)\}/g, (_m, g1) => `[[SM_OPEN]]${g1}[[SM_CLOSE]]`],
    [/\\small\{([^{}]*)\}/g, (_m, g1) => `[[SM_OPEN]]${g1}[[SM_CLOSE]]`],
  ];

  for (let pass = 0; pass < 2; pass++) {
    for (const [rx, fn] of replacements) {
      out = out.replace(rx, fn);
    }
  }

  // Strip remaining bare latex commands like \footnotesize, \noindent, \space, ~
  out = out.replace(/\\(footnotesize|small|tiny|normalsize|noindent|space|enspace|quad|qquad)\b/g, ' ');
  out = out.replace(/~/g, ' ');
  out = out.replace(/\\([&%$#_{}])/g, '$1');

  out = escapeHtmlText(out);
  out = out
    .replace(/\[\[LG_BR\]\]/g, '<br/>')
    .replace(/\[\[B_OPEN\]\]/g, '<strong>')
    .replace(/\[\[B_CLOSE\]\]/g, '</strong>')
    .replace(/\[\[I_OPEN\]\]/g, '<em>')
    .replace(/\[\[I_CLOSE\]\]/g, '</em>')
    .replace(/\[\[SC_OPEN\]\]/g, '<span class="preview-sc">')
    .replace(/\[\[SC_CLOSE\]\]/g, '</span>')
    .replace(/\[\[SM_OPEN\]\]/g, '<span class="preview-small">')
    .replace(/\[\[SM_CLOSE\]\]/g, '</span>');

  return out;
}

export interface EvaluateAstContext {
  rawVars: Record<string, string>;
  latexVars: Record<string, string>;
  previewVars: Record<string, string>;
}

export function evaluateMaskAst(
  nodes: AstNode[],
  ctx: EvaluateAstContext
): { latex: string; html: string } {
  let latex = '';
  let html = '';

  for (const node of nodes) {
    if (node.type === 'text') {
      latex += node.value;
      html += staticLatexTextToPreviewHtml(node.value);
    } else if (node.type === 'var') {
      latex += ctx.latexVars[node.name] ?? '';
      html += ctx.previewVars[node.name] ?? '';
    } else if (node.type === 'shorthand') {
      const rawVal = (ctx.rawVars[node.name] ?? '').trim();
      if (rawVal.length > 0) {
        latex += node.prefix + (ctx.latexVars[node.name] ?? '') + node.suffix;
        html +=
          staticLatexTextToPreviewHtml(node.prefix) +
          (ctx.previewVars[node.name] ?? '') +
          staticLatexTextToPreviewHtml(node.suffix);
      }
    } else if (node.type === 'if') {
      for (const branch of node.branches) {
        if (branch.condition === null || evaluateConditionExpr(branch.condition, ctx.rawVars)) {
          const sub = evaluateMaskAst(branch.body, ctx);
          latex += sub.latex;
          html += sub.html;
          break;
        }
      }
    }
  }

  return { latex, html };
}

export function cleanupRenderedMaskOutput(latex: string, html: string): { latex: string; html: string } {
  const cleanLatex = latex
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/^\s*[,;]\s*/, '')
    .trim();

  const cleanHtml = html
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/^\s*[,;]\s*/, '')
    .replace(/(<br\/>\s*){3,}/g, '<br/><br/>')
    .trim();

  return { latex: cleanLatex, html: cleanHtml };
}
