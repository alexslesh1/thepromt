/**
 * Набор иконок в виде инлайновых SVG.
 * Эмодзи выглядят по-разному в разных системах, поэтому интерфейсные
 * иконки рисуем сами: одна геометрия и цвет наследуется от currentColor.
 */

const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.35-4.35',
  bell: 'M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M13.7 20a2 2 0 0 1-3.4 0',
  shield: 'M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z',
  user: 'M20 20v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  feather: 'M20.2 3.8a5.5 5.5 0 0 0-7.8 0L4 12.2V20h7.8l8.4-8.4a5.5 5.5 0 0 0 0-7.8zM16 8 4.5 19.5M14 10H8',
  comment: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-1L3 20l1.1-4.6a8.4 8.4 0 0 1-1.1-4A8.4 8.4 0 0 1 11.5 3h.5a8.4 8.4 0 0 1 9 8z',
  repost: 'M17 2.5 21 6l-4 3.5M21 6H7a4 4 0 0 0-4 4v1M7 21.5 3 18l4-3.5M3 18h14a4 4 0 0 0 4-4v-1',
  heart: 'M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1l1.7 1.7L12 21.2l7.1-7.1 1.7-1.7a5 5 0 0 0 0-6.8z',
  flag: 'M4 21V4M4 4h11l-1.5 4L15 12H4',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5',
  copy: 'M9 9h10v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9z M15 5H5a2 2 0 0 0-2 2v10',
  check: 'M20 6 9 17l-5-5',
  close: 'M18 6 6 18M6 6l12 12',
  back: 'M19 12H5M12 19l-7-7 7-7',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  warn: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  ban: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
};

/**
 * Возвращает SVG-иконку.
 * @param {keyof PATHS} name
 * @param {{size?: number, filled?: boolean, class?: string}} options
 */
export function icon(name, { size = 18, filled = false, class: className = '' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', filled ? '0' : '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);
  svg.style.flex = 'none';

  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] ?? PATHS.more);
  svg.append(path);
  return svg;
}
