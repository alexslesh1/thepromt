/** Каркас приложения: левое меню, центральная колонка, правая колонка. */

import { api } from '../api.js';
import { currentPath, navigate } from '../router.js';
import { isAdmin, setUser, state, subscribe, toggleTheme } from '../state.js';
import { avatar, frag, h, modal, toast } from '../dom.js';
import { icon } from '../icons.js';
import { openAuth } from './auth.js';
import { openComposer } from './composer.js';

const NAV = [
  { href: '/', icon: 'home', label: 'Главная' },
  { href: '/explore', icon: 'search', label: 'Обзор' },
  { href: '/notifications', icon: 'bell', label: 'Уведомления', auth: true, badge: 'unread' },
  { href: '/admin', icon: 'shield', label: 'Админка', admin: true, badge: 'openReports' },
];

function navItems() {
  const items = [];
  for (const item of NAV) {
    if (item.auth && !state.user) continue;
    if (item.admin && !isAdmin()) continue;
    items.push(item);
  }
  if (state.user?.username) {
    items.push({ href: `/u/${state.user.username}`, icon: 'user', label: 'Профиль' });
    items.push({ href: '/settings', icon: 'gear', label: 'Настройки' });
  }
  return items;
}

function isActive(href) {
  const path = currentPath();
  return href === '/' ? path === '/' : path.startsWith(href);
}

function badgeValue(key) {
  const value = key === 'unread' ? state.unread : key === 'openReports' ? state.openReports : 0;
  return value > 0 ? (value > 99 ? '99+' : String(value)) : null;
}

function leftColumn() {
  const column = h('aside', { class: 'col-left' });

  const nav = h(
    'nav',
    { class: 'nav' },
    navItems().map((item) => {
      const badge = item.badge ? badgeValue(item.badge) : null;
      return h(
        'a',
        { class: `nav-item${isActive(item.href) ? ' active' : ''}`, href: item.href },
        h('span', { class: 'icon' }, icon(item.icon, { size: 21 })),
        h('span', { class: 'label', text: item.label }),
        badge ? h('span', { class: 'badge', text: badge }) : null,
      );
    }),
  );

  column.append(
    h(
      'a',
      { class: 'brand', href: '/' },
      h('span', { class: 'logo', text: '⌘' }),
      h('span', { class: 'word', text: 'PromptShare' }),
    ),
    nav,
    h(
      'button',
      {
        class: 'btn block compose-cta',
        title: 'Опубликовать промт',
        onClick: () =>
          openComposer({ onDone: () => window.dispatchEvent(new CustomEvent('ps:post-created')) }),
      },
      icon('feather', { size: 18 }),
      h('span', { class: 'label', text: 'Опубликовать промт' }),
    ),
  );

  if (state.user?.username) {
    column.append(
      h(
        'button',
        {
          class: 'me-chip',
          onClick: () => openAccountMenu(),
          title: 'Аккаунт',
        },
        avatar(state.user, 'sm', { link: false }),
        h(
          'span',
          { class: 'who' },
          h('span', { class: 'name', text: state.user.displayName }),
          h('span', { class: 'handle', text: `@${state.user.username}` }),
        ),
        icon('more', { size: 16, filled: true, class: 'more' }),
      ),
    );
  } else {
    column.append(
      h('button', {
        class: 'btn ghost block',
        style: { marginTop: '14px' },
        text: 'Войти',
        onClick: () => openAuth(),
      }),
    );
  }

  return column;
}

async function openAccountMenu() {
  await modal((close) =>
    frag(
      h('div', { class: 'modal-head' }, h('h2', { text: state.user.displayName })),
      h('p', { class: 'lead', text: state.user.email }),
      h(
        'div',
        { class: 'radio-list' },
        h('button', {
          class: 'btn subtle',
          text: 'Мой профиль',
          onClick: () => {
            close();
            navigate(`/u/${state.user.username}`);
          },
        }),
        h('button', {
          class: 'btn subtle',
          text: 'Настройки',
          onClick: () => {
            close();
            navigate('/settings');
          },
        }),
        h('button', {
          class: 'btn ghost',
          text: 'Выйти',
          onClick: async () => {
            close();
            await api.logout();
            setUser(null);
            toast('Вы вышли из аккаунта');
            navigate('/');
          },
        }),
      ),
    ),
  );
}

/* ---------------------------- Правая колонка --------------------------- */

function themeCard() {
  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'theme-switch' },
      h('span', { class: 'grow strong', text: state.theme === 'dark' ? 'Тёмная тема' : 'Светлая тема' }),
      h(
        'button',
        { class: 'btn ghost small', title: 'Переключить тему', onClick: () => toggleTheme() },
        icon(state.theme === 'dark' ? 'sun' : 'moon', { size: 15 }),
        h('span', { text: state.theme === 'dark' ? 'Светлая' : 'Тёмная' }),
      ),
    ),
  );
}

async function rightColumn() {
  const column = h('aside', { class: 'col-right' });

  const searchInput = h('input', {
    type: 'search',
    placeholder: 'Поиск промтов, моделей, тегов',
    'aria-label': 'Поиск',
    value: new URLSearchParams(location.search).get('q') ?? '',
    onKeydown: (event) => {
      if (event.key !== 'Enter') return;
      const value = event.target.value.trim();
      navigate(value ? `/explore?q=${encodeURIComponent(value)}` : '/explore');
    },
  });

  column.append(
    h('div', { class: 'search-box' }, h('span', { class: 'ico' }, icon('search', { size: 16 })), searchInput),
    themeCard(),
  );

  const trendsCard = h('div', { class: 'card' }, h('h3', { text: 'Популярные теги' }), h('div', { class: 'muted', text: 'Загрузка…' }));
  const modelsCard = h('div', { class: 'card' }, h('h3', { text: 'Модели' }), h('div', { class: 'muted', text: 'Загрузка…' }));
  const peopleCard = h('div', { class: 'card' }, h('h3', { text: 'Кого читать' }), h('div', { class: 'muted', text: 'Загрузка…' }));
  column.append(trendsCard, modelsCard, peopleCard);

  try {
    const data = await api.sidebar();

    trendsCard.replaceChildren(
      h('h3', { text: 'Популярные теги' }),
      ...(data.trendingTags.length
        ? data.trendingTags.map((item) =>
            h(
              'a',
              { class: 'card-row', href: `/?tag=${encodeURIComponent(item.tag)}` },
              h('span', { class: 'grow strong ellipsis', text: `#${item.tag}` }),
              h('span', { class: 'muted', text: item.count }),
            ),
          )
        : [h('div', { class: 'muted', text: 'Пока нет тегов — опубликуйте первый промт.' })]),
    );

    const { modelLabel } = await import('./post.js');
    modelsCard.replaceChildren(
      h('h3', { text: 'Модели' }),
      ...(data.topModels.length
        ? data.topModels.map((item) =>
            h(
              'a',
              { class: 'card-row', href: `/?model=${item.id}` },
              h('span', { class: 'grow strong ellipsis', text: modelLabel(item.id) }),
              h('span', { class: 'muted', text: item.count }),
            ),
          )
        : [h('div', { class: 'muted', text: 'Пока нет постов.' })]),
    );

    peopleCard.replaceChildren(
      h('h3', { text: 'Кого читать' }),
      ...(data.suggestedUsers.length
        ? data.suggestedUsers.map((user) =>
            h(
              'div',
              { class: 'card-row' },
              avatar(user, 'sm'),
              h(
                'a',
                { class: 'grow', href: `/u/${user.username}`, style: { minWidth: 0 } },
                h('span', { class: 'strong ellipsis', text: user.displayName }),
                h('span', { class: 'muted ellipsis', text: `@${user.username}` }),
              ),
              h('span', { class: 'muted', text: `${user.counts.posts}` }),
            ),
          )
        : [h('div', { class: 'muted', text: 'Пока некого предложить.' })]),
    );
  } catch {
    trendsCard.replaceChildren(h('h3', { text: 'Популярные теги' }), h('div', { class: 'muted', text: 'Не удалось загрузить' }));
  }

  column.append(
    h(
      'div',
      { class: 'card muted' },
      'PromptShare — демо-проект: соцсеть для обмена промтами к нейросетям.',
    ),
  );

  return column;
}

/* ------------------------------ Мобильное ------------------------------ */

function mobileTop() {
  return h(
    'div',
    { class: 'mobile-top' },
    h(
      'a',
      { class: 'brand', href: '/' },
      h('span', { class: 'logo', text: '⌘' }),
      h('span', { class: 'word', text: 'PromptShare' }),
    ),
    h('span', { class: 'grow' }),
    h(
      'button',
      { class: 'icon-btn', title: 'Переключить тему', onClick: () => toggleTheme() },
      icon(state.theme === 'dark' ? 'sun' : 'moon', { size: 19 }),
    ),
    state.user
      ? null
      : h('button', { class: 'btn small', text: 'Войти', onClick: () => openAuth() }),
  );
}

function mobileBar() {
  const items = [
    { href: '/', icon: 'home' },
    { href: '/explore', icon: 'search' },
    { href: '/notifications', icon: 'bell', badge: 'unread', auth: true },
    ...(isAdmin() ? [{ href: '/admin', icon: 'shield', badge: 'openReports' }] : []),
    state.user?.username
      ? { href: `/u/${state.user.username}`, icon: 'user' }
      : { href: '/settings', icon: 'gear' },
  ].filter((item) => !item.auth || state.user);

  return h(
    'nav',
    { class: 'mobile-bar' },
    items.map((item) => {
      const badge = item.badge ? badgeValue(item.badge) : null;
      return h(
        'button',
        {
          class: isActive(item.href) ? 'active' : '',
          onClick: () => navigate(item.href),
          'aria-label': item.href,
        },
        icon(item.icon, { size: 22 }),
        badge ? h('span', { class: 'badge', text: badge }) : null,
      );
    }),
  );
}

/* ------------------------------ Рендер --------------------------------- */

let mainColumn = null;

/** Возвращает центральную колонку, отрисовав каркас при первом вызове. */
export function shell() {
  const app = document.getElementById('app');
  if (mainColumn && app.contains(mainColumn)) {
    refreshChrome();
    return mainColumn;
  }

  mainColumn = h('main', { class: 'col-main' });
  app.replaceChildren(leftColumn(), mainColumn, h('aside', { class: 'col-right' }));

  document.body.append(mobileBar());
  document.body.append(
    h(
      'button',
      {
        class: 'fab',
        title: 'Опубликовать промт',
        'aria-label': 'Опубликовать промт',
        onClick: () =>
          openComposer({ onDone: () => window.dispatchEvent(new CustomEvent('ps:post-created')) }),
      },
      icon('feather', { size: 24 }),
    ),
  );

  rightColumn().then((column) => {
    const placeholder = app.querySelector('.col-right');
    if (placeholder) app.replaceChild(column, placeholder);
  });

  return mainColumn;
}

/** Перерисовывает меню (например, после входа или новых уведомлений). */
export function refreshChrome() {
  const app = document.getElementById('app');
  const left = app.querySelector('.col-left');
  if (left) app.replaceChild(leftColumn(), left);

  const bar = document.querySelector('.mobile-bar');
  if (bar) bar.replaceWith(mobileBar());
}

/** Заголовок центральной колонки. */
export function header({ title, subtitle = '', back = false, tabs = null }) {
  const box = h('div', { class: 'main-header' });
  box.append(
    h(
      'div',
      { class: 'title-row' },
      back
        ? h(
            'button',
            {
              class: 'back-btn',
              title: 'Назад',
              onClick: () => (history.length > 1 ? history.back() : navigate('/')),
            },
            icon('back', { size: 19 }),
          )
        : null,
      h('div', {}, h('h1', { text: title }), subtitle ? h('div', { class: 'sub', text: subtitle }) : null),
    ),
  );
  if (tabs) {
    box.append(
      h(
        'div',
        { class: 'tabs' },
        tabs.items.map((tab) =>
          h('button', {
            class: `tab${tab.id === tabs.active ? ' active' : ''}`,
            text: tab.label,
            onClick: () => tabs.onSelect(tab.id),
          }),
        ),
      ),
    );
  }
  return box;
}

export function mountMobileTop(main) {
  main.append(mobileTop());
}

subscribe(() => {
  if (mainColumn && document.getElementById('app').contains(mainColumn)) refreshChrome();
});
