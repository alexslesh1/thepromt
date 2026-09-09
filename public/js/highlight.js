/**
 * Лёгкая подсветка синтаксиса без внешних зависимостей — проект без сборщика,
 * весь JS отдаётся браузеру как есть, поэтому вместо тяжёлых библиотек вроде
 * highlight.js/Prism используем один общий набор правил (комментарии, строки,
 * числа, ключевые слова, вызовы функций), который сносно работает почти для
 * любого популярного языка сразу, без отдельной грамматики на каждый.
 */

const KEYWORDS = new Set([
  // JS/TS
  'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'do', 'switch',
  'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'super', 'import', 'export',
  'from', 'default', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield', 'typeof',
  'instanceof', 'in', 'of', 'null', 'undefined', 'void', 'delete', 'interface', 'type', 'enum',
  'implements', 'readonly', 'namespace',
  // Python
  'def', 'elif', 'except', 'pass', 'lambda', 'with', 'as', 'global', 'nonlocal', 'is', 'not',
  'and', 'or', 'None', 'True', 'False', 'self', 'raise', 'assert', 'import',
  // Java/C/C++/C#
  'public', 'private', 'protected', 'static', 'final', 'package', 'int', 'long', 'float',
  'double', 'char', 'boolean', 'string', 'String', 'struct', 'union', 'template', 'typename',
  'virtual', 'override', 'abstract', 'sealed', 'using', 'namespace', 'const', 'unsigned', 'signed',
  // Go
  'func', 'go', 'defer', 'chan', 'select', 'fallthrough', 'range', 'package',
  // Rust
  'fn', 'mut', 'impl', 'trait', 'match', 'pub', 'mod', 'use', 'loop', 'ref', 'let',
  // Ruby/PHP/shell
  'end', 'then', 'begin', 'module', 'require', 'echo', 'foreach', 'puts', 'print', 'unless',
  // SQL
  'select', 'insert', 'into', 'values', 'update', 'set', 'delete', 'table', 'create', 'drop',
  'alter', 'join', 'on', 'group', 'order', 'by', 'having', 'limit', 'union', 'distinct',
  'true', 'false',
]);

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Порядок альтернатив важен: сначала комментарии/строки (чтобы не подсвечивать
// ключевые слова внутри них), потом числа, идентификаторы (ключевые слова или
// вызовы функций — вызов отличаем по «(» сразу после имени).
const TOKEN_RE =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(\s*\()?/g;

/** @param {string} code @returns {string} безопасный HTML с <span class="hl-*"> */
export function highlightCode(code) {
  let out = '';
  let last = 0;
  for (const m of code.matchAll(TOKEN_RE)) {
    out += escapeHtml(code.slice(last, m.index));
    const [, comment, str, num, ident, callParen] = m;
    if (comment) out += `<span class="hl-com">${escapeHtml(comment)}</span>`;
    else if (str) out += `<span class="hl-str">${escapeHtml(str)}</span>`;
    else if (num) out += `<span class="hl-num">${escapeHtml(num)}</span>`;
    else if (ident) {
      if (KEYWORDS.has(ident)) out += `<span class="hl-kw">${escapeHtml(ident)}</span>`;
      else if (callParen) out += `<span class="hl-fn">${escapeHtml(ident)}</span>${escapeHtml(callParen)}`;
      else out += escapeHtml(ident);
    }
    last = m.index + m[0].length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

const EXTENSIONS = {
  javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx',
  python: 'py', py: 'py', java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs',
  go: 'go', golang: 'go', rust: 'rs', rb: 'rb', ruby: 'rb', php: 'php', sql: 'sql',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', html: 'html', css: 'css', scss: 'scss',
  json: 'json', yaml: 'yml', yml: 'yml', xml: 'xml', markdown: 'md', md: 'md', swift: 'swift',
  kotlin: 'kt', dart: 'dart', r: 'r',
};

export const extensionFor = (lang) => EXTENSIONS[(lang || '').toLowerCase()] || 'txt';
