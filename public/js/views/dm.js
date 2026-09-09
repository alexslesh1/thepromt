/**
 * Личные сообщения (Direct Messages) между пользователями — не «Сообщения»
 * (это внутренние уведомления платформы, views/messages.js). Список
 * диалогов + переписка в реальном времени через WebSocket (ws.js).
 */

import { api } from '../api.js';
import { refreshBadges, state } from '../state.js';
import { navigate } from '../router.js';
import { avatar, emptyState, h, spinner, timeEl, toast } from '../dom.js';
import { icon } from '../icons.js';
import { openAuth } from '../components/auth.js';
import { header, mountMobileTop, shell } from '../components/shell.js';
import { onWsMessage } from '../ws.js';

function loginGate(main, subtitle) {
  main.append(
    header({ title: 'Личные сообщения', subtitle }),
    h(
      'div',
      { class: 'empty' },
      h('div', { class: 'big' }, icon('feather', { size: 26 })),
      h('h3', { text: 'Нужен вход' }),
      h('p', { text: 'Войдите, чтобы писать и получать личные сообщения.' }),
      h('button', {
        class: 'btn',
        style: { marginTop: '14px' },
        text: 'Войти',
        onClick: async () => {
          if (await openAuth()) dmListView();
        },
      }),
    ),
  );
}

/** Список диалогов: /dm */
export async function dmListView() {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  if (!state.user) {
    loginGate(main, 'Переписка с другими авторами');
    return;
  }

  main.append(header({ title: 'Личные сообщения', subtitle: 'Переписка с другими авторами', pill: { icon: 'feather', label: 'Диалоги' } }));

  const list = h('div', { style: { marginTop: '14px' } }, spinner('Загружаем диалоги…'));
  main.append(list);

  const stop = onWsMessage((payload) => {
    if (payload.type === 'dm:new') load();
  });
  const cleanupOnLeave = () => stop();
  window.addEventListener('popstate', cleanupOnLeave, { once: true });

  async function load() {
    try {
      const { items } = await api.dmConversations();
      if (!items.length) {
        list.replaceChildren(
          emptyState('feather', 'Пока нет диалогов', 'Откройте профиль автора и напишите первым.'),
        );
        return;
      }
      list.replaceChildren(
        ...items.map(({ user, lastMessage, unread }) =>
          h(
            'div',
            { class: `notif${unread ? ' unread' : ''}`, onClick: () => navigate(`/dm/${user.username}`) },
            avatar(user, 'md', { link: false }),
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { class: 'title', text: user.displayName }),
              h('div', { class: 'body', text: lastMessage ? `${lastMessage.mine ? 'Вы: ' : ''}${lastMessage.body}` : '' }),
              lastMessage ? timeEl(lastMessage.createdAt) : null,
            ),
            unread ? h('span', { class: 'dm-unread', text: unread > 99 ? '99+' : String(unread) }) : null,
          ),
        ),
      );
    } catch (error) {
      list.replaceChildren(emptyState('warn', 'Не удалось загрузить', error.message));
    }
  }

  await load();
}

/** Переписка с конкретным пользователем: /dm/:username */
export async function dmThreadView({ params }) {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  if (!state.user) {
    loginGate(main, `@${params.username}`);
    return;
  }

  if (params.username === state.user.username) {
    main.append(
      header({ title: 'Личные сообщения', back: true }),
      emptyState('feather', 'Нельзя написать самому себе', ''),
    );
    return;
  }

  main.append(header({ title: 'Переписка', subtitle: `@${params.username}`, back: true }));

  const feed = h('div', { class: 'dm-feed' }, spinner('Загружаем переписку…'));
  const error = h('p', { class: 'error-text', style: { display: 'none' } });
  const input = h('textarea', { class: 'textarea dm-input', rows: 1, placeholder: 'Написать сообщение…', maxlength: 2000 });
  const send = h('button', { class: 'btn', type: 'submit' }, icon('send', { size: 15 }));
  const form = h(
    'form',
    {
      class: 'comment-form',
      onSubmit: async (event) => {
        event.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        send.disabled = true;
        try {
          const { message } = await api.sendDm(params.username, body);
          input.value = '';
          appendMessage(message);
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          send.disabled = false;
        }
      },
    },
    h('div', { class: 'grow' }, input),
    send,
  );

  main.append(feed, error, form);

  function bubble(message) {
    return h(
      'div',
      { class: `dm-bubble${message.mine ? ' mine' : ''}` },
      h('div', { class: 'dm-bubble-text', text: message.body }),
      timeEl(message.createdAt),
    );
  }

  function appendMessage(message) {
    feed.querySelector('.empty')?.remove();
    feed.append(bubble(message));
    feed.scrollTop = feed.scrollHeight;
  }

  const stop = onWsMessage((payload) => {
    if (payload.type !== 'dm:new') return;
    if (payload.from?.username !== params.username) return;
    appendMessage(payload.message);
    api.dmThread(params.username).catch(() => {});
    refreshBadges();
  });
  window.addEventListener('popstate', () => stop(), { once: true });

  try {
    const { items } = await api.dmThread(params.username);
    refreshBadges();
    if (!items.length) {
      feed.replaceChildren(emptyState('feather', 'Пока нет сообщений', 'Напишите первое сообщение ниже.'));
    } else {
      feed.replaceChildren(...items.map(bubble));
      feed.scrollTop = feed.scrollHeight;
    }
  } catch (err) {
    feed.replaceChildren(emptyState('warn', 'Не удалось загрузить', err.message));
  }

  input.focus();
}
