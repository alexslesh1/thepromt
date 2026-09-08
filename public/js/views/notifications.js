/** Уведомления — внутренние сообщения: лайки, комментарии, модерация, жалобы. */

import { api } from '../api.js';
import { refreshBadges, state } from '../state.js';
import { navigate } from '../router.js';
import { avatar, emptyState, h, spinner, timeEl, toast } from '../dom.js';
import { openAuth } from '../components/auth.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

const ICONS = {
  like: '❤️',
  comment: '💬',
  repost: '🔁',
  follow: '👤',
  report: '⚑',
  moderation: '🛡',
  system: '✨',
};

export async function notificationsView() {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  if (!state.user) {
    main.append(
      header({ title: 'Уведомления' }),
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'big', text: '🔔' }),
        h('h3', { text: 'Нужен вход' }),
        h('p', { text: 'Войдите, чтобы видеть уведомления и сообщения.' }),
        h('button', {
          class: 'btn',
          text: 'Войти',
          onClick: async () => {
            if (await openAuth()) notificationsView();
          },
        }),
      ),
    );
    return;
  }

  const list = h('div', {}, spinner('Загружаем уведомления…'));

  main.append(
    header({ title: 'Уведомления', subtitle: 'Лайки, ответы и сообщения модерации' }),
    h(
      'div',
      { style: { padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex' } },
      h('span', { style: { flex: 1 } }),
      h('button', {
        class: 'btn ghost small',
        text: 'Отметить всё прочитанным',
        onClick: async () => {
          try {
            await api.readNotifications();
            await refreshBadges();
            notificationsView();
          } catch (error) {
            toast(error.message, 'error');
          }
        },
      }),
    ),
    list,
  );

  try {
    const data = await api.notifications({ limit: 50 });
    if (!data.items.length) {
      list.replaceChildren(
        emptyState('🔔', 'Уведомлений пока нет', 'Здесь появятся лайки, комментарии и сообщения модерации.'),
      );
      return;
    }

    list.replaceChildren(
      ...data.items.map((item) =>
        h(
          'div',
          {
            class: `notif${item.read ? '' : ' unread'}`,
            onClick: async () => {
              if (!item.read) {
                api.readNotifications(item.id).then(refreshBadges).catch(() => {});
              }
              if (item.link) navigate(item.link);
            },
          },
          h('div', { class: 'ico', text: ICONS[item.type] ?? '•' }),
          item.actor ? avatar(item.actor, 'sm', { link: false }) : null,
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('div', { class: 'title', text: item.title }),
            item.body ? h('div', { class: 'body', text: item.body }) : null,
            timeEl(item.createdAt),
          ),
        ),
      ),
    );
    await refreshBadges();
  } catch (error) {
    list.replaceChildren(emptyState('⚠️', 'Не удалось загрузить', error.message));
  }
}
