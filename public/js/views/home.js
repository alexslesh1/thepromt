/** Главная: лента промптов с вкладками, фильтрами и сортировкой. */

import { api } from '../api.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { emptyState, h } from '../dom.js';
import { icon } from '../icons.js';
import { t, translateCategory, translateDifficulty, translateModel, translateSort } from '../i18n.js';
import { feedList } from '../components/post.js';
import { inlineComposer, selectWrap } from '../components/composer.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

const TABS = () => [
  { id: 'latest', label: t('home.tab.latest') },
  { id: 'popular', label: t('home.tab.popular') },
  { id: 'following', label: t('home.tab.following') },
];

/** Селекторы «Все модели / Любой уровень / Все категории / Сначала свежее». */
function filterBar(query, setParam, { showSort = true } = {}) {
  const build = (name, allLabel, items, key, translateItem) => {
    const select = h(
      'select',
      { class: 'select', 'aria-label': name, onChange: (event) => setParam(key, event.target.value) },
      allLabel ? h('option', { value: '', text: allLabel }) : null,
      items.map((item) =>
        h('option', { value: item.id, text: translateItem(item.id, item.label), selected: (query.get(key) ?? '') === item.id }),
      ),
    );
    return selectWrap(select);
  };

  const bar = h(
    'div',
    { class: 'filter-bar' },
    build('Модель', t('home.filter.model'), state.meta?.models ?? [], 'model', (id, fallback) => translateModel({ id, label: fallback }).label),
    build('Уровень', t('home.filter.difficulty'), state.meta?.difficulties ?? [], 'difficulty', translateDifficulty),
    build('Категория', t('home.filter.category'), state.meta?.categories ?? [], 'category', translateCategory),
  );

  if (showSort) {
    const sort = h(
      'select',
      { class: 'select', 'aria-label': t('home.filter.sort'), onChange: (event) => setParam('sort', event.target.value) },
      (state.meta?.sortOptions ?? []).map((option) =>
        h('option', {
          value: option.id,
          text: translateSort(option.id, option.label),
          selected: (query.get('sort') ?? 'new') === option.id,
        }),
      ),
    );
    const wrap = selectWrap(sort);
    wrap.classList.add('sort');
    bar.append(wrap);
  }

  return bar;
}

/** Активные фильтры отдельной строкой — их видно и легко сбросить. */
function activeFilters(query) {
  const chips = [];
  const add = (text) => chips.push(h('span', { class: 'chip static', text }));

  const tag = query.get('tag');
  const search = query.get('q');
  if (tag) add(`#${tag}`);
  if (search) add(`«${search}»`);
  if (!chips.length) return null;

  return h(
    'div',
    { class: 'active-filters' },
    ...chips,
    h('button', { class: 'chip', onClick: () => navigate('/') }, icon('close', { size: 13 }), h('span', { text: t('home.filter.reset') })),
  );
}

export async function homeView({ query }) {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  const tabs = TABS();
  const requestedTab = query.get('tab') ?? 'latest';
  const tab = tabs.some((tabItem) => tabItem.id === requestedTab) ? requestedTab : 'latest';

  const setParam = (key, value) => {
    const next = new URLSearchParams(location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    const search = next.toString();
    navigate(`/${search ? `?${search}` : ''}`);
  };

  main.append(
    header({
      title: t('header.home.title'),
      subtitle: t('header.home.subtitle'),
      pill: { icon: 'users', label: t('header.home.pill') },
      tabs: {
        items: tabs,
        active: tab,
        onSelect: (id) => setParam('tab', id === 'latest' ? '' : id),
      },
    }),
  );

  if (tab === 'following' && !state.user) {
    main.append(emptyState('users', t('home.empty.needAuthTitle'), t('home.empty.needAuthText')));
    return;
  }

  const list = feedList({
    load: (page) =>
      api.feed({
        tab,
        model: query.get('model') ?? '',
        difficulty: query.get('difficulty') ?? '',
        category: query.get('category') ?? '',
        tag: query.get('tag') ?? '',
        q: query.get('q') ?? '',
        sort: query.get('sort') ?? '',
        page,
      }),
    emptyIcon: tab === 'following' ? 'users' : 'sparkles',
    emptyTitle: tab === 'following' ? t('home.empty.followingTitle') : t('home.empty.defaultTitle'),
    emptyText: tab === 'following' ? t('home.empty.followingText') : t('home.empty.defaultText'),
  });

  main.append(inlineComposer({ onCreated: () => list.reload() }));
  main.append(filterBar(query, setParam, { showSort: tab !== 'popular' }));
  const filters = activeFilters(query);
  if (filters) main.append(filters);
  main.append(list);

  const onCreated = () => list.reload();
  window.addEventListener('ps:post-created', onCreated);
  main.addEventListener('ps:unmount', () => window.removeEventListener('ps:post-created', onCreated), { once: true });
}
