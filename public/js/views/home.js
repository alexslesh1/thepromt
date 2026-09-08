/** Главная страница: лента промтов с вкладками и фильтрами. */

import { api } from '../api.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { h } from '../dom.js';
import { feedList } from '../components/post.js';
import { inlineComposer } from '../components/composer.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

const TABS = [
  { id: 'latest', label: 'Свежее' },
  { id: 'popular', label: 'Популярное' },
  { id: 'following', label: 'Подписки' },
];

/** Панель фильтров по модели и уровню сложности. */
function filterBar(query, onChange) {
  const modelSelect = h(
    'select',
    { class: 'select', onChange: (e) => onChange('model', e.target.value) },
    h('option', { value: '', text: 'Все модели' }),
    (state.meta?.models ?? []).map((model) =>
      h('option', { value: model.id, text: model.label, selected: query.get('model') === model.id }),
    ),
  );

  const difficultySelect = h(
    'select',
    { class: 'select', onChange: (e) => onChange('difficulty', e.target.value) },
    h('option', { value: '', text: 'Любой уровень' }),
    (state.meta?.difficulties ?? []).map((level) =>
      h('option', {
        value: level.id,
        text: level.label,
        selected: query.get('difficulty') === level.id,
      }),
    ),
  );

  const activeTag = query.get('tag');
  const activeQuery = query.get('q');

  return h(
    'div',
    { class: 'composer', style: { borderBottomWidth: '1px', paddingBottom: '12px' } },
    h('div', { class: 'row' }, modelSelect, difficultySelect),
    activeTag || activeQuery
      ? h(
          'div',
          { class: 'badges', style: { marginTop: '10px' } },
          activeTag ? h('span', { class: 'badge-chip tag static', text: activeTag }) : null,
          activeQuery ? h('span', { class: 'badge-chip static', text: `«${activeQuery}»` }) : null,
          h('button', {
            class: 'badge-chip',
            text: '✕ Сбросить фильтры',
            onClick: () => navigate('/'),
          }),
        )
      : null,
  );
}

export async function homeView({ query }) {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  const requestedTab = query.get('tab') ?? 'latest';
  const tab = TABS.some((t) => t.id === requestedTab) ? requestedTab : 'latest';

  const setParam = (key, value) => {
    const next = new URLSearchParams(location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    const search = next.toString();
    navigate(`/${search ? `?${search}` : ''}`);
  };

  main.append(
    header({
      title: 'Главная',
      tabs: {
        items: TABS,
        active: tab,
        onSelect: (id) => setParam('tab', id === 'latest' ? '' : id),
      },
    }),
  );

  if (tab === 'following' && !state.user) {
    main.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'big', text: '🔒' }),
        h('h3', { text: 'Лента подписок доступна после входа' }),
        h('p', { text: 'Войдите, чтобы видеть промты авторов, на которых вы подписаны.' }),
      ),
    );
    return;
  }

  main.append(inlineComposer({ onCreated: () => list.reload() }));
  main.append(filterBar(query, setParam));

  const params = {
    tab,
    model: query.get('model') ?? '',
    difficulty: query.get('difficulty') ?? '',
    tag: query.get('tag') ?? '',
    q: query.get('q') ?? '',
  };

  const list = feedList({
    load: (page) => api.feed({ ...params, page }),
    emptyIcon: tab === 'following' ? '👥' : '✨',
    emptyTitle: tab === 'following' ? 'Здесь появятся промты ваших подписок' : 'Пока нет промтов',
    emptyText:
      tab === 'following'
        ? 'Подпишитесь на авторов — их публикации соберутся в этой ленте.'
        : 'Опубликуйте первый промт или измените фильтры.',
  });
  main.append(list);

  const onCreated = () => list.reload();
  window.addEventListener('ps:post-created', onCreated);
  main.addEventListener('ps:unmount', () => window.removeEventListener('ps:post-created', onCreated), {
    once: true,
  });
}
