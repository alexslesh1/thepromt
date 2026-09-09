/** Справочники, общие для сервера и клиента (отдаются через /api/meta). */

/**
 * Семейства моделей. `short` — подпись на бейдже поста, `hint` — строка
 * под названием в правой панели, `color` и `glyph` — оформление плитки-иконки
 * (абстрактный знак, а не логотип бренда).
 */
export const MODEL_FAMILIES = [
  {
    id: 'chatgpt',
    label: 'ChatGPT (OpenAI)',
    short: 'ChatGPT',
    hint: 'Текст, идеи, анализ',
    color: '#10A37F',
    glyph: 'spark',
    versions: ['GPT-5.1', 'GPT-5', 'GPT-4.1', 'GPT-4o', 'o3'],
  },
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    short: 'Claude',
    hint: 'Анализ и рассуждения',
    color: '#D97757',
    glyph: 'burst',
    versions: ['Claude Opus 4.5', 'Claude Sonnet 4.5', 'Claude Haiku 4.5'],
  },
  {
    id: 'gemini',
    label: 'Gemini (Google)',
    short: 'Gemini',
    hint: 'Мультимодальные задачи',
    color: '#4285F4',
    glyph: 'diamond',
    versions: ['Gemini 3 Pro', 'Gemini 2.5 Pro', 'Gemini 2.5 Flash'],
  },
  {
    id: 'midjourney',
    label: 'Midjourney',
    short: 'Midjourney',
    hint: 'Генерация изображений',
    color: '#8B93FF',
    glyph: 'sail',
    versions: ['Midjourney v7', 'Midjourney v6.1', 'Niji v6'],
  },
  {
    id: 'dalle',
    label: 'DALL·E',
    short: 'DALL·E',
    hint: 'Изображения по описанию',
    color: '#12B886',
    glyph: 'palette',
    versions: ['DALL·E 3', 'DALL·E 2'],
  },
  {
    id: 'stable-diffusion',
    label: 'Stable Diffusion',
    short: 'Stable Diffusion',
    hint: 'Открытая генерация',
    color: '#7C5CFF',
    glyph: 'layers',
    versions: ['SD 3.5 Large', 'SDXL 1.0', 'SD 1.5'],
  },
  {
    id: 'flux',
    label: 'FLUX',
    short: 'FLUX',
    hint: 'Фотореализм и детали',
    color: '#E8593F',
    glyph: 'wave',
    versions: ['FLUX.1 [pro]', 'FLUX.1 [dev]'],
  },
  {
    id: 'sora',
    label: 'Sora / видео',
    short: 'Sora',
    hint: 'Видеогенерация',
    color: '#F2B01E',
    glyph: 'play',
    versions: ['Sora 2', 'Runway Gen-3', 'Kling 1.6'],
  },
  {
    id: 'suno',
    label: 'Suno / аудио',
    short: 'Suno',
    hint: 'Музыка и голос',
    color: '#FF5C8A',
    glyph: 'note',
    versions: ['Suno v4', 'Udio v1.5'],
  },
  {
    id: 'llama',
    label: 'Llama (Meta)',
    short: 'Llama',
    hint: 'Открытые модели',
    color: '#4E9BFF',
    glyph: 'circle',
    versions: ['Llama 4', 'Llama 3.3 70B'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    short: 'DeepSeek',
    hint: 'Код и рассуждения',
    color: '#3A6BFF',
    glyph: 'whale',
    versions: ['DeepSeek-V3', 'DeepSeek-R1'],
  },
  {
    id: 'other',
    label: 'Другая модель',
    short: 'Другая',
    hint: 'Всё остальное',
    color: '#8A8A8A',
    glyph: 'circle',
    versions: [],
  },
];

export const MODEL_FAMILY_IDS = MODEL_FAMILIES.map((m) => m.id);

export const DIFFICULTIES = [
  { id: 'beginner', label: 'Новичок' },
  { id: 'intermediate', label: 'Средний' },
  { id: 'advanced', label: 'Продвинутый' },
];

export const DIFFICULTY_IDS = DIFFICULTIES.map((d) => d.id);

/** Категории промптов — фильтр «Все категории» в ленте. */
export const CATEGORIES = [
  { id: 'images', label: 'Изображения' },
  { id: 'text', label: 'Тексты' },
  { id: 'code', label: 'Код и разработка' },
  { id: 'marketing', label: 'Маркетинг' },
  { id: 'video', label: 'Видео' },
  { id: 'audio', label: 'Музыка и аудио' },
  { id: 'business', label: 'Бизнес и аналитика' },
  { id: 'education', label: 'Обучение' },
  { id: 'other', label: 'Другое' },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** Варианты сортировки ленты. */
export const SORT_OPTIONS = [
  { id: 'new', label: 'Сначала свежее' },
  { id: 'popular', label: 'Сначала популярное' },
  { id: 'discussed', label: 'Сначала обсуждаемое' },
];

export const SORT_IDS = SORT_OPTIONS.map((s) => s.id);

export const SUGGESTED_TAGS = [
  'ии-арт', 'аниме', 'фотореализм', 'персонаж', 'cinematic', 'дизайн',
  'продуктивность', 'midjourney', 'stablediffusion', 'чат-бот', 'код',
  'копирайтинг', 'маркетинг', 'seo', 'обучение', 'сторителлинг',
];

export const REPORT_REASONS = [
  { id: 'spam', label: 'Спам или реклама' },
  { id: 'harmful', label: 'Вредоносный контент' },
  { id: 'abuse', label: 'Оскорбления и травля' },
  { id: 'nsfw', label: 'Контент 18+' },
  { id: 'illegal', label: 'Незаконный контент' },
  { id: 'copyright', label: 'Нарушение авторских прав' },
  { id: 'other', label: 'Другое' },
];

export const REPORT_REASON_IDS = REPORT_REASONS.map((r) => r.id);

export const LIMITS = {
  title: 120,
  pollQuestion: 140,
  pollOption: 60,
  pollOptions: 4,
  promptText: 8000,
  description: 400,
  exampleText: 4000,
  modelVersion: 60,
  comment: 1000,
  bio: 280,
  displayName: 50,
  username: 20,
  reportDetails: 500,
  tagsPerPost: 6,
  tagLength: 24,
  modelName: 60,
};
