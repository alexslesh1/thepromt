/** Обзор: поиск по промптам и людям. */

import { api } from '../api.js';
import { navigate } from '../router.js';
import { avatar, emptyState, h, spinner } from '../dom.js';
import { icon } from '../icons.js';
import { feedList } from '../components/post.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

export async function exploreView({ query }) {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  const initial = query.get('q') ?? '';

  const input = h('input', {
    type: 'search',
    placeholder: 'Промпты, теги, модели, авторы…',
    value: initial,
    'aria-label': 'Поиск',
    onKeydown: (event) => {
      if (event.key !== 'Enter') return;
      const value = event.target.value.trim();
      navigate(value ? `/explore?q=${encodeURIComponent(value)}` : '/explore');
    },
  });

  main.append(
    header({ title: 'Обзор', subtitle: 'Поиск промптов, тегов, моделей и авторов' }),
    h(
      'div',
      { style: { padding: '14px 16px', borderBottom: '1px solid var(--border)' } },
      h('div', { class: 'search-box', style: { margin: 0 } }, h('span', { class: 'ico' }, icon('search', { size: 16 })), input),
    ),
  );

  if (!initial) {
    main.append(
      emptyState('search', 'Что ищем?', 'Например: «киберпанк», «midjourney», «маркетинг» или ник автора.'),
    );
    input.focus();
    return;
  }

  const peopleBox = h('div', {}, spinner('Ищем авторов…'));
  main.append(peopleBox);

  api
    .searchUsers(initial)
    .then(({ users }) => {
      if (!users.length) return peopleBox.replaceChildren();
      peopleBox.replaceChildren(
        h(
          'div',
          { style: { padding: '12px 16px 4px' } },
          h('h3', { class: 'section-title', style: { margin: '0 0 4px' }, text: 'Авторы' }),
        ),
        ...users.map((user) =>
          h(
            'a',
            {
              class: 'comment',
              href: `/u/${user.username}`,
              style: { textDecoration: 'none', color: 'inherit' },
            },
            avatar(user, 'md', { link: false }),
            h(
              'div',
              { class: 'body' },
              h('div', { class: 'strong', text: user.displayName }),
              h('div', { class: 'muted', style: { color: 'var(--text-muted)' }, text: `@${user.username}` }),
              user.bio ? h('div', { class: 'text', text: user.bio }) : null,
            ),
          ),
        ),
      );
    })
    .catch(() => peopleBox.replaceChildren());

  main.append(
    feedList({
      load: (page) => api.feed({ q: initial, page }),
      emptyIcon: 'search',
      emptyTitle: 'Ничего не нашлось',
      emptyText: 'Попробуйте другой запрос или уберите часть слов.',
    }),
  );
}
