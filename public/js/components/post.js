/** Карточка промпта — основной строительный блок ленты. */

import { api } from '../api.js';
import { isAdmin, state } from '../state.js';
import { navigate } from '../router.js';
import {
  avatar,
  confirmDialog,
  copyText,
  emptyState,
  formatCount,
  frag,
  h,
  modal,
  spinner,
  timeEl,
  toast,
} from '../dom.js';
import { icon, modelTile, proBadge } from '../icons.js';
import { requireAuth } from './auth.js';
import { openComposer } from './composer.js';

export const modelInfo = (id) =>
  state.meta?.models.find((m) => m.id === id) ?? { id, label: id, short: id, color: '#8a8a8a', glyph: 'circle' };

export const modelLabel = (id) => modelInfo(id).label;

export const difficultyLabel = (id) => state.meta?.difficulties.find((d) => d.id === id)?.label ?? id;

export const categoryLabel = (id) => state.meta?.categories.find((c) => c.id === id)?.label ?? id;

const stop = (event) => event.stopPropagation();

/* ------------------------------ Промпт --------------------------------- */

function promptBox(post, { expanded = false } = {}) {
  const box = h('div', { class: 'prompt-box' }, h('pre', { text: post.promptText }));

  const copy = h(
    'button',
    {
      class: 'prompt-copy',
      type: 'button',
      title: 'Копировать промпт',
      'aria-label': 'Копировать промпт',
      onClick: async (event) => {
        event.stopPropagation();
        const ok = await copyText(post.promptText);
        if (!ok) return toast('Не удалось скопировать промпт', 'error');
        copy.classList.add('done');
        copy.replaceChildren(icon('check', { size: 15 }));
        toast('Промпт скопирован');
        setTimeout(() => {
          copy.classList.remove('done');
          copy.replaceChildren(icon('copy', { size: 15 }));
        }, 1800);
      },
    },
    icon('copy', { size: 15 }),
  );
  box.append(copy);

  const long = post.promptText.length > 300 || post.promptText.split('\n').length > 6;
  if (long && !expanded) {
    box.classList.add('clamped');
    box.append(
      h(
        'div',
        { class: 'prompt-actions' },
        h('button', {
          class: 'expand-btn',
          type: 'button',
          text: 'Показать полностью',
          onClick: (event) => {
            event.stopPropagation();
            box.classList.remove('clamped');
            event.target.closest('.prompt-actions').remove();
          },
        }),
      ),
    );
  }
  return box;
}

function exampleBlock(post) {
  if (!post.exampleText && !post.exampleImage) return null;
  const details = h('details', { class: 'example', onClick: stop }, h('summary', { text: 'Пример результата' }));
  if (post.exampleText) details.append(h('div', { class: 'example-body', text: post.exampleText }));
  if (post.exampleImage) details.append(h('img', { src: post.exampleImage, alt: 'Пример результата', loading: 'lazy' }));
  return details;
}

/* ------------------------------- Опрос --------------------------------- */

function pollBlock(post) {
  if (!post.poll) return null;
  const box = h('div', { class: 'poll' });

  const render = (poll) => {
    const voted = poll.votedOptionId !== null;
    box.replaceChildren(
      h('div', { class: 'q', text: poll.question }),
      ...poll.options.map((option) => {
        const share = poll.totalVotes ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
        const row = h(
          'button',
          {
            type: 'button',
            class: `poll-option${poll.votedOptionId === option.id ? ' voted' : ''}`,
            onClick: async (event) => {
              event.stopPropagation();
              if (!(await requireAuth('Войдите, чтобы голосовать'))) return;
              try {
                const result = await api.vote(post.id, option.id);
                post.poll = result.poll;
                render(result.poll);
              } catch (error) {
                toast(error.message, 'error');
              }
            },
          },
          h('span', { class: 'fill', style: { width: voted ? `${share}%` : '0%' } }),
          h('span', { class: 'text', text: option.text }),
          voted ? h('span', { class: 'pct', text: `${share}%` }) : null,
        );
        return row;
      }),
      h('div', {
        class: 'total',
        text: poll.totalVotes
          ? `${poll.totalVotes} ${plural(poll.totalVotes, 'голос', 'голоса', 'голосов')}`
          : 'Голосов пока нет',
      }),
    );
  };

  render(post.poll);
  return box;
}

const plural = (n, one, few, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

/* ------------------------------ Действия ------------------------------- */

/** Общая логика кнопок «лайк / репост / сохранить». */
function toggleAction({ post, button, countNode, call, field, iconName, filledWhenOn = false, messages = {} }) {
  return async (event) => {
    event.stopPropagation();
    if (!(await requireAuth(messages.auth ?? 'Для этого действия нужен вход'))) return;
    try {
      const result = await call(post.id);
      const on = result[field];
      post.viewer[field] = on;
      post.counts = result.counts;
      button.classList.toggle('on', on);
      button.replaceChildren(icon(iconName, { size: 17, filled: filledWhenOn && on }), countNode);
      countNode.textContent = formatCount(result.counts[messages.countKey]);
      if (messages.on && messages.off) toast(on ? messages.on : messages.off);
    } catch (error) {
      toast(error.message, 'error');
    }
  };
}

/** Модалка жалобы: выбор причины и комментарий. */
export async function openReport(post) {
  if (!(await requireAuth('Войдите, чтобы отправить жалобу'))) return;
  const reasons = state.meta?.reportReasons ?? [];

  const sent = await modal((close) => {
    const error = h('p', { class: 'error-text', style: { display: 'none' } });
    const details = h('textarea', {
      class: 'textarea',
      rows: 3,
      maxlength: 500,
      placeholder: 'Что не так с этим постом? (необязательно)',
    });
    const list = h(
      'div',
      { class: 'radio-list' },
      reasons.map((reason, index) =>
        h(
          'label',
          { class: 'radio-row' },
          h('input', { type: 'radio', name: 'reason', value: reason.id, checked: index === 0 }),
          h('span', { text: reason.label }),
        ),
      ),
    );
    const submit = h('button', {
      class: 'btn danger',
      text: 'Отправить жалобу',
      onClick: async () => {
        submit.disabled = true;
        try {
          await api.report(post.id, list.querySelector('input:checked')?.value, details.value.trim());
          close(true);
        } catch (err) {
          error.textContent = err.message;
          error.style.display = 'block';
          submit.disabled = false;
        }
      },
    });

    return frag(
      h('div', { class: 'modal-head' }, h('h2', { text: 'Пожаловаться на пост' })),
      h('p', { class: 'lead', text: 'Расскажите, что не так. Жалобу увидят модераторы.' }),
      list,
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Комментарий' }), details),
      error,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', text: 'Отмена', onClick: () => close(false) }), submit),
    );
  });

  if (sent) toast('Жалоба отправлена модераторам');
}

async function deletePost(post, card) {
  const ok = await confirmDialog({
    title: 'Удалить промпт?',
    message: 'Пост исчезнет из ленты и профиля. Это действие нельзя отменить из интерфейса.',
    confirmText: 'Удалить',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deletePost(post.id);
    toast('Пост удалён');
    card?.remove();
    if (location.pathname === `/post/${post.id}`) navigate('/');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/** Меню поста: копирование, редактирование, удаление, жалоба. */
function postMenu(post, card) {
  const mine = state.user && post.author.id === state.user.id;
  return h(
    'button',
    {
      class: 'icon-btn',
      title: 'Ещё',
      'aria-label': 'Действия с постом',
      onClick: async (event) => {
        event.stopPropagation();
        await modal((close) =>
          frag(
            h('div', { class: 'modal-head' }, h('h2', { text: 'Действия' })),
            h(
              'div',
              { class: 'radio-list' },
              h('button', {
                class: 'btn subtle',
                text: 'Скопировать промпт',
                onClick: async () => {
                  await copyText(post.promptText);
                  toast('Промпт скопирован');
                  close();
                },
              }),
              h('button', {
                class: 'btn subtle',
                text: 'Скопировать ссылку',
                onClick: async () => {
                  await copyText(`${location.origin}/post/${post.id}`);
                  toast('Ссылка скопирована');
                  close();
                },
              }),
              mine
                ? h('button', {
                    class: 'btn subtle',
                    text: 'Редактировать',
                    onClick: () => {
                      close();
                      openComposer({ post });
                    },
                  })
                : null,
              mine || isAdmin()
                ? h('button', {
                    class: 'btn danger',
                    text: 'Удалить пост',
                    onClick: () => {
                      close();
                      deletePost(post, card);
                    },
                  })
                : null,
              !mine
                ? h('button', {
                    class: 'btn warn',
                    text: 'Пожаловаться',
                    onClick: () => {
                      close();
                      openReport(post);
                    },
                  })
                : null,
              h('button', { class: 'btn ghost', text: 'Закрыть', onClick: () => close() }),
            ),
          ),
        );
      },
    },
    icon('more', { size: 18, filled: true }),
  );
}

/**
 * Рисует карточку поста.
 * @param {object} post
 * @param {{repostedBy?: object, detail?: boolean}} options
 */
export function postCard(post, options = {}) {
  const { repostedBy = null, detail = false } = options;
  const model = modelInfo(post.modelFamily);

  const card = h('article', {
    class: `post${detail ? ' detail' : ''}`,
    onClick: detail
      ? null
      : (event) => {
          if (event.target.closest('a, button, details, summary, pre, input, textarea')) return;
          navigate(`/post/${post.id}`);
        },
  });

  if (repostedBy) {
    card.append(
      h(
        'div',
        { class: 'repost-label' },
        icon('repost', { size: 15 }),
        h('a', { href: `/u/${repostedBy.username}`, text: `${repostedBy.displayName} сделал(а) репост` }),
      ),
    );
  }

  /* ------------------------------ Шапка ------------------------------ */

  card.append(
    h(
      'div',
      { class: 'post-head' },
      avatar(post.author, 'md'),
      h(
        'div',
        { class: 'who' },
        h(
          'div',
          { class: 'post-meta' },
          h('a', { class: 'name', href: `/u/${post.author.username}`, text: post.author.displayName }),
          post.author.role === 'admin' ? h('span', { class: 'admin-tag', text: 'админ' }) : null,
          post.author.isPro ? proBadge(15) : null,
          h('span', { class: 'handle', text: `@${post.author.username}` }),
          h('span', { class: 'dot', text: '·' }),
          timeEl(post.createdAt),
        ),
      ),
      h(
        'div',
        { class: 'post-head-right' },
        h(
          'a',
          { class: 'model-badge', href: `/?model=${post.modelFamily}`, onClick: stop, title: model.label },
          modelTile(model),
          h('span', { text: model.short ?? model.label }),
        ),
        h('span', { class: `level-pill ${post.difficulty}`, text: difficultyLabel(post.difficulty) }),
        postMenu(post, card),
      ),
    ),
  );

  /* ---------------------------- Содержимое --------------------------- */

  if (post.title) card.append(h('h2', { class: 'post-title', text: post.title }));
  if (post.description) card.append(h('p', { class: 'post-desc', text: post.description }));

  card.append(promptBox(post, { expanded: detail }));

  const tags = h('div', { class: 'tag-row' });
  if (post.modelVersion) {
    tags.append(h('span', { class: 'chip static', text: post.modelVersion }));
  }
  tags.append(
    h('a', { class: 'chip', href: `/?category=${post.category}`, onClick: stop, text: categoryLabel(post.category) }),
    ...post.tags.map((tag) =>
      h('a', { class: 'chip', href: `/?tag=${encodeURIComponent(tag)}`, onClick: stop, text: `#${tag}` }),
    ),
  );
  card.append(tags);

  const example = exampleBlock(post);
  if (example) card.append(example);
  const poll = pollBlock(post);
  if (poll) card.append(poll);

  /* ------------------------- Панель действий ------------------------- */

  const likeCount = h('span', { text: formatCount(post.counts.likes) });
  const likeBtn = h(
    'button',
    { class: `action like${post.viewer.liked ? ' on' : ''}`, title: 'Нравится' },
    icon('heart', { size: 17, filled: post.viewer.liked }),
    likeCount,
  );
  likeBtn.addEventListener(
    'click',
    toggleAction({
      post,
      button: likeBtn,
      countNode: likeCount,
      call: api.like,
      field: 'liked',
      iconName: 'heart',
      filledWhenOn: true,
      messages: { auth: 'Войдите, чтобы ставить лайки', countKey: 'likes' },
    }),
  );

  const commentCount = h('span', { text: formatCount(post.counts.comments) });
  const commentBtn = h(
    'button',
    { class: 'action comment', title: 'Комментарии' },
    icon('comment', { size: 17 }),
    commentCount,
  );
  commentBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    navigate(`/post/${post.id}`);
  });

  const repostCount = h('span', { text: formatCount(post.counts.reposts) });
  const repostBtn = h(
    'button',
    { class: `action repost${post.viewer.reposted ? ' on' : ''}`, title: 'Репост' },
    icon('repost', { size: 17 }),
    repostCount,
  );
  repostBtn.addEventListener(
    'click',
    toggleAction({
      post,
      button: repostBtn,
      countNode: repostCount,
      call: api.repost,
      field: 'reposted',
      iconName: 'repost',
      messages: {
        auth: 'Войдите, чтобы делать репосты',
        countKey: 'reposts',
        on: 'Промпт добавлен в вашу ленту',
        off: 'Репост отменён',
      },
    }),
  );

  const saveCount = h('span', { text: formatCount(post.counts.bookmarks) });
  const saveBtn = h(
    'button',
    { class: `action save${post.viewer.bookmarked ? ' on' : ''}`, title: 'Сохранить' },
    icon('bookmark', { size: 17, filled: post.viewer.bookmarked }),
    saveCount,
  );
  saveBtn.addEventListener(
    'click',
    toggleAction({
      post,
      button: saveBtn,
      countNode: saveCount,
      call: api.bookmark,
      field: 'bookmarked',
      iconName: 'bookmark',
      filledWhenOn: true,
      messages: {
        auth: 'Войдите, чтобы сохранять промпты',
        countKey: 'bookmarks',
        on: 'Промпт сохранён',
        off: 'Убрано из сохранённого',
      },
    }),
  );

  const mine = state.user && post.author.id === state.user.id;
  const lastBtn = mine
    ? h(
        'button',
        {
          class: 'action delete',
          title: 'Удалить',
          onClick: (event) => {
            event.stopPropagation();
            deletePost(post, card);
          },
        },
        icon('trash', { size: 17 }),
      )
    : h(
        'button',
        {
          class: 'action report',
          title: 'Пожаловаться',
          onClick: (event) => {
            event.stopPropagation();
            openReport(post);
          },
        },
        icon('flag', { size: 17 }),
      );

  card.append(
    h('div', { class: 'actions' }, likeBtn, commentBtn, repostBtn, saveBtn, h('span', { class: 'spacer' }), lastBtn),
  );

  return card;
}

/** Список карточек с бесконечной прокруткой. */
export function feedList({ load, emptyIcon = 'sparkles', emptyTitle = 'Пока пусто', emptyText = '' }) {
  const container = h('div', { class: 'feed' });
  const sentinel = h('div');
  const wrapper = h('div', {}, container, sentinel);

  let page = 1;
  let loading = false;
  let done = false;
  let first = true;

  async function loadMore() {
    if (loading || done) return;
    loading = true;
    sentinel.replaceChildren(spinner(first ? 'Загружаем промпты…' : 'Загружаем ещё…'));
    try {
      const data = await load(page);
      const items = data.items ?? [];
      for (const item of items) container.append(postCard(item.post, { repostedBy: item.repostedBy }));
      if (first && !items.length) container.append(emptyState(emptyIcon, emptyTitle, emptyText));
      first = false;
      page += 1;
      done = !data.hasMore;
      sentinel.replaceChildren();
    } catch (error) {
      if (error.name === 'AbortError') return;
      sentinel.replaceChildren(
        h(
          'div',
          { class: 'empty' },
          h('p', { text: error.message }),
          h('button', {
            class: 'btn ghost',
            text: 'Повторить',
            onClick: () => {
              loading = false;
              done = false;
              loadMore();
            },
          }),
        ),
      );
      done = true;
    } finally {
      loading = false;
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    },
    { rootMargin: '600px' },
  );
  observer.observe(sentinel);

  wrapper.dispose = () => observer.disconnect();
  wrapper.reload = () => {
    page = 1;
    done = false;
    first = true;
    container.replaceChildren();
    loadMore();
  };

  loadMore();
  return wrapper;
}

export { emptyState };
