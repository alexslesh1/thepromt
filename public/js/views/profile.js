/** Профиль пользователя: баннер, аватар, счётчики и лента промптов. */

import { api } from '../api.js';
import { isAdmin } from '../state.js';
import { navigate } from '../router.js';
import { avatar, emptyState, frag, h, modal, plural, pluralWord, promptDialog, spinner, toast } from '../dom.js';
import { adminBadge, customModelIcon, icon, proBadge } from '../icons.js';
import { t } from '../i18n.js';
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
        h('button', { class: 'icon-btn', onClick: () => close(), 'aria-label': 'Закрыть' }, icon('close', { size: 18 })),
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
    h(
      'button',
      { class: 'btn ghost small', onClick: () => act('warn') },
      icon('warn', { size: 15 }),
      h('span', { text: 'Предупредить' }),
    ),
    user.status === 'banned'
      ? h(
          'button',
          { class: 'btn ghost small', onClick: () => act('unban') },
          icon('check', { size: 15 }),
          h('span', { text: 'Разблокировать' }),
        )
      : h(
          'button',
          { class: 'btn danger small', onClick: () => act('ban') },
          icon('ban', { size: 15 }),
          h('span', { text: 'Заблокировать' }),
        ),
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
      emptyState('user', 'Профиль не найден', error.message),
    );
    return;
  }

  main.replaceChildren();
  mountMobileTop(main);
  main.append(
    header({
      title: user.displayName,
      subtitle: plural(user.counts.posts, 'промпт', 'промпта', 'промптов'),
      back: true,
    }),
  );

  const render = (current) => {
    const banner = h('div', { class: 'profile-banner' });
    if (current.bannerUrl) {
      banner.style.backgroundImage = `url("${encodeURI(current.bannerUrl).replace(/"/g, '%22')}")`;
    }

    const followBtn = current.isMe
      ? h('button', { class: 'btn ghost', text: t('profile.editProfile'), onClick: () => navigate('/settings') })
      : h(
          'div',
          { style: { display: 'flex', gap: '8px' } },
          h('button', {
            class: 'btn ghost',
            title: 'Написать',
            onClick: async () => {
              if (!(await requireAuth('Войдите, чтобы писать личные сообщения'))) return;
              navigate(`/dm/${current.username}`);
            },
          }, icon('message', { size: 16 })),
          h('button', {
            class: current.isFollowing ? 'btn ghost' : 'btn',
            text: current.isFollowing ? t('follow.following') : t('follow.follow'),
            onClick: async () => {
              if (!(await requireAuth('Войдите, чтобы подписываться'))) return;
              try {
                const result = await api.follow(current.username);
                render(result.user);
              } catch (error) {
                toast(error.message, 'error');
              }
            },
          }),
        );

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
      stat(current.counts.posts, 'промпт', 'промпта', 'промптов'),
      stat(current.counts.following, 'подписка', 'подписки', 'подписок', () =>
        showPeople(current.username, 'following'),
      ),
      stat(current.counts.followers, 'подписчик', 'подписчика', 'подписчиков', () =>
        showPeople(current.username, 'followers'),
      ),
      stat(current.counts.likes, 'лайк', 'лайка', 'лайков'),
      current.isMe ? stat(current.counts.bookmarks ?? 0, 'сохранённый', 'сохранённых', 'сохранённых') : null,
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
            current.role === 'admin' ? adminBadge(19) : null,
            current.isPro ? proBadge(19) : null,
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

  const modelsSlot = h('div', {});
  main.append(modelsSlot);
  api
    .userModels(user.username)
    .then(({ items: models }) => {
      if (!models.length) return;
      modelsSlot.replaceChildren(
        h(
          'div',
          { class: 'card', style: { margin: '0 0 14px' } },
          h('h3', { class: 'section-title', style: { margin: '0 0 10px' }, text: 'Модели' }),
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: '10px' } },
            ...models.map((model) =>
              h('div', { class: 'model-badge' }, customModelIcon(model, 20), h('span', { text: model.name })),
            ),
          ),
        ),
      );
    })
    .catch(() => {});

  const items = [
    { id: 'posts', label: t('profile.tab.posts') },
    { id: 'likes', label: t('profile.tab.likes') },
    // Сохранённое приватно: вкладка есть только в собственном профиле.
    ...(user.isMe ? [{ id: 'bookmarks', label: t('profile.tab.bookmarks') }] : []),
  ];
  const requested = query.get('tab') ?? 'posts';
  const tab = items.some((i) => i.id === requested) ? requested : 'posts';

  main.append(
    h(
      'div',
      { class: 'profile-tabs' },
      items.map((item) =>
        h('button', {
          class: `tab${item.id === tab ? ' active' : ''}`,
          text: item.label,
          onClick: () => navigate(`/u/${user.username}${item.id === 'posts' ? '' : `?tab=${item.id}`}`),
        }),
      ),
    ),
  );

  const EMPTY = {
    posts: ['feather', 'Здесь пока нет промптов', user.isMe ? 'Опубликуйте первый промпт — он появится здесь.' : ''],
    likes: ['heart', 'Пока нет понравившихся промптов', ''],
    bookmarks: ['bookmark', 'Сохранённого пока нет', 'Нажмите на закладку под промптом, чтобы вернуться к нему позже.'],
  };

  main.append(
    feedList({
      load: (page) => api.userPosts(user.username, { tab, page }),
      emptyIcon: EMPTY[tab][0],
      emptyTitle: EMPTY[tab][1],
      emptyText: EMPTY[tab][2],
    }),
  );
}
