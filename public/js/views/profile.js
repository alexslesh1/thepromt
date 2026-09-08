/** Профиль пользователя: баннер, аватар, счётчики и лента промтов. */

import { api } from '../api.js';
import { isAdmin } from '../state.js';
import { navigate } from '../router.js';
import { avatar, emptyState, frag, h, modal, plural, pluralWord, promptDialog, spinner, toast } from '../dom.js';
import { feedList } from '../components/post.js';
import { requireAuth } from '../components/auth.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

async function showPeople(username, kind) {
  const title = kind === 'followers' ? 'Подписчики' : 'Подписки';
  await modal((close) => {
    const list = h('div', {}, spinner('Загружаем…'));
    const load = kind === 'followers' ? api.followers(username) : api.following(username);
    load
      .then(({ users }) => {
        list.replaceChildren(
          ...(users.length
            ? users.map((user) =>
                h(
                  'a',
                  {
                    class: 'card-row',
                    href: `/u/${user.username}`,
                    onClick: () => close(),
                    style: { textDecoration: 'none', color: 'inherit' },
                  },
                  avatar(user, 'sm', { link: false }),
                  h(
                    'span',
                    { class: 'grow', style: { minWidth: 0 } },
                    h('span', { class: 'strong ellipsis', text: user.displayName }),
                    h('span', { class: 'muted ellipsis', text: `@${user.username}` }),
                  ),
                ),
              )
            : [h('p', { class: 'muted', text: 'Пока никого.' })]),
        );
      })
      .catch((error) => list.replaceChildren(h('p', { class: 'error-text', text: error.message })));

    return frag(
      h(
        'div',
        { class: 'modal-head' },
        h('h2', { text: title }),
        h('button', { class: 'icon-btn', text: '✕', onClick: () => close() }),
      ),
      list,
    );
  });
}

/** Кнопки модерации для админа. */
function moderationTools(user, onUpdated) {
  if (!isAdmin() || user.isMe || user.role === 'admin') return null;

  const act = async (action) => {
    let reason = '';
    if (action !== 'unban') {
      reason = await promptDialog({
        title: action === 'ban' ? 'Заблокировать пользователя' : 'Вынести предупреждение',
        message: 'Причина будет отправлена пользователю во внутреннем уведомлении.',
        placeholder: 'Например: спам и реклама курсов',
        confirmText: action === 'ban' ? 'Заблокировать' : 'Предупредить',
        danger: action === 'ban',
      });
      if (reason === undefined) return;
    }
    try {
      const result = await api.moderateUser(user.id, { action, reason });
      toast(
        action === 'ban' ? 'Пользователь заблокирован' : action === 'warn' ? 'Предупреждение отправлено' : 'Блокировка снята',
      );
      onUpdated(result.user);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return h(
    'div',
    { class: 'row', style: { marginTop: '10px' } },
    h('button', { class: 'btn ghost small', text: '⚠️ Предупредить', onClick: () => act('warn') }),
    user.status === 'banned'
      ? h('button', { class: 'btn ghost small', text: '✓ Разблокировать', onClick: () => act('unban') })
      : h('button', { class: 'btn danger small', text: '⛔ Заблокировать', onClick: () => act('ban') }),
  );
}

export async function profileView({ params, query }) {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  const head = h('div', {}, spinner('Загружаем профиль…'));
  main.append(head);

  let user;
  try {
    user = (await api.user(params.username)).user;
  } catch (error) {
    main.replaceChildren(
      header({ title: 'Профиль', back: true }),
      emptyState('🕳', 'Профиль не найден', error.message),
    );
    return;
  }

  main.replaceChildren();
  mountMobileTop(main);
  main.append(
    header({
      title: user.displayName,
      subtitle: plural(user.counts.posts, 'промт', 'промта', 'промтов'),
      back: true,
    }),
  );

  const render = (current) => {
    const banner = h('div', { class: 'profile-banner' });
    if (current.bannerUrl) {
      banner.style.backgroundImage = `url("${encodeURI(current.bannerUrl).replace(/"/g, '%22')}")`;
    }

    const followBtn = current.isMe
      ? h('button', { class: 'btn ghost', text: 'Редактировать профиль', onClick: () => navigate('/settings') })
      : h('button', {
          class: current.isFollowing ? 'btn ghost' : 'btn',
          text: current.isFollowing ? 'Вы подписаны' : 'Подписаться',
          onClick: async () => {
            if (!(await requireAuth('Войдите, чтобы подписываться'))) return;
            try {
              const result = await api.follow(current.username);
              render(result.user);
            } catch (error) {
              toast(error.message, 'error');
            }
          },
        });

    const stat = (count, one, few, many, onClick) =>
      h(
        onClick ? 'button' : 'span',
        onClick ? { onClick } : {},
        h('b', { text: count }),
        ` ${pluralWord(count, one, few, many)}`,
      );

    const stats = h(
      'div',
      { class: 'profile-stats' },
      stat(current.counts.posts, 'промт', 'промта', 'промтов'),
      stat(current.counts.following, 'подписка', 'подписки', 'подписок', () =>
        showPeople(current.username, 'following'),
      ),
      stat(current.counts.followers, 'подписчик', 'подписчика', 'подписчиков', () =>
        showPeople(current.username, 'followers'),
      ),
      stat(current.counts.likes, 'лайк', 'лайка', 'лайков'),
    );

    const statusNote =
      current.status === 'active'
        ? null
        : h('div', {
            class: `status-note${current.status === 'banned' ? ' banned' : ''}`,
            text:
              current.status === 'banned'
                ? `Аккаунт заблокирован: ${current.statusReason ?? 'нарушение правил'}`
                : `Предупреждение от модератора: ${current.statusReason ?? 'нарушение правил'}`,
          });

    profileHead.replaceChildren(
      banner,
      h(
        'div',
        { class: 'profile-head' },
        h(
          'div',
          { class: 'profile-top' },
          avatar(current, 'lg', { link: false }),
          followBtn,
        ),
        h(
          'div',
          {},
          h(
            'h2',
            { class: 'profile-name' },
            current.displayName,
            current.role === 'admin' ? h('span', { class: 'admin-tag', style: { marginLeft: '8px' }, text: 'админ' }) : null,
          ),
          h('div', { class: 'profile-handle', text: `@${current.username}` }),
        ),
        current.bio ? h('div', { class: 'profile-bio', text: current.bio }) : null,
        stats,
        statusNote,
        moderationTools(current, render),
      ),
    );
  };

  const profileHead = h('div', {});
  main.append(profileHead);
  render(user);

  const tab = query.get('tab') === 'likes' ? 'likes' : 'posts';
  main.append(
    h(
      'div',
      { class: 'tabs', style: { borderBottom: '1px solid var(--border)' } },
      [
        { id: 'posts', label: 'Промты и репосты' },
        { id: 'likes', label: 'Понравилось' },
      ].map((item) =>
        h('button', {
          class: `tab${item.id === tab ? ' active' : ''}`,
          text: item.label,
          onClick: () =>
            navigate(`/u/${user.username}${item.id === 'likes' ? '?tab=likes' : ''}`),
        }),
      ),
    ),
  );

  main.append(
    feedList({
      load: (page) => api.userPosts(user.username, { tab, page }),
      emptyIcon: tab === 'likes' ? '🤍' : '📝',
      emptyTitle: tab === 'likes' ? 'Пока нет понравившихся промтов' : 'Здесь пока нет промтов',
      emptyText:
        user.isMe && tab === 'posts' ? 'Опубликуйте первый промт — он появится здесь.' : '',
    }),
  );
}
