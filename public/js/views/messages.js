/**
 * «Сообщения» — внутренняя переписка платформы: решения модерации,
 * системные письма и уведомления о жалобах для администраторов.
 */

import { api } from '../api.js';
import { refreshBadges, state } from '../state.js';
import { navigate } from '../router.js';
import { avatar, emptyState, h, spinner, timeEl, toast } from '../dom.js';
import { icon } from '../icons.js';
import { openAuth } from '../components/auth.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

const ICONS = { moderation: 'shieldCheck', report: 'flag', system: 'sparkles' };

export async function messagesView() {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  if (!state.user) {
    main.append(
      header({ title: 'Сообщения', subtitle: 'Внутренняя переписка платформы' }),
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'big' }, icon('message', { size: 26 })),
        h('h3', { text: 'Нужен вход' }),
        h('p', { text: 'Войдите, чтобы читать сообщения модерации и системные письма.' }),
        h('button', {
          class: 'btn',
          style: { marginTop: '14px' },
          text: 'Войти',
          onClick: async () => {
            if (await openAuth()) messagesView();
          },
        }),
      ),
    );
    return;
  }

  const list = h('div', {}, spinner('Загружаем сообщения…'));

  main.append(
    header({
      title: 'Сообщения',
      subtitle: 'Решения модерации, жалобы и системные уведомления',
      pill: { icon: 'shieldCheck', label: 'Внутренняя переписка' },
    }),
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'flex-end', margin: '18px 0 14px' } },
      h('button', {
        class: 'btn ghost small',
        text: 'Отметить прочитанным',
        onClick: async () => {
          try {
            await api.readNotifications();
            await refreshBadges();
            messagesView();
          } catch (error) {
            toast(error.message, 'error');
          }
        },
      }),
    ),
    list,
  );

  try {
    const data = await api.notifications({ kind: 'messages', limit: 50 });
    if (!data.items.length) {
      list.replaceChildren(
        emptyState('message', 'Сообщений пока нет', 'Здесь появятся решения модерации и системные письма.'),
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
              if (!item.read) api.readNotifications(item.id).then(refreshBadges).catch(() => {});
              if (item.link) navigate(item.link);
            },
          },
          h('div', { class: 'ico' }, icon(ICONS[item.type] ?? 'message', { size: 18 })),
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
    list.replaceChildren(emptyState('warn', 'Не удалось загрузить', error.message));
  }
}
