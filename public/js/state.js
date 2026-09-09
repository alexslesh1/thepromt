/** Глобальное состояние приложения и подписки на его изменения. */

import { api } from './api.js';

const listeners = new Set();

export const state = {
  user: null,          // текущий пользователь (privateUser) или null
  meta: null,          // справочники моделей, уровней, категорий, причин жалоб
  oauthProviders: [],  // кнопки входа через сторонние сервисы
  theme: document.documentElement.dataset.theme || 'dark',
  unread: 0,           // непрочитанные уведомления
  unreadMessages: 0,   // непрочитанные внутренние сообщения
  unreadDms: 0,        // непрочитанные личные сообщения
  openReports: 0,      // открытые жалобы (для админа)
};

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
