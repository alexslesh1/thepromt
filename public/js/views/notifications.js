/**
 * Уведомления — внутренние сообщения платформы. Вкладка «Активность»: лайки,
 * комментарии, репосты, подписки. Вкладка «Модерация»: решения модерации,
 * жалобы и системные письма (раньше был отдельный раздел «Сообщения»,
 * теперь объединён сюда).
 */
import { api } from '../api.js';
import { refreshBadges, state } from '../state.js';
import { navigate } from '../router.js';
import { avatar, emptyState, h, spinner, timeEl, toast } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { openAuth } from '../components/auth.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

const ICONS = {
  like: 'heart',
  comment: 'comment',
  repost: 'repost',
  follow: 'user',
  report: 'flag',
  moderation: 'shieldCheck',
  system: 'sparkles',
};

const TABS = () => [
  { id: 'activity', label: t('tabs.notifications.activity'), kind: 'activity', emptyIcon: 'bell', emptyTitle: 'Уведомлений пока нет', emptyText: 'Здесь появятся лайки, комментарии, репосты и новые подписчики.' },
  { id: 'moderation', label: t('tabs.notifications.moderation'), kind: 'messages', emptyIcon: 'shieldCheck', emptyTitle: 'Сообщений пока нет', emptyText: 'Здесь появятся решения модерации и системные письма.' },
];

export async function notificationsView({ query } = {}) {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  if (!state.user) {
    main.append(
      header({ title: t('header.notifications.title') }),
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'big' }, icon('bell', { size: 26 })),
        h('h3', { text: 'Нужен вход' }),
        h('p', { text: 'Войдите, чтобы видеть отклики на ваши промпты.' }),
        h('button', {
          class: 'btn',
          style: { marginTop: '14px' },
          text: 'Войти',
          onClick: async () => {
            if (await openAuth()) notificationsView();
          },
        }),
      ),
    );
    return;
  }

  const tabs = TABS();
  const requested = query?.get('tab');
  let active = tabs.find((tab) => tab.id === requested) ?? tabs[0];

  const list = h('div', {}, spinner('Загружаем…'));

  const tabsBox = h('div', { class: 'tabs' });
  const renderTabs = () => {
    tabsBox.replaceChildren(
      ...tabs.map((tab) =>
        h('button', {
          class: `tab${tab.id === active.id ? ' active' : ''}`,
          text: tab.label,
          onClick: () => {
            active = tab;
            renderTabs();
            load();
          },
        }),
      ),
    );
  };

  main.append(
    header({ title: t('header.notifications.title'), subtitle: t('header.notifications.subtitle') }),
    tabsBox,
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'flex-end', margin: '14px 0' } },
      h('button', {
        class: 'btn ghost small',
        text: t('notifications.markAllRead'),
        onClick: async () => {
          try {
            await api.readNotifications();
            await refreshBadges();
            load();
          } catch (error) {
            toast(error.message, 'error');
          }
        },
      }),
    ),
    list,
  );

  async function load() {
    list.replaceChildren(spinner('Загружаем…'));
    try {
      const data = await api.notifications({ kind: active.kind, limit: 50 });
      if (!data.items.length) {
        list.replaceChildren(emptyState(active.emptyIcon, active.emptyTitle, active.emptyText));
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
            h('div', { class: 'ico' }, icon(ICONS[item.type] ?? 'bell', { size: 18 })),
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

  renderTabs();
  await load();
}
