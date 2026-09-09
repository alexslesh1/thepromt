/** Форма публикации промпта — в ленте и в модальном окне. */

import { api } from '../api.js';
import { state } from '../state.js';
import { autoGrow, avatar, charCounter, frag, h, modal, toast } from '../dom.js';
import { icon } from '../icons.js';
import { requireAuth } from './auth.js';

/** Обёртка для select с иконкой-стрелкой. */
export function selectWrap(select) {
  return h('span', { class: 'select-wrap' }, select, icon('chevronDown', { size: 15, class: 'chev' }));
}

/**
 * Собирает форму промпта.
 * @param {{post?: object, draft?: object, onDone: Function, onCancel?: Function}} options
 */
export function composerForm({ post = null, draft = null, onDone, onCancel = null }) {
  const meta = state.meta;
  const limits = meta?.limits ?? { promptText: 8000, description: 400, exampleText: 4000, title: 120 };
  const editing = !!post;
  const source = post ?? draft ?? {};

  /* --------------------------- Поля формы --------------------------- */

  const title = h('input', {
    class: 'input',
    placeholder: 'Заголовок — коротко о промпте',
    maxlength: limits.title,
    value: source.title ?? '',
  });

  const promptText = h('textarea', {
    class: 'textarea mono',
    rows: 6,
    placeholder: 'Текст промпта, который можно скопировать и использовать…',
    value: source.promptText ?? '',
    required: true,
  });

  const modelSelect = h(
    'select',
    { class: 'select' },
    h('option', { value: '', text: 'Выберите модель ИИ' }),
    (meta?.models ?? []).map((model) =>
      h('option', { value: model.id, text: model.label, selected: source.modelFamily === model.id }),
    ),
  );

  const versionList = h('datalist', { id: 'model-versions' });
  const versionInput = h('input', {
    class: 'input',
    list: 'model-versions',
    placeholder: 'Например, GPT-5.1 или Midjourney v6.1',
    maxlength: 60,
    value: source.modelVersion ?? '',
  });

  const syncVersions = () => {
    const model = (meta?.models ?? []).find((m) => m.id === modelSelect.value);
    versionList.replaceChildren(...(model?.versions ?? []).map((version) => h('option', { value: version })));
  };
  modelSelect.addEventListener('change', syncVersions);
  syncVersions();

  const difficultySelect = h(
    'select',
    { class: 'select' },
    (meta?.difficulties ?? []).map((level) =>
      h('option', { value: level.id, text: level.label, selected: (source.difficulty ?? 'beginner') === level.id }),
    ),
  );

  const categorySelect = h(
    'select',
    { class: 'select' },
    (meta?.categories ?? []).map((category) =>
      h('option', {
        value: category.id,
        text: category.label,
        selected: (source.category ?? 'other') === category.id,
      }),
    ),
  );

  const description = h('input', {
    class: 'input',
    placeholder: 'Для чего этот промпт?',
    maxlength: limits.description,
    value: source.description ?? '',
  });

  const tagsInput = h('input', {
    class: 'input',
    placeholder: 'киберпанк, город, ии-арт',
    value: (source.tags ?? []).join(', '),
  });

  const tagSuggestions = h(
    'div',
    { class: 'tag-row' },
    (meta?.suggestedTags ?? []).slice(0, 10).map((tag) =>
      h('button', {
        type: 'button',
        class: 'chip',
        text: `#${tag}`,
        onClick: () => {
          const current = tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean);
          if (current.includes(tag)) return;
          current.push(tag);
          tagsInput.value = current.join(', ');
        },
      }),
    ),
  );

  const exampleText = h('textarea', {
    class: 'textarea',
    rows: 3,
    placeholder: 'Что получилось после запуска промпта (необязательно)',
    maxlength: limits.exampleText,
    value: source.exampleText ?? '',
  });

  /* --------------------------- Изображение -------------------------- */

  let exampleImage = source.exampleImage ?? null;
  const preview = h('div', { class: 'attach-preview', style: { display: 'none' } });
  const renderPreview = () => {
    if (!exampleImage) {
      preview.style.display = 'none';
      preview.replaceChildren();
      imageBtn.classList.remove('on');
      return;
    }
    preview.style.display = 'block';
    imageBtn.classList.add('on');
    preview.replaceChildren(
      h('img', { src: exampleImage, alt: 'Пример результата' }),
      h(
        'button',
        {
          type: 'button',
          class: 'remove',
          title: 'Убрать изображение',
          onClick: () => {
            exampleImage = null;
            renderPreview();
          },
        },
        icon('close', { size: 15 }),
      ),
    );
  };

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/gif',
    style: { display: 'none' },
    onChange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const uploaded = await api.upload(file);
        exampleImage = uploaded.url;
        renderPreview();
      } catch (error) {
        toast(error.message, 'error');
      }
    },
  });

  /* ------------------------------ Опрос ----------------------------- */

  const pollQuestion = h('input', {
    class: 'input',
    placeholder: 'Вопрос к сообществу',
    maxlength: limits.pollQuestion ?? 140,
    value: source.poll?.question ?? '',
  });
  const pollOptionsBox = h('div', {});
  const pollEditor = h(
    'div',
    { class: 'poll-editor', style: { display: 'none' } },
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Вопрос опроса' }), pollQuestion),
    h('span', { class: 'label', style: { display: 'block', marginBottom: '7px', fontSize: '12.5px', color: 'var(--text-muted)' }, text: 'Варианты ответа' }),
    pollOptionsBox,
  );

  const addOptionRow = (value = '') => {
    const max = limits.pollOptions ?? 4;
    if (pollOptionsBox.children.length >= max) return;
    const input = h('input', {
      class: 'input',
      placeholder: `Вариант ${pollOptionsBox.children.length + 1}`,
      maxlength: limits.pollOption ?? 60,
      value,
    });
    const row = h(
      'div',
      { class: 'opt-row' },
      input,
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          title: 'Убрать вариант',
          onClick: () => {
            if (pollOptionsBox.children.length <= 2) return toast('Нужно минимум два варианта');
            row.remove();
          },
        },
        icon('close', { size: 16 }),
      ),
    );
    pollOptionsBox.append(row);
  };

  const initialOptions = source.poll?.options?.map((o) => o.text ?? o) ?? [];
  addOptionRow(initialOptions[0] ?? '');
  addOptionRow(initialOptions[1] ?? '');
  for (const extra of initialOptions.slice(2)) addOptionRow(extra);

  pollEditor.append(
    h(
      'button',
      {
        type: 'button',
        class: 'quick-btn',
        style: { marginTop: '4px' },
        onClick: () => addOptionRow(),
      },
      icon('plus', { size: 15 }),
      h('span', { text: 'Добавить вариант' }),
    ),
  );

  let pollOn = !!source.poll?.question;
  const togglePoll = () => {
    pollOn = !pollOn;
    pollEditor.style.display = pollOn ? 'block' : 'none';
    pollBtn.classList.toggle('on', pollOn);
    if (pollOn) pollQuestion.focus();
  };

  /* -------------------------- Быстрые кнопки ------------------------ */

  const quickBtn = (iconName, label, onClick) =>
    h('button', { type: 'button', class: 'quick-btn', onClick }, icon(iconName, { size: 15 }), h('span', { text: label }));

  const imageBtn = quickBtn('image', 'Изображение', () => fileInput.click());
  const modelBtn = quickBtn('sparkles', 'Модель', () => {
    modelSelect.focus();
    modelSelect.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  const tagsBtn = quickBtn('bookmark', 'Теги', () => {
    tagsInput.focus();
    tagsInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  const pollBtn = quickBtn('poll', 'Опрос', togglePoll);

  if (pollOn) {
    pollEditor.style.display = 'block';
    pollBtn.classList.add('on');
  }
  renderPreview();

  /* ----------------------------- Отправка --------------------------- */

  const error = h('p', { class: 'error-text', style: { display: 'none' } });
  const submit = h(
    'button',
    { class: 'btn', type: 'submit' },
    icon(editing ? 'check' : 'send', { size: 16 }),
    h('span', { text: editing ? 'Сохранить' : 'Опубликовать' }),
  );

  const collectPoll = () => {
    if (!pollOn) return { question: '', options: [] };
    return {
      question: pollQuestion.value,
      options: [...pollOptionsBox.querySelectorAll('input')].map((input) => input.value),
    };
  };

  const form = h(
    'form',
    {
      onSubmit: async (event) => {
        event.preventDefault();
        error.style.display = 'none';
        submit.disabled = true;
        const payload = {
          title: title.value,
          promptText: promptText.value,
          modelFamily: modelSelect.value,
          modelVersion: versionInput.value,
          difficulty: difficultySelect.value,
          category: categorySelect.value,
          description: description.value,
          exampleText: exampleText.value,
          exampleImage,
          tags: tagsInput.value,
          poll: collectPoll(),
        };
        try {
          const result = editing ? await api.updatePost(post.id, payload) : await api.createPost(payload);
          toast(editing ? 'Промпт обновлён' : 'Промпт опубликован');
          onDone?.(result.post);
        } catch (err) {
          error.textContent = err.message;
          error.style.display = 'block';
        } finally {
          submit.disabled = false;
        }
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Заголовок' }), title),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Промпт' }), promptText),
    charCounter(promptText, limits.promptText),
    h(
      'div',
      { class: 'row' },
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Модель ИИ' }), selectWrap(modelSelect)),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Версия модели' }), versionInput, versionList),
    ),
    h(
      'div',
      { class: 'row' },
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Уровень' }), selectWrap(difficultySelect)),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Категория' }), selectWrap(categorySelect)),
    ),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Короткое описание' }), description),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Теги (до 6, через запятую)' }), tagsInput, tagSuggestions),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Пример результата' }), exampleText),
    preview,
    pollEditor,
    error,
    h('div', { class: 'composer-quick' }, imageBtn, modelBtn, tagsBtn, pollBtn, fileInput),
    h(
      'div',
      { class: 'composer-footer' },
      onCancel ? h('button', { type: 'button', class: 'btn ghost', text: 'Отмена', onClick: onCancel }) : null,
      h('span', { class: 'spacer' }),
      submit,
    ),
  );

  autoGrow(promptText, 320);
  autoGrow(exampleText, 200);
  return form;
}

/** Открывает композер в модальном окне. */
export async function openComposer({ post = null, draft = null, onDone = null } = {}) {
  if (!(await requireAuth('Войдите, чтобы опубликовать промпт'))) return null;
  return modal(
    (close) =>
      frag(
        h(
          'div',
          { class: 'modal-head' },
          h('h2', { text: post ? 'Редактирование промпта' : 'Новый промпт' }),
          h('button', { class: 'icon-btn', onClick: () => close(), 'aria-label': 'Закрыть' }, icon('close', { size: 18 })),
        ),
        composerForm({
          post,
          draft,
          onCancel: () => close(),
          onDone: (saved) => {
            onDone?.(saved);
            close(saved);
          },
        }),
      ),
    { wide: true },
  );
}

/** Свёрнутый композер в шапке ленты. */
export function inlineComposer({ onCreated }) {
  const box = h('div', { class: 'composer' });

  const collapsed = () => {
    const open = async () => {
      if (!(await requireAuth('Войдите, чтобы опубликовать промпт'))) return;
      expanded();
    };
    const quick = (iconName, label) =>
      h('button', { type: 'button', class: 'quick-btn', onClick: open }, icon(iconName, { size: 15 }), h('span', { text: label }));

    box.replaceChildren(
      h(
        'div',
        { class: 'row-top' },
        avatar(state.user, 'md', { link: false }),
        h('button', { class: 'composer-lite grow', text: 'Какой промпт покажете сегодня?', onClick: open }),
      ),
      h(
        'div',
        { class: 'composer-quick' },
        quick('image', 'Изображение'),
        quick('sparkles', 'Модель'),
        quick('bookmark', 'Теги'),
        quick('poll', 'Опрос'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', text: 'Опубликовать', onClick: open }),
      ),
    );
  };

  const expanded = () => {
    box.replaceChildren(
      h(
        'div',
        { class: 'row-top' },
        avatar(state.user, 'md', { link: false }),
        h(
          'div',
          { class: 'grow' },
          composerForm({
            onCancel: collapsed,
            onDone: (post) => {
              collapsed();
              onCreated?.(post);
            },
          }),
        ),
      ),
    );
    box.querySelector('textarea')?.focus();
  };

  collapsed();
  return box;
}
