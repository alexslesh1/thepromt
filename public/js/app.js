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
import { adminView } from './views/admin.js';
import { openAuth } from './components/auth.js';
import { openComposer } from './components/composer.js';

route('/', homeView);
route('/explore', exploreView);
route('/post/:id', postView);
route('/u/:username', profileView);
route('/settings', settingsView);
route('/notifications', notificationsView);
route('/admin', adminView);

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
    emptyState('🧭', 'Такой страницы нет', 'Проверьте адрес или вернитесь на главную.'),
    h(
      'div',
      { style: { textAlign: 'center', paddingBottom: '30px' } },
      h('button', { class: 'btn', text: 'На главную', onClick: () => navigate('/') }),
    ),
  );
});

async function boot() {
  try {
    const [meta, me] = await Promise.all([api.meta(), api.me()]);
    state.meta = meta;
    setUser(me.user);
    if (me.user?.theme) applyTheme(me.user.theme, { persist: false });
  } catch (error) {
    document.getElementById('app').replaceChildren(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'big', text: '🔌' }),
        h('h3', { text: 'Сервер недоступен' }),
        h('p', { text: error.message }),
        h('button', { class: 'btn', text: 'Обновить', onClick: () => location.reload() }),
      ),
    );
    return;
  }

  initRouter();
  await render();

  // Если профиль не создан — сразу предлагаем завершить регистрацию.
  if (state.user && !state.user.username) {
    toast('Завершите создание профиля');
    await openAuth(state.user.email);
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
