/**
 * Eduardo — ИИ-инструмент ThePrompt: вопрос-ответ и генерация тестов,
 * генерация кода, генерация изображений. Лимиты — по месяцам, у Pro больше.
 */
import { api } from '../api.js';
import { state } from '../state.js';
import { autoGrow, copyText, emptyState, h, spinner, timeEl, toast } from '../dom.js';
import { icon, proBadge } from '../icons.js';
import { openAuth } from '../components/auth.js';
import { openComposer } from '../components/composer.js';
import { openProModal } from '../components/pro.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

const TOOLS = [
  { id: 'qa', label: 'Вопрос-ответ', icon: 'comment', placeholder: 'Задайте вопрос…', action: 'Спросить' },
  { id: 'test', label: 'Тест по теме', icon: 'poll', placeholder: 'Тема для теста, например «Столицы Европы»…', action: 'Сгенерировать тест' },
  { id: 'code', label: 'Код', icon: 'sparkles', placeholder: 'Опишите задачу для кода…', action: 'Сгенерировать код' },
  { id: 'image', label: 'Изображение', icon: 'image', placeholder: 'Опишите изображение…', action: 'Сгенерировать изображение' },
];

function usageBar(usage) {
  const stat = (label, used, limit) => {
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    return h(
      'div',
      { class: 'eduardo-stat' },
      h('div', { class: 'eduardo-stat-head' }, h('span', { text: label }), h('span', { text: `${used} / ${limit}` })),
      h('div', { class: 'eduardo-bar' }, h('div', { class: `eduardo-bar-fill${pct >= 100 ? ' full' : ''}`, style: { width: `${pct}%` } })),
    );
  };

  return h(
    'div',
    { class: 'card eduardo-usage' },
    h(
      'div',
      { class: 'card-head' },
      h('h3', { text: usage.pro ? 'Лимиты Pro' : 'Лимиты этого месяца' }),
      usage.pro ? proBadge(15) : null,
      h('span', { class: 'spacer' }),
      !usage.pro
        ? h('button', { class: 'btn small', onClick: () => openProModal().then(refreshAll) }, icon('crown', { size: 14 }), h('span', { text: 'Оформить Pro' }))
        : null,
    ),
    stat('Текстовые запросы', usage.text.used, usage.text.limit),
    stat('Изображения', usage.image.used, usage.image.limit),
  );
}

let refreshAll = () => {};

function resultBox(payload) {
  if (!payload) return null;
  const box = h('div', { class: 'eduardo-result' });

  if (payload.simulated) {
    box.append(
      h(
        'div',
        { class: 'eduardo-sim-note' },
        icon('warn', { size: 14 }),
        h('span', {
          text: 'Демо-режим: на сервере не настроен ключ API, это шаблонный результат, а не ответ настоящей нейросети.',
        }),
      ),
    );
  }

  if (payload.url) {
    box.append(
      h('img', { src: payload.url, alt: '', class: 'eduardo-image' }),
      h(
        'div',
        { class: 'composer-footer' },
        h('button', { class: 'btn ghost small', onClick: () => window.open(payload.url, '_blank') }, icon('image', { size: 14 }), h('span', { text: 'Открыть' })),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn small',
            onClick: () => openComposer({ draft: { promptText: payload.prompt ?? '', exampleImage: payload.url } }),
          },
          icon('feather', { size: 14 }),
          h('span', { text: 'Использовать в посте' }),
        ),
      ),
    );
  } else {
    const pre = h('pre', { class: 'eduardo-text', text: payload.text });
    box.append(
      h('div', { class: 'prompt-box' }, pre),
      h(
        'div',
        { class: 'composer-footer' },
        h(
          'button',
          {
            class: 'btn ghost small',
            onClick: async () => {
              await copyText(payload.text);
              toast('Скопировано');
            },
          },
          icon('copy', { size: 14 }),
          h('span', { text: 'Скопировать' }),
        ),
        h('span', { class: 'spacer' }),
        h(
          'button',
          { class: 'btn small', onClick: () => openComposer({ draft: { promptText: payload.text } }) },
          icon('feather', { size: 14 }),
          h('span', { text: 'Опубликовать как промпт' }),
        ),
      ),
    );
  }
  return box;
}

function comingSoonPanel() {
  return emptyState(
    'image',
    'Скоро будет доступно',
    'Генерация изображений в Eduardo пока не подключена — загляните позже.',
  );
}

function toolPanel(tool, onDone) {
  const input = h('textarea', { class: 'textarea', rows: 4, placeholder: tool.placeholder });
  autoGrow(input, 260);

  const error = h('p', { class: 'error-text', style: { display: 'none' } });
  const resultSlot = h('div', {});
  const submit = h('button', { class: 'btn', type: 'submit' }, icon('send', { size: 15 }), h('span', { text: tool.action }));

  const form = h(
    'form',
    {
      onSubmit: async (event) => {
        event.preventDefault();
        const prompt = input.value.trim();
        if (prompt.length < 3) {
          error.textContent = 'Опишите запрос подробнее (минимум 3 символа).';
          error.style.display = 'block';
          return;
        }
        error.style.display = 'none';
        submit.disabled = true;
        const prevLabel = submit.lastChild.textContent;
        submit.lastChild.textContent = 'Генерируем…';
        try {
          const result =
            tool.id === 'image' ? await api.eduardoImage(prompt) : await api.eduardoText(tool.id, prompt);
          // Сервер отдаёт текст в поле `result`, а не `text` — приводим к тому,
          // что ждёт resultBox().
          resultSlot.replaceChildren(resultBox({ ...result, text: result.result, prompt }));
          onDone(result.usage);
        } catch (err) {
          error.textContent = err.message;
          error.style.display = 'block';
          if (err.code === 'limit_reached') {
            error.append(
              h('button', {
                class: 'btn small',
                style: { marginLeft: '10px' },
                text: 'Оформить Pro',
                type: 'button',
                onClick: () => openProModal().then(refreshAll),
              }),
            );
          }
        } finally {
          submit.disabled = false;
          submit.lastChild.textContent = prevLabel;
        }
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'label', text: tool.label }), input),
    error,
    submit,
  );

  return h('div', {}, form, resultSlot);
}

const TOOL_LABEL = { qa: 'Вопрос-ответ', test: 'Тест', code: 'Код', image: 'Изображение' };

/** Загружает историю запросов в уже существующий контейнер (для обновления после генерации). */
async function loadHistoryInto(box) {
  box.replaceChildren(spinner('Загружаем историю…'));
  try {
    const { items } = await api.eduardoHistory();
    if (!items.length) {
      box.replaceChildren(emptyState('sparkles', 'Пока пусто', 'Здесь появится история ваших запросов к Eduardo.'));
      return;
    }
    box.replaceChildren(
      ...items.map((item) =>
        h(
          'div',
          { class: 'notif' },
          h('div', { class: 'ico' }, icon(item.tool === 'image' ? 'image' : 'sparkles', { size: 16 })),
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('div', { class: 'title', text: `${TOOL_LABEL[item.tool] ?? item.tool}${item.simulated ? ' · демо' : ''}` }),
            h('div', { class: 'body', text: item.prompt.slice(0, 140) }),
            timeEl(item.createdAt),
          ),
        ),
      ),
    );
  } catch (error) {
    box.replaceChildren(emptyState('warn', 'Не удалось загрузить историю', error.message));
  }
}

export async function eduardoView() {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  if (!state.user) {
    main.append(
      header({ title: 'Eduardo', subtitle: 'ИИ-инструмент ThePrompt' }),
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'big' }, icon('sparkles', { size: 26 })),
        h('h3', { text: 'Нужен вход' }),
        h('p', { text: 'Войдите, чтобы пользоваться Eduardo.' }),
        h('button', {
          class: 'btn',
          style: { marginTop: '14px' },
          text: 'Войти',
          onClick: async () => {
            if (await openAuth()) eduardoView();
          },
        }),
      ),
    );
    return;
  }

  main.append(
    header({
      title: 'Eduardo',
      subtitle: 'Вопрос-ответ, тесты, код и изображения — с лимитами free и Pro',
      pill: { icon: 'sparkles', label: 'ИИ-инструмент' },
    }),
  );

  const usageSlot = h('div', {}, spinner('Загружаем лимиты…'));
  main.append(usageSlot);

  const tabsBox = h('div', { class: 'tabs' });
  const panelSlot = h('div', { style: { marginTop: '4px' } });
  main.append(tabsBox, panelSlot);

  let activeTool = TOOLS[0];

  async function loadUsage() {
    try {
      const usage = await api.eduardoUsage();
      usageSlot.replaceChildren(usageBar(usage));
      return usage;
    } catch (error) {
      usageSlot.replaceChildren(emptyState('warn', 'Не удалось загрузить лимиты', error.message));
      return null;
    }
  }

  function renderTabs() {
    tabsBox.replaceChildren(
      ...TOOLS.map((tool) =>
        h('button', {
          class: `tab${tool.id === activeTool.id ? ' active' : ''}`,
          text: tool.label,
          onClick: () => {
            activeTool = tool;
            renderTabs();
            renderPanel();
          },
        }),
      ),
    );
  }

  const historyBox = h('div', {}, spinner('Загружаем историю…'));

  const imageEnabled = state.meta?.eduardo?.imageEnabled ?? false;

  function renderPanel() {
    if (activeTool.id === 'image' && !imageEnabled) {
      panelSlot.replaceChildren(comingSoonPanel());
      return;
    }
    panelSlot.replaceChildren(
      toolPanel(activeTool, (usage) => {
        usageSlot.replaceChildren(usageBar(usage));
        loadHistoryInto(historyBox);
      }),
    );
  }

  refreshAll = async () => {
    await loadUsage();
  };

  renderTabs();
  renderPanel();
  await loadUsage();

  main.append(h('h3', { class: 'section-title', text: 'История запросов' }), historyBox);
  loadHistoryInto(historyBox);
}
