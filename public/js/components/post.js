/** Карточка промта — основной строительный блок ленты. */

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
import { icon } from '../icons.js';
import { requireAuth } from './auth.js';
import { openComposer } from './composer.js';

export const modelLabel = (id) =>
  state.meta?.models.find((m) => m.id === id)?.label ?? id;

export const difficultyLabel = (id) =>
  state.meta?.difficulties.find((d) => d.id === id)?.label ?? id;

/** Кнопка копирования текста промта. */
function copyButton(post) {
  const label = (name, text) => [icon(name, { size: 15 }), h('span', { text })];
  const button = h(
    'button',
    {
      class: 'copy-btn',
      type: 'button',
      title: 'Скопировать промт в буфер обмена',
      onClick: async (event) => {
        event.stopPropagation();
        const ok = await copyText(post.promptText);
        if (!ok) return toast('Не удалось скопировать промт', 'error');
        button.classList.add('done');
        button.replaceChildren(...label('check', 'Скопировано'));
        toast('Промт скопирован');
        setTimeout(() => {
          button.classList.remove('done');
          button.replaceChildren(...label('copy', 'Копировать промт'));
        }, 1800);
      },
    },
    label('copy', 'Копировать промт'),
  );
  return button;
}

function promptBox(post, { expanded = false } = {}) {
  const box = h('div', { class: 'prompt-box' }, h('pre', { text: post.promptText }));
  const actions = h('div', { class: 'prompt-actions' }, copyButton(post));

  const long = post.promptText.length > 420 || post.promptText.split('\n').length > 8;
  if (long && !expanded) {
    box.classList.add('clamped');
    actions.append(
      h('button', {
        class: 'expand-btn',
        type: 'button',
        text: 'Показать полностью',
        onClick: (event) => {
          event.stopPropagation();
          box.classList.remove('clamped');
          event.target.remove();
        },
      }),
    );
  }
  box.append(actions);
  return box;
}

function badges(post) {
  const items = [
    h(
      'a',
      { class: 'badge-chip model', href: `/?model=${post.modelFamily}`, onClick: stop },
      `${modelLabel(post.modelFamily)}${post.modelVersion ? ` · ${post.modelVersion}` : ''}`,
    ),
    h(
      'a',
      {
        class: `badge-chip level-${post.difficulty}`,
        href: `/?difficulty=${post.difficulty}`,
        onClick: stop,
      },
      difficultyLabel(post.difficulty),
    ),
    ...post.tags.map((tag) =>
      h('a', { class: 'badge-chip tag', href: `/?tag=${encodeURIComponent(tag)}`, onClick: stop, text: tag }),
    ),
  ];
  return h('div', { class: 'badges' }, items);
}

function stop(event) {
  event.stopPropagation();
}

function exampleBlock(post) {
  if (!post.exampleText && !post.exampleImage) return null;
  const details = h(
    'details',
    { class: 'example', onClick: stop },
    h('summary', { text: 'Пример результата' }),
  );
  if (post.exampleText) details.append(h('div', { class: 'example-body', text: post.exampleText }));
  if (post.exampleImage) {
    details.append(h('img', { src: post.exampleImage, alt: 'Пример результата', loading: 'lazy' }));
  }
  return details;
}

/* ------------------------------ Действия ------------------------------ */

async function toggleLike(post, button, countNode) {
  if (!(await requireAuth('Войдите, чтобы ставить лайки'))) return;
  try {
    const result = await api.like(post.id);
    post.viewer.liked = result.liked;
    post.counts = result.counts;
    button.classList.toggle('on', result.liked);
    button.replaceChildren(icon('heart', { size: 17, filled: result.liked }), countNode);
    countNode.textContent = formatCount(result.counts.likes);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function toggleRepost(post, button, countNode) {
  if (!(await requireAuth('Войдите, чтобы делать репосты'))) return;
  try {
    const result = await api.repost(post.id);
    post.viewer.reposted = result.reposted;
    post.counts = result.counts;
    button.classList.toggle('on', result.reposted);
    countNode.textContent = formatCount(result.counts.reposts);
    toast(result.reposted ? 'Промт добавлен в вашу ленту' : 'Репост отменён');
  } catch (error) {
    toast(error.message, 'error');
  }
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
        const chosen = list.querySelector('input:checked')?.value;
        submit.disabled = true;
        try {
          await api.report(post.id, chosen, details.value.trim());
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
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn ghost', text: 'Отмена', onClick: () => close(false) }),
        submit,
      ),
    );
  });

  if (sent) toast('Жалоба отправлена модераторам');
}

async function deletePost(post, card) {
  const ok = await confirmDialog({
    title: 'Удалить промт?',
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

/** Меню поста: редактирование, удаление, жалоба. */
function postMenu(post, card) {
  const mine = state.user && post.author.id === state.user.id;
  return h(
    'button',
    {
      class: 'icon-btn post-menu',
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
                text: 'Скопировать промт',
                onClick: async () => {
                  await copyText(post.promptText);
                  toast('Промт скопирован');
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

  const meta = h(
    'div',
    { class: 'post-meta' },
    h('a', { class: 'name', href: `/u/${post.author.username}`, text: post.author.displayName }),
    post.author.role === 'admin' ? h('span', { class: 'admin-tag', text: 'админ' }) : null,
    h('span', { class: 'handle', text: `@${post.author.username}` }),
    h('span', { class: 'dot', text: '·' }),
    timeEl(post.createdAt),
    postMenu(post, card),
  );

  const likeCount = h('span', { text: formatCount(post.counts.likes) });
  const likeBtn = h(
    'button',
    { class: `action like${post.viewer.liked ? ' on' : ''}`, title: 'Нравится' },
    icon('heart', { size: 17, filled: post.viewer.liked }),
    likeCount,
  );
  likeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleLike(post, likeBtn, likeCount);
  });

  const repostCount = h('span', { text: formatCount(post.counts.reposts) });
  const repostBtn = h(
    'button',
    { class: `action repost${post.viewer.reposted ? ' on' : ''}`, title: 'Репост' },
    icon('repost', { size: 17 }),
    repostCount,
  );
  repostBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleRepost(post, repostBtn, repostCount);
  });

  const commentBtn = h(
    'button',
    { class: 'action comment', title: 'Комментарии' },
    icon('comment', { size: 17 }),
    h('span', { text: formatCount(post.counts.comments) }),
  );
  commentBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    navigate(`/post/${post.id}`);
  });

  const mine = state.user && post.author.id === state.user.id;
  const reportBtn = h(
    'button',
    { class: 'action report', title: 'Пожаловаться' },
    icon('flag', { size: 17 }),
  );
  reportBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    openReport(post);
  });

  const actions = h(
    'div',
    { class: 'actions' },
    commentBtn,
    repostBtn,
    likeBtn,
    mine
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
      : reportBtn,
  );

  const body = h(
    'div',
    { class: 'post-body' },
    meta,
    post.description ? h('div', { class: 'post-desc', text: post.description }) : null,
    promptBox(post, { expanded: detail }),
    badges(post),
    exampleBlock(post),
    actions,
  );

  card.append(h('div', { class: 'post-head' }, avatar(post.author, 'md'), body));
  return card;
}

/** Список карточек с поддержкой бесконечной прокрутки. */
export function feedList({ load, emptyIcon = '🗒', emptyTitle = 'Пока пусто', emptyText = '' }) {
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
    const loader = spinner(first ? 'Загружаем промты…' : 'Загружаем ещё…');
    sentinel.replaceChildren(loader);
    try {
      const data = await load(page);
      const items = data.items ?? [];
      for (const item of items) {
        container.append(postCard(item.post, { repostedBy: item.repostedBy }));
      }
      if (first && !items.length) {
        container.append(emptyState(emptyIcon, emptyTitle, emptyText));
      }
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
  wrapper.prepend = (post) => {
    const emptyBlock = container.querySelector('.empty');
    emptyBlock?.remove();
    container.prepend(postCard(post));
  };

  loadMore();
  return wrapper;
}

export { emptyState };
