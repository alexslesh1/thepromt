/** Админ-панель: жалобы, модерация постов и авторов, пользователи, статистика. */

import { api } from '../api.js';
import { isAdmin, refreshBadges } from '../state.js';
import { navigate } from '../router.js';
import {
  append,
  avatar,
  confirmDialog,
  emptyState,
  frag,
  h,
  modal,
  promptDialog,
  spinner,
  timeEl,
  toast,
} from '../dom.js';
import { customModelIcon, icon } from '../icons.js';
import { postCard } from '../components/post.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

const STATUS_TABS = [
  { id: 'open', label: 'Новые' },
  { id: 'resolved', label: 'Обработанные' },
  { id: 'dismissed', label: 'Отклонённые' },
  { id: 'users', label: 'Пользователи' },
  { id: 'models', label: 'Модели' },
];

/** Карточка жалобы со всеми действиями модератора. */
function reportCard(report, { onDone }) {
  const card = h('div', { class: 'report' });

  const openPost = async () => {
    const data = await api.adminReport(report.id);
    await modal(
      (close) =>
        frag(
          h(
            'div',
            { class: 'modal-head' },
            h('h2', { text: `Жалоба #${report.id}` }),
            h('button', { class: 'icon-btn', onClick: () => close(), 'aria-label': 'Закрыть' }, icon('close', { size: 18 })),
          ),
          h('p', { class: 'lead' }, `${data.report.reasonLabel}. Автор жалобы: `, h('b', { text: `@${data.report.reporter.username}` })),
          data.report.details ? h('div', { class: 'quote', text: data.report.details }) : null,
          data.post
            ? postCard(data.post, { detail: true })
            : h('p', { class: 'muted', text: 'Пост уже удалён из базы.' }),
          data.otherReports.length
            ? h(
                'div',
                { style: { marginTop: '12px' } },
                h('h3', { text: `Другие жалобы на этот пост (${data.otherReports.length})` }),
                ...data.otherReports.map((other) =>
                  h(
                    'div',
                    { class: 'card-row' },
                    h('span', { class: 'grow', text: `@${other.reporter} — ${other.reasonLabel}` }),
                    h('span', { class: `pill ${other.status}`, text: other.status }),
                  ),
                ),
              )
            : null,
          h('button', { class: 'btn ghost block', style: { marginTop: '14px' }, text: 'Закрыть', onClick: () => close() }),
        ),
      { wide: true },
    );
  };

  const deletePost = async () => {
    const reason = await promptDialog({
      title: 'Удалить пост',
      message: 'Причина будет отправлена автору во внутреннем уведомлении.',
      placeholder: 'Например: спам и реклама',
      confirmText: 'Удалить пост',
      danger: true,
    });
    if (reason === undefined) return;
    try {
      await api.adminDeletePost(report.post.id, reason);
      toast('Пост удалён, жалоба закрыта');
      onDone();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const restorePost = async () => {
    try {
      await api.adminRestorePost(report.post.id);
      toast('Пост восстановлен');
      onDone();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const dismiss = async () => {
    const note = await promptDialog({
      title: 'Отклонить жалобу',
      message: 'Автор жалобы получит уведомление о решении.',
      placeholder: 'Нарушений не найдено',
      confirmText: 'Отклонить жалобу',
    });
    if (note === undefined) return;
    try {
      await api.dismissReport(report.id, note);
      toast('Жалоба отклонена');
      onDone();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const moderate = async (action) => {
    let reason = '';
    if (action !== 'unban') {
      reason = await promptDialog({
        title: action === 'ban' ? 'Заблокировать автора' : 'Предупредить автора',
        message: 'Причина уйдёт автору во внутреннем уведомлении.',
        placeholder: 'Например: повторные нарушения правил',
        confirmText: action === 'ban' ? 'Заблокировать' : 'Предупредить',
        danger: action === 'ban',
      });
      if (reason === undefined) return;
    }
    try {
      await api.moderateUser(report.post.author.id, { action, reason, reportId: report.id });
      toast(action === 'ban' ? 'Автор заблокирован' : action === 'warn' ? 'Предупреждение отправлено' : 'Блокировка снята');
      onDone();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const statusLabel =
    report.status === 'open' ? 'новая' : report.status === 'resolved' ? 'обработана' : 'отклонена';

  // append() из dom.js молча пропускает null — нативный Element.append вставил бы «null».
  append(card, [
    h(
      'div',
      { class: 'head' },
      h('span', { class: 'reason', text: report.reasonLabel }),
      h('span', { class: `pill ${report.status}`, text: statusLabel }),
      report.post?.deleted ? h('span', { class: 'pill', text: 'пост удалён' }) : null,
      h('span', { style: { flex: 1 } }),
      timeEl(report.createdAt),
    ),
    h(
      'div',
      { class: 'card-row', style: { padding: 0 } },
      avatar(report.reporter, 'sm'),
      h('span', {
        class: 'grow',
        style: { color: 'var(--text-muted)' },
        text: `@${report.reporter.username} пожаловался(ась)${report.post ? ` на пост @${report.post.author.username}` : ''}`,
      }),
      report.post?.author.status && report.post.author.status !== 'active'
        ? h('span', {
            class: `pill ${report.post.author.status}`,
            text: report.post.author.status === 'banned' ? 'заблокирован' : 'предупреждён',
          })
        : null,
    ),
    report.details ? h('div', { class: 'quote', text: `Комментарий: ${report.details}` }) : null,
    h('div', { class: 'quote', text: report.post ? report.post.promptText : 'Пост недоступен' }),
    report.resolution
      ? h('div', { style: { color: 'var(--text-muted)', fontSize: '13px' }, text: `Решение: ${report.resolution}` })
      : null,
  ]);

  const action = (name, label, className, onClick) =>
    h('button', { class: `btn ${className} small`, onClick }, icon(name, { size: 15 }), h('span', { text: label }));

  const toolbar = h('div', { class: 'toolbar' });
  if (report.post) {
    append(toolbar, [
      action('eye', 'Открыть пост', 'ghost', openPost),
      action('link', 'Перейти к посту', 'ghost', () => navigate(`/post/${report.post.id}`)),
    ]);
  }
  if (report.status === 'open') {
    append(toolbar, [
      report.post && !report.post.deleted ? action('trash', 'Удалить пост', 'danger', deletePost) : null,
      report.post?.deleted ? action('back', 'Восстановить пост', 'ghost', restorePost) : null,
      report.post ? action('warn', 'Предупредить автора', 'warn', () => moderate('warn')) : null,
      report.post && report.post.author.status !== 'banned'
        ? action('ban', 'Заблокировать автора', 'danger', () => moderate('ban'))
        : null,
      report.post && report.post.author.status === 'banned'
        ? action('check', 'Разблокировать', 'ghost', () => moderate('unban'))
        : null,
      action('close', 'Отклонить жалобу', 'subtle', dismiss),
    ]);
  }
  card.append(toolbar);
  return card;
}

/** Вкладка со списком пользователей. */
async function usersTab(container) {
  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Поиск по нику, имени или email',
  });
  const list = h('div', {}, spinner('Загружаем пользователей…'));

  const load = async () => {
    list.replaceChildren(spinner('Загружаем пользователей…'));
    try {
      const data = await api.adminUsers({ q: search.value.trim(), limit: 50 });
      list.replaceChildren(
        ...(data.items.length
          ? data.items.map((user) =>
              h(
                'div',
                { class: 'report' },
                h(
                  'div',
                  { class: 'card-row', style: { padding: 0 } },
                  avatar(user, 'md'),
                  h(
                    'a',
                    { class: 'grow', href: `/u/${user.username}`, style: { minWidth: 0, color: 'inherit', textDecoration: 'none' } },
                    h('div', { class: 'strong', text: user.displayName }),
                    h('div', { class: 'muted', style: { color: 'var(--text-muted)' }, text: `@${user.username} · ${user.email}` }),
                  ),
                  user.role === 'admin' ? h('span', { class: 'pill', text: 'админ' }) : null,
                  user.status !== 'active'
                    ? h('span', { class: `pill ${user.status}`, text: user.status === 'banned' ? 'заблокирован' : 'предупреждён' })
                    : null,
                ),
                h(
                  'div',
                  { class: 'toolbar' },
                  h('span', { class: 'muted', style: { color: 'var(--text-muted)' }, text: `${user.counts.posts} промптов · ${user.counts.followers} подписчиков` }),
                ),
              ),
            )
          : [emptyState('search', 'Никого не найдено', '')]),
      );
    } catch (error) {
      list.replaceChildren(emptyState('warn', 'Ошибка', error.message));
    }
  };

  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  });

  container.replaceChildren(h('div', { style: { margin: '18px 0 14px' } }, search), list);
  await load();
}

/** Общий каталог AI-моделей: добавление, редактирование, удаление. */
async function modelsTab(container) {
  const list = h('div', {}, spinner('Загружаем модели…'));

  const load = async () => {
    list.replaceChildren(spinner('Загружаем модели…'));
    try {
      const { global } = await api.models();
      list.replaceChildren(
        ...(global.length
          ? global.map((model) =>
              h(
                'div',
                { class: 'card-row' },
                customModelIcon(model, 24),
                h('span', { class: 'grow strong', text: model.name }),
                h(
                  'button',
                  {
                    class: 'btn ghost small',
                    type: 'button',
                    onClick: async () => {
                      const ok = await confirmDialog({
                        title: 'Удалить модель?',
                        message: `«${model.name}» пропадёт из общего каталога у всех пользователей.`,
                        confirmText: 'Удалить',
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await api.deleteModel(model.id);
                        toast('Модель удалена');
                        load();
                      } catch (error) {
                        toast(error.message, 'error');
                      }
                    },
                  },
                  icon('trash', { size: 14 }),
                ),
              ),
            )
          : [emptyState('sparkles', 'Общий каталог пуст', 'Добавьте первую модель формой ниже.')]),
      );
    } catch (error) {
      list.replaceChildren(emptyState('warn', 'Ошибка', error.message));
    }
  };

  const nameInput = h('input', { class: 'input', placeholder: 'Название модели', maxlength: 60 });
  const iconInput = h('input', { class: 'input', placeholder: 'Ссылка на иконку (необязательно)', maxlength: 300 });
  const addForm = h(
    'form',
    {
      class: 'row',
      style: { margin: '18px 0 14px', gap: '8px', flexWrap: 'wrap' },
      onSubmit: async (event) => {
        event.preventDefault();
        const name = nameInput.value.trim();
        if (!name) return;
        try {
          await api.addModel({ name, iconUrl: iconInput.value.trim() || undefined, global: true });
          nameInput.value = '';
          iconInput.value = '';
          toast('Модель добавлена в общий каталог');
          load();
        } catch (error) {
          toast(error.message, 'error');
        }
      },
    },
    h('div', { class: 'grow', style: { minWidth: '160px' } }, nameInput),
    h('div', { class: 'grow', style: { minWidth: '200px' } }, iconInput),
    h('button', { class: 'btn small', type: 'submit', text: 'Добавить в каталог' }),
  );

  container.replaceChildren(addForm, list);
  await load();
}

export async function adminView({ query }) {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  if (!isAdmin()) {
    main.append(
      header({ title: 'Админ-панель' }),
      emptyState('shieldCheck', 'Доступ только для администраторов', 'Этот раздел закрыт для обычных пользователей.'),
    );
    return;
  }

  const tab = STATUS_TABS.some((t) => t.id === query.get('tab')) ? query.get('tab') : 'open';

  main.append(
    header({
      title: 'Админ-панель',
      subtitle: 'Жалобы и модерация сообщества',
      tabs: {
        items: STATUS_TABS,
        active: tab,
        onSelect: (id) => navigate(`/admin${id === 'open' ? '' : `?tab=${id}`}`),
      },
    }),
  );

  const statsBox = h('div', { class: 'admin-stats', style: { marginTop: '18px' } });
  main.append(statsBox);

  api
    .adminStats()
    .then(({ stats }) => {
      const cards = [
        ['Пользователей', stats.users],
        ['Промптов', stats.posts],
        ['Комментариев', stats.comments],
        ['Новых жалоб', stats.openReports],
        ['Всего жалоб', stats.totalReports],
        ['Заблокировано', stats.banned],
      ];
      statsBox.replaceChildren(
        ...cards.map(([label, value]) =>
          h('div', { class: 'stat' }, h('div', { class: 'n', text: value }), h('div', { class: 'l', text: label })),
        ),
      );
    })
    .catch(() => statsBox.replaceChildren());

  const content = h('div', {}, spinner('Загружаем…'));
  main.append(content);

  if (tab === 'users') {
    await usersTab(content);
    return;
  }
  if (tab === 'models') {
    await modelsTab(content);
    return;
  }

  const loadReports = async () => {
    content.replaceChildren(spinner('Загружаем жалобы…'));
    try {
      const data = await api.adminReports({ status: tab, limit: 50 });
      await refreshBadges();
      if (!data.items.length) {
        content.replaceChildren(
          emptyState(
            tab === 'open' ? 'check' : 'message',
            tab === 'open' ? 'Новых жалоб нет' : 'Список пуст',
            tab === 'open' ? 'Все обращения обработаны.' : '',
          ),
        );
        return;
      }
      content.replaceChildren(
        ...data.items.map((report) => reportCard(report, { onDone: loadReports })),
      );
    } catch (error) {
      content.replaceChildren(emptyState('warn', 'Не удалось загрузить', error.message));
    }
  };

  await loadReports();
}

