/** Каркас приложения: левая панель, центральная колонка, правая панель. */

import { api } from '../api.js';
import { currentPath, navigate } from '../router.js';
import { isAdmin, setUser, state, subscribe, applyTheme } from '../state.js';
import { avatar, frag, h, modal, toast } from '../dom.js';
import { adminBadge, brandMark, icon, modelTile, proBadge } from '../icons.js';
import { openAuth } from './auth.js';
import { openComposer } from './composer.js';
import { openProModal } from './pro.js';

/* ------------------------------ Навигация ------------------------------ */

const NAV = [
  { href: '/', icon: 'home', label: 'Главная' },
  { href: '/explore', icon: 'search', label: 'Обзор' },
  { href: '/notifications', icon: 'bell', label: 'Уведомления', auth: true, badge: 'unread' },
  { href: '/messages', icon: 'message', label: 'Сообщения', auth: true, badge: 'unreadMessages' },
  { href: '/admin', icon: 'shieldCheck', label: 'Админка', admin: true, badge: 'openReports' },
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
  }
  items.push({ href: '/settings', icon: 'gear', label: 'Настройки' });
  return items;
}

function isActive(href) {
  const path = currentPath();
  return href === '/' ? path === '/' : path.startsWith(href);
}

function badgeValue(key) {
  const value =
    key === 'unread' ? state.unread : key === 'unreadMessages' ? state.unreadMessages : key === 'openReports' ? state.openReports : 0;
  return value > 0 ? (value > 99 ? '99+' : String(value)) : null;
}

function brand({ compact = false } = {}) {
  return h(
    'a',
    { class: 'brand', href: '/' },
    brandMark(compact ? 34 : 42),
    h(
      'span',
      { class: 'brand-text' },
      h('span', { class: 'brand-name', text: 'ThePrompt' }),
      h('span', { class: 'brand-slogan', text: 'Делись идеями. Создавай больше.' }),
    ),
  );
}

const composeAction = () =>
  openComposer({ onDone: () => window.dispatchEvent(new CustomEvent('ps:post-created')) });

/* ---------------------------- Левая панель ----------------------------- */

function leftColumn() {
  const column = h('aside', { class: 'col-left' });

  const nav = h(
    'nav',
    { class: 'nav' },
    navItems().map((item) => {
      const badge = item.badge ? badgeValue(item.badge) : null;
      return h(
        'a',
        {
          class: `nav-item${isActive(item.href) ? ' active' : ''}`,
          href: item.href,
          title: item.label,
        },
        h('span', { class: 'icon' }, icon(item.icon, { size: 21 })),
        h('span', { class: 'label', text: item.label }),
        badge ? h('span', { class: 'badge', text: badge }) : null,
      );
    }),
  );

  column.append(
    brand(),
    nav,
    h(
      'button',
      { class: 'compose-cta', title: 'Опубликовать промпт', onClick: composeAction },
      icon('plus', { size: 18 }),
      h('span', { class: 'label', text: 'Опубликовать промпт' }),
    ),
    assistantCard(),
    proCard(),
  );

  if (state.user?.username) {
    column.append(
      h(
        'button',
        { class: 'side-card me-chip', onClick: openAccountMenu, title: 'Аккаунт' },
        avatar(state.user, 'sm', { link: false }),
        h(
          'span',
          { class: 'grow who' },
          h('span', { class: 'name', text: state.user.displayName }),
          h('span', { class: 'handle', text: `@${state.user.username}` }),
        ),
        icon('more', { size: 15, filled: true, class: 'chev' }),
      ),
    );
  } else {
    column.append(
      h(
        'button',
        { class: 'btn ghost block', style: { marginTop: 'auto' }, onClick: () => openAuth() },
        icon('user', { size: 16 }),
        h('span', { class: 'label', text: 'Войти' }),
      ),
    );
  }

  return column;
}

/** Карточка Eduardo — ИИ-инструмента ThePrompt (вопрос-ответ, код, изображения). */
function assistantCard() {
  return h(
    'a',
    { class: 'side-card ai', href: '/eduardo', title: 'Eduardo — ИИ-инструмент' },
    h('span', { class: 'tile' }, icon('sparkles', { size: 19 })),
    h(
      'span',
      { class: 'grow' },
      h('span', { class: 't' }, 'Eduardo', h('span', { class: 'tag', text: 'AI' })),
      h('span', { class: 's', text: 'Ваш AI-помощник' }),
    ),
    icon('chevronRight', { size: 16, class: 'chev' }),
  );
}

function proCard() {
  const active = state.user?.isPro;
  return h(
    'button',
    { class: 'side-card pro', onClick: openProModal, title: 'ThePrompt Pro' },
    h('span', { class: 'tile' }, icon('crown', { size: 17 })),
    h(
      'span',
      { class: 'grow' },
      h('span', { class: 't' }, active ? 'Pro активен' : 'Перейти на Pro', active ? proBadge(14) : null),
      h('span', { class: 's', text: active ? 'Управление подпиской' : 'Больше возможностей для твоих идей' }),
    ),
    icon('chevronRight', { size: 16, class: 'chev' }),
  );
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
          text: 'Сохранённые промпты',
          onClick: () => {
            close();
            navigate(`/u/${state.user.username}?tab=bookmarks`);
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

/* ---------------------------- Правая панель ---------------------------- */

let searchInputRef = null;

function searchBox() {
  const input = h('input', {
    type: 'search',
    placeholder: 'Поиск промптов, моделей, тегов…',
    'aria-label': 'Поиск',
    value: new URLSearchParams(location.search).get('q') ?? '',
    onKeydown: (event) => {
      if (event.key === 'Escape') event.target.blur();
      if (event.key !== 'Enter') return;
      const value = event.target.value.trim();
      navigate(value ? `/explore?q=${encodeURIComponent(value)}` : '/explore');
    },
  });
  searchInputRef = input;
  return h(
    'div',
    { class: 'search-box' },
    h('span', { class: 'ico' }, icon('search', { size: 17 })),
    input,
    h('kbd', { text: 'Ctrl K' }),
  );
}

function themeCard() {
  const dark = state.theme !== 'light';
  const button = (theme, iconName, label) =>
    h(
      'button',
      {
        class: theme === state.theme ? 'on' : '',
        title: label,
        'aria-label': label,
        'aria-pressed': theme === state.theme ? 'true' : 'false',
        onClick: () => applyTheme(theme),
      },
      icon(iconName, { size: 15 }),
    );

  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'theme-card' },
      h('span', { class: 'tile' }, icon(dark ? 'moon' : 'sun', { size: 18 })),
      h(
        'span',
        { class: 'grow' },
        h('span', { class: 't', text: dark ? 'Тёмная тема' : 'Светлая тема' }),
        h('span', { class: 's', text: dark ? 'Комфортно для ваших идей' : 'Светлый режим включён' }),
      ),
      h('span', { class: 'theme-toggle' }, button('light', 'sun', 'Светлая тема'), button('dark', 'moon', 'Тёмная тема')),
    ),
  );
}

function cardHead(title, moreLabel, onMore) {
  return h(
    'div',
    { class: 'card-head' },
    h('h3', { text: title }),
    h('span', { class: 'spacer' }),
    onMore
      ? h(
          'button',
          { class: 'card-more', onClick: onMore },
          h('span', { text: moreLabel }),
          icon('chevronRight', { size: 14 }),
        )
      : null,
  );
}

const modelInfo = (id) => state.meta?.models.find((m) => m.id === id) ?? { id, label: id, short: id };

async function rightColumn() {
  const column = h('aside', { class: 'col-right' });

  const tagsCard = h('div', { class: 'card' }, cardHead('Популярные теги'), h('div', { class: 'muted-text', text: 'Загрузка…' }));
  const modelsCard = h('div', { class: 'card' }, cardHead('Популярные модели'), h('div', { class: 'muted-text', text: 'Загрузка…' }));
  const peopleCard = h('div', { class: 'card' }, cardHead('Кого читать'), h('div', { class: 'muted-text', text: 'Загрузка…' }));

  column.append(searchBox(), themeCard(), tagsCard, modelsCard, peopleCard, promoCard(), sideFooter());

  try {
    const data = await api.sidebar();

    tagsCard.replaceChildren(
      cardHead('Популярные теги', 'Показать все', () => navigate('/explore')),
      data.trendingTags.length
        ? h(
            'div',
            { class: 'tag-row', style: { marginBottom: 0 } },
            data.trendingTags.map((item) =>
              h('a', { class: 'chip', href: `/?tag=${encodeURIComponent(item.tag)}`, text: `#${item.tag}` }),
            ),
          )
        : h('div', { class: 'muted-text', text: 'Пока нет тегов — опубликуйте первый промпт.' }),
    );

    modelsCard.replaceChildren(
      cardHead('Популярные модели', 'Показать все', () => navigate('/explore')),
      ...(data.topModels.length
        ? data.topModels.map((item) => {
            const model = modelInfo(item.id);
            return h(
              'a',
              { class: 'card-row', href: `/?model=${item.id}` },
              modelTile(model, { big: true }),
              h(
                'span',
                { class: 'grow' },
                h('span', { class: 'strong ellipsis', text: model.short ?? model.label }),
                h('span', { class: 'muted ellipsis', text: model.hint ?? '' }),
              ),
              h('span', { class: 'count' }, h('b', { text: item.count }), h('span', { text: 'промптов' })),
            );
          })
        : [h('div', { class: 'muted-text', text: 'Пока нет опубликованных промптов.' })]),
    );

    peopleCard.replaceChildren(
      cardHead('Кого читать', 'Показать все', () => navigate('/explore')),
      ...(data.suggestedUsers.length
        ? data.suggestedUsers.map((user) => personRow(user))
        : [h('div', { class: 'muted-text', text: 'Пока некого предложить.' })]),
    );
  } catch {
    tagsCard.replaceChildren(cardHead('Популярные теги'), h('div', { class: 'muted-text', text: 'Не удалось загрузить' }));
  }

  return column;
}

/** Строка «Кого читать» с работающей кнопкой подписки. */
function personRow(user) {
  const button = h('button', {
    class: user.isFollowing ? 'btn ghost small' : 'btn small',
    text: user.isFollowing ? 'Вы подписаны' : 'Подписаться',
    onClick: async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!state.user) return void openAuth();
      button.disabled = true;
      try {
        const result = await api.follow(user.username);
        button.className = result.user.isFollowing ? 'btn ghost small' : 'btn small';
        button.textContent = result.user.isFollowing ? 'Вы подписаны' : 'Подписаться';
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    },
  });

  return h(
    'div',
    { class: 'card-row' },
    avatar(user, 'sm'),
    h(
      'a',
      { class: 'grow', href: `/u/${user.username}`, style: { minWidth: 0, color: 'inherit' } },
      h(
        'span',
        { class: 'strong ellipsis', style: { display: 'flex', alignItems: 'center', gap: '5px' } },
        h('span', { class: 'ellipsis', text: user.displayName }),
        user.role === 'admin' ? adminBadge(14) : null,
        user.isPro ? proBadge(14) : null,
      ),
      h('span', { class: 'muted ellipsis', text: `@${user.username}` }),
    ),
    button,
  );
}

function promoCard() {
  const card = h(
    'div',
    { class: 'promo-card' },
    h('h4', { text: 'ThePrompt' }),
    h('p', {
      text: 'Сообщество для обмена промптами и нейросетями. Вдохновляйся, делись, создавай.',
    }),
    h('span', { class: 'glow' }),
  );

  // Декоративная «сетка нейросети» в углу карточки.
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'mesh');
  svg.setAttribute('width', '150');
  svg.setAttribute('height', '110');
  svg.setAttribute('viewBox', '0 0 150 110');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const lines = document.createElementNS(NS, 'path');
  lines.setAttribute('d', 'M20 20 70 55 20 90M70 55 130 25M70 55 130 85M130 25 130 85');
  lines.setAttribute('stroke', 'rgba(120,180,255,.45)');
  lines.setAttribute('stroke-width', '1.2');
  svg.append(lines);
  for (const [cx, cy, r] of [[20, 20, 3.5], [20, 90, 3.5], [70, 55, 5], [130, 25, 3.5], [130, 85, 3.5]]) {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.setAttribute('r', r);
    dot.setAttribute('fill', 'rgba(150,200,255,.7)');
    svg.append(dot);
  }
  card.append(svg);
  return card;
}

function sideFooter() {
  const link = (href, text) => h('a', { href, text });
  return h(
    'div',
    { class: 'side-footer' },
    link('/about', 'О проекте'),
    h('span', { class: 'sep', text: '·' }),
    link('/rules', 'Правила'),
    h('span', { class: 'sep', text: '·' }),
    link('/privacy', 'Конфиденциальность'),
    h('span', { class: 'sep', text: '·' }),
    link('/terms', 'Условия'),
    h('div', { text: `© ${new Date().getFullYear()} ThePrompt. Сделан для AI-креаторов.` }),
  );
}

/* ------------------------------ Мобильное ------------------------------ */

function mobileTop() {
  return h(
    'div',
    { class: 'mobile-top' },
    brand({ compact: true }),
    h('span', { class: 'spacer' }),
    h(
      'button',
      {
        class: 'icon-btn',
        title: 'Переключить тему',
        onClick: () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'),
      },
      icon(state.theme === 'dark' ? 'sun' : 'moon', { size: 19 }),
    ),
    state.user ? null : h('button', { class: 'btn small', text: 'Войти', onClick: () => openAuth() }),
  );
}

function mobileBar() {
  const items = [
    { href: '/', icon: 'home' },
    { href: '/explore', icon: 'search' },
    { href: '/eduardo', icon: 'sparkles', auth: true },
    { href: '/notifications', icon: 'bell', badge: 'unread', auth: true },
    { href: '/messages', icon: 'message', badge: 'unreadMessages', auth: true },
    ...(isAdmin() ? [{ href: '/admin', icon: 'shieldCheck', badge: 'openReports' }] : []),
    state.user?.username ? { href: `/u/${state.user.username}`, icon: 'user' } : { href: '/settings', icon: 'gear' },
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

/* ------------------------------- Рендер -------------------------------- */

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
      { class: 'fab', title: 'Опубликовать промпт', 'aria-label': 'Опубликовать промпт', onClick: composeAction },
      icon('plus', { size: 26 }),
    ),
  );

  rightColumn().then((column) => {
    const placeholder = app.querySelector('.col-right');
    if (placeholder) app.replaceChild(column, placeholder);
  });

  return mainColumn;
}

/** Перерисовывает меню — после входа, смены темы или новых уведомлений. */
export function refreshChrome() {
  const app = document.getElementById('app');
  const left = app.querySelector('.col-left');
  if (left) app.replaceChild(leftColumn(), left);

  const bar = document.querySelector('.mobile-bar');
  if (bar) bar.replaceWith(mobileBar());

  const right = app.querySelector('.col-right');
  const themeBox = right?.querySelector('.theme-card')?.closest('.card');
  if (themeBox) themeBox.replaceWith(themeCard());
}

/** Заголовок центральной колонки. */
export function header({ title, subtitle = '', back = false, pill = null, tabs = null }) {
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
            icon('back', { size: 18 }),
          )
        : null,
      h('div', {}, h('h1', { text: title }), subtitle ? h('div', { class: 'sub', text: subtitle }) : null),
      h('span', { class: 'spacer' }),
      pill ? h('span', { class: 'header-pill' }, icon(pill.icon ?? 'users', { size: 16 }), h('span', { text: pill.label })) : null,
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

/** Ctrl/Cmd + K — фокус в поиск. */
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (searchInputRef?.isConnected) {
      searchInputRef.focus();
      searchInputRef.select();
    } else {
      navigate('/explore');
    }
  }
});

subscribe(() => {
  if (mainColumn && document.getElementById('app').contains(mainColumn)) refreshChrome();
});
