/** Страница поста: сам промпт и тред обсуждения. */

import { api } from '../api.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { autoGrow, avatar, confirmDialog, emptyState, h, spinner, timeEl, toast } from '../dom.js';
import { icon } from '../icons.js';
import { postCard } from '../components/post.js';
import { requireAuth } from '../components/auth.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

/** Один комментарий с вложенными ответами. */
function commentNode(comment, { postId, onChanged }) {
  const box = h('div', { class: `comment${comment.deleted ? ' deleted' : ''}` });

  const replyBox = h('div', { style: { display: 'none' } });

  const toggleReply = async () => {
    if (!(await requireAuth('Войдите, чтобы отвечать'))) return;
    if (replyBox.style.display === 'none') {
      replyBox.style.display = 'block';
      replyBox.replaceChildren(commentForm({ postId, parentId: comment.id, onChanged, compact: true }));
      replyBox.querySelector('textarea')?.focus();
    } else {
      replyBox.style.display = 'none';
      replyBox.replaceChildren();
    }
  };

  const removeComment = async () => {
    const ok = await confirmDialog({
      title: 'Удалить комментарий?',
      message: 'Текст будет скрыт из обсуждения.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await api.deleteComment(comment.id);
      onChanged(result.comments);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const actions = h(
    'div',
    { class: 'actions', style: { maxWidth: '260px', marginTop: '2px' } },
    h(
      'button',
      { class: 'action', onClick: toggleReply },
      icon('comment', { size: 15 }),
      h('span', { text: 'Ответить' }),
    ),
    comment.canDelete && !comment.deleted
      ? h(
          'button',
          { class: 'action delete', title: 'Удалить комментарий', onClick: removeComment },
          icon('trash', { size: 15 }),
        )
      : null,
  );

  box.append(
    avatar(comment.author, 'sm'),
    h(
      'div',
      { class: 'body' },
      h(
        'div',
        { class: 'post-meta' },
        h('a', { class: 'name', href: `/u/${comment.author.username}`, text: comment.author.displayName }),
        comment.author.role === 'admin' ? h('span', { class: 'admin-tag', text: 'админ' }) : null,
        h('span', { class: 'handle', text: `@${comment.author.username}` }),
        h('span', { class: 'dot', text: '·' }),
        timeEl(comment.createdAt),
      ),
      h('div', { class: 'text', text: comment.body }),
      comment.deleted ? null : actions,
      replyBox,
    ),
  );

  const wrapper = h('div', {}, box);
  if (comment.replies.length) {
    wrapper.append(
      h(
        'div',
        { class: 'comment-replies' },
        comment.replies.map((reply) => commentNode(reply, { postId, onChanged })),
      ),
    );
  }
  return wrapper;
}

/** Форма нового комментария или ответа. */
function commentForm({ postId, parentId = null, onChanged, compact = false }) {
  const textarea = h('textarea', {
    class: 'textarea',
    rows: compact ? 2 : 3,
    maxlength: state.meta?.limits?.comment ?? 1000,
    placeholder: parentId ? 'Ваш ответ…' : 'Что думаете об этом промпте?',
  });

  const submit = h('button', { class: 'btn small', text: parentId ? 'Ответить' : 'Отправить', type: 'submit' });

  const form = h(
    'form',
    {
      class: 'grow',
      onSubmit: async (event) => {
        event.preventDefault();
        const body = textarea.value.trim();
        if (!body) return;
        if (!(await requireAuth('Войдите, чтобы комментировать'))) return;
        submit.disabled = true;
        try {
          const result = await api.comment(postId, body, parentId);
          textarea.value = '';
          onChanged(result.comments, result.counts);
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          submit.disabled = false;
        }
      },
    },
    textarea,
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' } }, submit),
  );

  autoGrow(textarea, 200);

  if (compact) return form;
  return h('div', { class: 'comment-form' }, avatar(state.user, 'md', { link: false }), form);
}

export async function postView({ params }) {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);
  main.append(header({ title: 'Промпт', back: true }));

  const body = h('div', { style: { marginTop: '18px' } }, spinner('Загружаем промпт…'));
  main.append(body);

  let data;
  try {
    data = await api.post(params.id);
  } catch (error) {
    body.replaceChildren(
      emptyState('search', 'Пост не найден', error.message),
      h(
        'div',
        { style: { textAlign: 'center', paddingBottom: '24px' } },
        h('button', { class: 'btn ghost', text: 'На главную', onClick: () => navigate('/') }),
      ),
    );
    return;
  }

  const commentsBox = h('div', {});
  const renderComments = (comments) => {
    commentsBox.replaceChildren(
      ...(comments.length
        ? comments.map((comment) =>
            commentNode(comment, { postId: data.post.id, onChanged: renderComments }),
          )
        : [emptyState('comment', 'Комментариев пока нет', 'Станьте первым, кто обсудит этот промпт.')]),
    );
  };

  body.replaceChildren(
    postCard(data.post, { detail: true }),
    commentForm({ postId: data.post.id, onChanged: renderComments }),
    commentsBox,
  );
  renderComments(data.comments);
}
