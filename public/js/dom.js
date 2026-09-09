/** Небольшие помощники для работы с DOM без фреймворка. */

import { icon } from './icons.js';

/**
 * Создаёт элемент. Строки и числа среди детей вставляются как текст,
 * поэтому пользовательский контент не может превратиться в разметку.
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style') Object.assign(el.style, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'value') el.value = value;
      else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'open') {
        el[key] = !!value;
      } else el.setAttribute(key, value === true ? '' : value);
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export const qs = (selector, root = document) => root.querySelector(selector);

/* ------------------------------ Аватар ------------------------------- */

export function avatar(user, size = 'sm', { link = true } = {}) {
  const box = h('div', { class: `avatar ${size}`, 'aria-hidden': 'true' });
  const initials = (user?.displayName || user?.username || '').trim().slice(0, 1);
  if (user?.avatarUrl) {
    box.append(h('img', { src: user.avatarUrl, alt: '', loading: 'lazy' }));
  } else if (initials) {
    box.textContent = initials;
  } else {
    // Гость или пользователь без имени — нейтральная иконка вместо «?».
    box.append(icon('user', { size: size === 'lg' ? 56 : size === 'md' ? 22 : 18 }));
  }
  if (!link || !user?.username) return box;
  const anchor = h('a', {
    href: `/u/${user.username}`,
    class: 'avatar-link',
    'aria-label': user.displayName || user.username,
    style: { display: 'contents' },
  });
  anchor.append(box);
  return anchor;
}

/* ------------------------------- Время -------------------------------- */

/** Сервер отдаёт время в UTC в формате «YYYY-MM-DD HH:MM:SS». */
export function parseDate(value) {
  if (!value) return new Date(NaN);
  if (value.includes('T')) return new Date(value);
  return new Date(`${value.replace(' ', 'T')}Z`);
}

export function timeAgo(value) {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'только что';
  if (seconds < 90) return '1 мин';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} дн`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

export function fullDate(value) {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
}

export function timeEl(value) {
  return h('time', { datetime: value, title: fullDate(value), text: timeAgo(value) });
}

/** Выбирает форму слова: pluralWord(5, 'пост', 'поста', 'постов') → 'постов'. */
export function pluralWord(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Число со словом: plural(5, 'пост', 'поста', 'постов') → '5 постов'. */
export const plural = (n, one, few, many) => `${n} ${pluralWord(n, one, few, many)}`;

export const formatCount = (n) => (n > 999 ? `${(n / 1000).toFixed(n > 9999 ? 0 : 1)} тыс.` : String(n || ''));

/* ------------------------------- Тосты -------------------------------- */

export function toast(message, kind = 'info') {
  const root = document.getElementById('toast-root');
  const node = h('div', { class: `toast ${kind === 'error' ? 'error' : ''}`, text: message });
  root.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, kind === 'error' ? 4200 : 2400);
}

/* ------------------------------ Модалки ------------------------------- */

let openModals = 0;

/**
 * Показывает модальное окно. render(close) возвращает содержимое.
 * Возвращает промис, который резолвится значением, переданным в close().
 */
export function modal(render, { wide = false } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const backdrop = h('div', { class: 'modal-backdrop' });
    const box = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' });

    let done = false;
    const close = (result) => {
      if (done) return;
      done = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (--openModals <= 0) {
        openModals = 0;
        document.body.style.overflow = '';
      }
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close(undefined);
    };

    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close(undefined);
    });
    document.addEventListener('keydown', onKey);

    box.append(render(close));
    backdrop.append(box);
    root.append(backdrop);
    openModals += 1;
    document.body.style.overflow = 'hidden';

    const focusable = box.querySelector('input, textarea, select, button');
    focusable?.focus();
  });
}

/** Модалка подтверждения. */
export function confirmDialog({ title, message, confirmText = 'Подтвердить', danger = false }) {
  return modal((close) =>
    frag(
      h('div', { class: 'modal-head' }, h('h2', { text: title })),
      h('p', { class: 'lead', text: message }),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn ghost', onClick: () => close(false), text: 'Отмена' }),
        h('button', {
          class: `btn ${danger ? 'danger' : ''}`,
          onClick: () => close(true),
          text: confirmText,
        }),
      ),
    ),
  );
}

/** Модалка с одним текстовым полем. Возвращает строку или undefined. */
export function promptDialog({ title, message = '', placeholder = '', confirmText = 'Готово', value = '', danger = false }) {
  return modal((close) => {
    const input = h('textarea', { class: 'textarea', rows: 3, placeholder, value });
    return frag(
      h('div', { class: 'modal-head' }, h('h2', { text: title })),
      message ? h('p', { class: 'lead', text: message }) : null,
      input,
      h(
        'div',
        { class: 'row', style: { marginTop: '14px' } },
        h('button', { class: 'btn ghost', text: 'Отмена', onClick: () => close(undefined) }),
        h('button', {
          class: `btn ${danger ? 'danger' : ''}`,
          text: confirmText,
          onClick: () => close(input.value.trim()),
        }),
      ),
    );
  });
}

/* --------------------------- Буфер обмена ----------------------------- */

export async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* переходим к запасному варианту */
  }
  try {
    const area = h('textarea', {
      value,
      style: { position: 'fixed', top: '-1000px', opacity: '0' },
      'aria-hidden': 'true',
    });
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Автоматическое растягивание textarea под содержимое. */
export function autoGrow(textarea, max = 420) {
  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;
  };
  textarea.addEventListener('input', resize);
  requestAnimationFrame(resize);
  return resize;
}

/** Счётчик символов под полем ввода. */
export function charCounter(input, max) {
  const node = h('div', { class: 'counter' });
  const update = () => {
    const length = input.value.length;
    node.textContent = `${length} / ${max}`;
    node.classList.toggle('over', length > max);
  };
  input.addEventListener('input', update);
  update();
  return node;
}

export function spinner(text = 'Загрузка…') {
  return h('div', { class: 'loader' }, h('div', { class: 'spinner' }), h('div', { text }));
}

/** Пустое состояние. iconName — имя иконки из icons.js. */
export function emptyState(iconName, title, text) {
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'big' }, icon(iconName, { size: 26 })),
    h('h3', { text: title }),
    text ? h('p', { text }) : null,
  );
}
