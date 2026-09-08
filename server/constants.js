/** Справочники, общие для сервера и клиента (отдаются через /api/meta). */

export const MODEL_FAMILIES = [
  { id: 'chatgpt', label: 'ChatGPT (OpenAI)', versions: ['GPT-5.1', 'GPT-5', 'GPT-4.1', 'GPT-4o', 'o3'] },
  { id: 'claude', label: 'Claude (Anthropic)', versions: ['Claude Opus 4.5', 'Claude Sonnet 4.5', 'Claude Haiku 4.5'] },
  { id: 'gemini', label: 'Gemini (Google)', versions: ['Gemini 3 Pro', 'Gemini 2.5 Pro', 'Gemini 2.5 Flash'] },
  { id: 'midjourney', label: 'Midjourney', versions: ['Midjourney v7', 'Midjourney v6.1', 'Niji v6'] },
  { id: 'dalle', label: 'DALL·E', versions: ['DALL·E 3', 'DALL·E 2'] },
  { id: 'stable-diffusion', label: 'Stable Diffusion', versions: ['SD 3.5 Large', 'SDXL 1.0', 'SD 1.5'] },
  { id: 'flux', label: 'FLUX', versions: ['FLUX.1 [pro]', 'FLUX.1 [dev]'] },
  { id: 'sora', label: 'Sora / видео', versions: ['Sora 2', 'Runway Gen-3', 'Kling 1.6'] },
  { id: 'suno', label: 'Suno / аудио', versions: ['Suno v4', 'Udio v1.5'] },
  { id: 'llama', label: 'Llama (Meta)', versions: ['Llama 4', 'Llama 3.3 70B'] },
  { id: 'deepseek', label: 'DeepSeek', versions: ['DeepSeek-V3', 'DeepSeek-R1'] },
  { id: 'other', label: 'Другая модель', versions: [] },
];

export const MODEL_FAMILY_IDS = MODEL_FAMILIES.map((m) => m.id);

export const DIFFICULTIES = [
  { id: 'beginner', label: 'Новичок' },
  { id: 'intermediate', label: 'Средний' },
  { id: 'advanced', label: 'Продвинутый' },
];

export const DIFFICULTY_IDS = DIFFICULTIES.map((d) => d.id);

export const SUGGESTED_TAGS = [
  'копирайтинг', 'код', 'картинки', 'маркетинг', 'seo', 'обучение',
  'аналитика', 'бизнес', 'дизайн', 'видео', 'музыка', 'перевод',
  'резюме', 'нейминг', 'сторителлинг', 'продуктивность',
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
};
