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
  message: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-1L3 20l1.1-4.6a8.4 8.4 0 0 1-1.1-4A8.4 8.4 0 0 1 11.5 3h.5a8.4 8.4 0 0 1 9 8z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  crown: 'M2 18h20l-2-11-5 4-3-6-3 6-5-4z',
  poll: 'M18 20V10M12 20V4M6 20v-6',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  plus: 'M12 5v14M5 12h14',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 3v4M21 5h-4',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  verified: 'M12 2 15 5l4-.5.5 4L22 12l-2.5 3.5.5 4-4-.5L12 22l-3-3-4 .5.5-4L3 12l2.5-3.5-.5-4 4 .5z',
  shieldCheck: 'M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6zM9 12l2 2 4-4',
};

/** Абстрактные знаки для плиток моделей — без воспроизведения логотипов брендов. */
const GLYPHS = {
  spark: 'M12 4v16M4 12h16M6.5 6.5l11 11M17.5 6.5l-11 11',
  burst: 'M12 3v18M5 6l14 12M19 6L5 18',
  diamond: 'M12 3l5 9-5 9-5-9z',
  sail: 'M12 3v18M12 3 5 18h7M12 6l6 12h-6',
  palette: 'M12 3a9 9 0 1 0 0 18h2a3 3 0 0 0 0-6h-1a2 2 0 0 1 0-4h2a4 4 0 0 0-3-8zM8 9h.01M9 14h.01M15 7h.01',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5',
  wave: 'M3 12c3-5 6-5 9 0s6 5 9 0M3 17c3-5 6-5 9 0',
  play: 'M8 5v14l11-7z',
  note: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  circle: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  whale: 'M3 13c4 5 14 5 18 0-2-6-6-8-9-8s-7 2-9 8zM8 11h.01',
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
  path.setAttribute('d', PATHS[name] ?? GLYPHS[name] ?? PATHS.more);
  svg.append(path);
  return svg;
}

/**
 * Бейдж верификации Pro — золотая «печать»-галочка.
 */
export function proBadge(size = 14) {
  return icon('verified', { size, filled: true, class: 'pro-badge' });
}

/**
 * Бейдж админа — отдельная форма (щит), а не та же «печать», что у Pro,
 * чтобы их нельзя было спутать даже без цвета.
 */
export function adminBadge(size = 14) {
  return icon('shield', { size, filled: true, class: 'admin-badge' });
}

/**
 * Официальные иконки нейросетей и сервисов — берём готовыми картинками
 * (lobehub для нейросетей, Simple Icons для площадок входа), а не рисуем
 * логотипы брендов сами. Если картинка не загрузилась (сеть недоступна),
 * `<img onerror>` подменяет её нашей абстрактной плиткой — интерфейс не ломается.
 */
const LOBEHUB_BASE = 'https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/';
const LOBEHUB_SLUGS = {
  chatgpt: 'openai',
  dalle: 'openai',
  claude: 'claude-color',
  gemini: 'gemini-color',
  llama: 'meta-color',
  midjourney: 'midjourney',
  'stable-diffusion': 'stability-color',
  deepseek: 'deepseek-color',
  suno: 'suno',
  sora: 'openai',
  flux: 'flux',
  ollama: 'ollama',
};

const SIMPLEICONS_SLUGS = {
  github: 'github',
  google: 'google',
  microsoft: 'microsoft',
  discord: 'discord',
};

/**
 * img с откатом на переданный фолбэк-узел, если картинка не загрузилась —
 * или зависла: у внешних CDN «error» иногда не срабатывает быстро (обрыв
 * соединения без явного отказа), поэтому есть и таймаут.
 * Без h() из dom.js — dom.js сам импортирует icon() отсюда, а циклический
 * импорт функции здесь не нужен: DOM API хватает.
 */
function imgWithFallback(src, { size, alt = '', fallback }) {
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  Object.assign(img.style, { width: `${size}px`, height: `${size}px`, objectFit: 'contain', display: 'block' });

  let settled = false;
  const swap = () => {
    if (settled || !img.isConnected) return;
    settled = true;
    img.replaceWith(fallback());
  };
  img.addEventListener('error', swap, { once: true });
  img.addEventListener('load', () => {
    settled = true;
  });
  setTimeout(swap, 4000);
  return img;
}

/**
 * Плитка пользовательской модели (своя или общая, добавленная через
 * /api/models): картинка по iconUrl, если она задана и загрузилась,
 * иначе — плитка с первой буквой названия.
 */
export function customModelIcon(model, size = 22) {
  const tile = document.createElement('span');
  tile.className = 'model-tile';
  Object.assign(tile.style, { width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.32)}px` });
  tile.style.background = 'linear-gradient(140deg, #6b6b76, #6b6b7699)';

  const letterFallback = () => {
    const span = document.createElement('span');
    span.textContent = (model?.name || '?').trim().slice(0, 1).toUpperCase();
    span.style.fontSize = `${Math.round(size * 0.5)}px`;
    span.style.fontWeight = '700';
    return span;
  };

  tile.append(model?.iconUrl ? imgWithFallback(model.iconUrl, { size: size - 6, fallback: letterFallback }) : letterFallback());
  return tile;
}

/**
 * Плитка модели: официальная иконка нейросети (если известна) поверх
 * цветного квадрата, иначе — цветной квадрат с абстрактным знаком.
 * @param {{id?: string, color?: string, glyph?: string}} model
 */
export function modelTile(model, { big = false } = {}) {
  const tile = document.createElement('span');
  tile.className = `model-tile${big ? ' big' : ''}`;
  const color = model?.color ?? '#8a8a8a';
  tile.style.background = `linear-gradient(140deg, ${color}, ${color}99)`;
  tile.style.boxShadow = `0 4px 14px ${color}45`;

  const size = big ? 22 : 14;
  const slug = LOBEHUB_SLUGS[model?.id];
  const glyphIcon = () => icon(model?.glyph ?? 'circle', { size });

  if (!slug) {
    tile.append(glyphIcon());
    return tile;
  }

  // Официальные логотипы нейросетей рисуются под свой фон (часто тёмный
  // или, наоборот, светлый) и плохо видны прямо на цветной плитке —
  // кладём их на нейтральную светлую подложку. Если картинка не
  // загрузится, откатываемся на обычный белый глиф прямо на плитке.
  const plateSize = size + 8;
  const plate = document.createElement('span');
  plate.className = 'model-tile-plate';
  Object.assign(plate.style, {
    width: `${plateSize}px`,
    height: `${plateSize}px`,
    borderRadius: `${Math.round(plateSize * 0.3)}px`,
  });
  plate.append(
    imgWithFallback(`${LOBEHUB_BASE}${slug}.png`, {
      size: size - 2,
      fallback: () => {
        plate.replaceWith(glyphIcon());
        return document.createElement('span');
      },
    }),
  );
  tile.append(plate);
  return tile;
}

/**
 * Иконка провайдера входа (GitHub, Google, Microsoft, Discord — Simple Icons;
 * ChatGPT/Claude — lobehub). При ошибке загрузки откатывается на плитку
 * с первой буквой названия.
 */
export function oauthProviderIcon(providerId, size = 18) {
  const fallback = () => {
    const span = document.createElement('span');
    span.className = 'oauth-fallback';
    span.style.width = `${size}px`;
    span.style.height = `${size}px`;
    span.textContent = (providerId[0] || '?').toUpperCase();
    return span;
  };

  if (providerId === 'openai' || providerId === 'anthropic') {
    const slug = providerId === 'openai' ? 'openai' : 'claude-color';
    return imgWithFallback(`${LOBEHUB_BASE}${slug}.png`, { size, fallback });
  }
  const slug = SIMPLEICONS_SLUGS[providerId];
  if (!slug) return fallback();
  return imgWithFallback(`https://cdn.simpleicons.org/${slug}`, { size, fallback });
}

/** Логотип ThePrompt — скруглённый квадрат с синим градиентом и буквой P. */
export function brandMark(size = 42) {
  const box = document.createElement('span');
  box.className = 'brand-mark';
  box.style.width = `${size}px`;
  box.style.height = `${size}px`;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', Math.round(size * 0.6));
  svg.setAttribute('height', Math.round(size * 0.6));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  // Буква P как узел нейросети: стойка, петля и два ответвления-связи.
  const letter = document.createElementNS(NS, 'path');
  letter.setAttribute('d', 'M10 26V6h8a6 6 0 0 1 0 12h-8');
  svg.append(letter);

  const link = document.createElementNS(NS, 'path');
  link.setAttribute('d', 'M18 18l6 6M24 6l-6 6');
  link.setAttribute('opacity', '0.55');
  svg.append(link);

  for (const [cx, cy] of [[24, 24], [24, 6]]) {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.setAttribute('r', '2.6');
    dot.setAttribute('fill', 'currentColor');
    dot.setAttribute('stroke', 'none');
    svg.append(dot);
  }

  box.append(svg);
  return box;
}
