/** Точка входа: загружает справочники и текущего пользователя, включает роутер. */

import { api } from './api.js';
import { applyTheme, refreshBadges, setUser, state } from './state.js';
import { initRouter, navigate, render, route, setNotFound } from './router.js';
import { emptyState, h, toast } from './dom.js';
import { header, mountMobileTop, shell } from './components/shell.js';
import { homeView } from './views/home.js';
import { exploreView } from './views/explore.js';
import { postView } from './views/post.js';
import { profileView } from './views/profile.js';
import { settingsView } from './views/settings.js';
import { notificationsView } from './views/notifications.js';
import { dmListView, dmThreadView } from './views/dm.js';
import { eduardoView } from './views/eduardo.js';
import { staticView } from './views/static.js';
import { adminView } from './views/admin.js';
import { openAuth, openCompleteProfile } from './components/auth.js';
import { openComposer } from './components/composer.js';
import './ws.js';

route('/', homeView);
route('/explore', exploreView);
route('/post/:id', postView);
route('/u/:username', profileView);
route('/settings', settingsView);
route('/notifications', notificationsView);
// Старый раздел «Сообщения» (внутренние уведомления) объединён с «Уведомления».
route('/messages', async () => navigate('/notifications?tab=moderation', { replace: true }));
route('/dm', dmListView);
route('/dm/:username', dmThreadView);
route('/eduardo', eduardoView);
route('/admin', adminView);

for (const page of ['about', 'rules', 'privacy', 'terms']) {
  route(`/${page}`, staticView(page));
}

route('/compose', async () => {
  navigate('/', { replace: true });
  await openComposer({ onDone: () => window.dispatchEvent(new CustomEvent('ps:post-created')) });
});

route('/login', async () => {
  navigate('/', { replace: true });
  await openAuth();
});

setNotFound(async () => {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);
  main.append(
    header({ title: 'Страница не найдена', back: true }),
    emptyState('search', 'Такой страницы нет', 'Проверьте адрес или вернитесь на главную.'),
    h(
      'div',
      { style: { textAlign: 'center', padding: '18px 0 30px' } },
      h('button', { class: 'btn', text: 'На главную', onClick: () => navigate('/') }),
    ),
  );
});

async function boot() {
  // Возврат со страницы OAuth-провайдера с ошибкой — показываем и убираем из адреса.
  const url = new URL(location.href);
  const oauthError = url.searchParams.get('oauthError');
  if (oauthError) {
    url.searchParams.delete('oauthError');
    history.replaceState({}, '', url.pathname + url.search + url.hash);
  }

  try {
    const [meta, me] = await Promise.all([api.meta(), api.me()]);
    state.meta = meta;
    setUser(me.user);
    if (me.user?.theme) applyTheme(me.user.theme, { persist: false });
    // Список кнопок OAuth не критичен для загрузки приложения — если сервис
    // недоступен, просто не показываем ни одну кнопку как настроенную.
    api
      .oauthProviders()
      .then((data) => {
        state.oauthProviders = data.providers;
      })
      .catch(() => {});
  } catch (error) {
    document.getElementById('app').replaceChildren(
      h(
        'div',
        { class: 'empty', style: { margin: '80px auto', maxWidth: '420px' } },
        h('h3', { text: 'Сервер недоступен' }),
        h('p', { text: error.message }),
        h('button', { class: 'btn', style: { marginTop: '14px' }, text: 'Обновить', onClick: () => location.reload() }),
      ),
    );
    return;
  }

  initRouter();
  await render();

  if (oauthError) toast(oauthError, 'error');

  // Если профиль не создан — сразу предлагаем завершить регистрацию.
  // Сессия уже открыта (по коду или через OAuth), поэтому просим только никнейм.
  if (state.user && !state.user.username) {
    toast('Завершите создание профиля');
    await openCompleteProfile();
    await render();
  }

  // Фоново обновляем счётчик уведомлений.
  setInterval(() => {
    if (!document.hidden) refreshBadges();
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshBadges();
  });
}

boot();
