/** Глобальное состояние приложения и подписки на его изменения. */

import { api } from './api.js';

const listeners = new Set();

function initialLocale() {
  try {
    const saved = localStorage.getItem('ps-locale');
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* приватный режим — не страшно, останемся на языке по умолчанию */
  }
  return 'ru';
}

export const state = {
  user: null,          // текущий пользователь (privateUser) или null
  meta: null,          // справочники моделей, уровней, категорий, причин жалоб
  oauthProviders: [],  // кнопки входа через сторонние сервисы
  theme: document.documentElement.dataset.theme || 'dark',
  // Язык интерфейса — как и тема, доступен гостям (localStorage), а для
  // вошедших синхронизируется с аккаунтом (см. applyLocale/setUser).
  locale: initialLocale(),
  unread: 0,           // непрочитанные уведомления
  unreadMessages: 0,   // непрочитанные внутренние сообщения
  unreadDms: 0,        // непрочитанные личные сообщения
  openReports: 0,      // открытые жалобы (для админа)
};

document.documentElement.lang = state.locale;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit() {
  for (const listener of listeners) listener(state);
}

export function setUser(user) {
  state.user = user;
  state.unread = user?.unreadNotifications ?? 0;
  state.unreadMessages = user?.unreadMessages ?? 0;
  state.unreadDms = user?.unreadDms ?? 0;
  state.openReports = user?.openReports ?? 0;
  if (user?.theme && user.theme !== state.theme) applyTheme(user.theme, { persist: false });
  if (user?.locale && user.locale !== state.locale) applyLocale(user.locale, { persist: false, reload: false });
  emit();
}

export function applyTheme(theme, { persist = true } = {}) {
  if (theme === state.theme) return;
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  try {
    localStorage.setItem('ps-theme', state.theme);
  } catch {
    /* приватный режим — не страшно */
  }
  if (persist && state.user) {
    api.updateMe({ theme: state.theme }).catch(() => {});
  }
  emit();
}

export function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

/**
 * Меняет язык интерфейса. Работает и для гостей (сохраняется в
 * localStorage), а для вошедших ещё и синхронизируется с аккаунтом.
 * Переведённые строки читаются функцией t() в момент рендера, а не
 * реактивно, поэтому применяем новый язык перезагрузкой страницы —
 * самый надёжный способ обновить сразу и каркас, и открытый экран.
 */
export function applyLocale(locale, { persist = true, reload = true } = {}) {
  const next = locale === 'en' ? 'en' : 'ru';
  if (next === state.locale) return;
  state.locale = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem('ps-locale', next);
  } catch {
    /* приватный режим — не страшно */
  }
  if (persist && state.user) {
    api.updateMe({ locale: next }).catch(() => {});
  }
  if (reload) {
    location.reload();
    return;
  }
  emit();
}

export function toggleLocale() {
  applyLocale(state.locale === 'en' ? 'ru' : 'en');
}

export async function refreshMe() {
  const { user } = await api.me();
  setUser(user);
  return user;
}

/** Подтягивает счётчик непрочитанных уведомлений. */
export async function refreshBadges() {
  if (!state.user) return;
  try {
    const user = (await api.me()).user;
    if (user) {
      state.unread = user.unreadNotifications;
      state.unreadMessages = user.unreadMessages;
      state.unreadDms = user.unreadDms;
      state.openReports = user.openReports;
      emit();
    }
  } catch {
    /* тихо игнорируем — это фоновое обновление */
  }
}

export const isAdmin = () => state.user?.role === 'admin';
