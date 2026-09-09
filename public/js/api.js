/** Тонкая обёртка над fetch: JSON, cookie-сессия и понятные ошибки. */

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body, options = {}) {
  const headers = { 'X-Requested-With': 'ThePrompt' };
  let payload = body;

  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: payload,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Нет связи с сервером. Проверьте подключение.', 0);
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json().catch(() => ({})) : null;

  if (!response.ok) {
    throw new ApiError(data?.error || `Ошибка ${response.status}`, response.status, data?.code);
  }
  return data;
}

const query = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, value);
  }
  const string = search.toString();
  return string ? `?${string}` : '';
};

export const api = {
  meta: () => request('GET', '/api/meta'),
  sidebar: () => request('GET', '/api/sidebar'),

  requestCode: (email) => request('POST', '/api/auth/request-code', { email }),
  verifyCode: (email, code) => request('POST', '/api/auth/verify', { email, code }),
  createProfile: (data) => request('POST', '/api/auth/profile', data),
  me: () => request('GET', '/api/auth/me'),
  logout: () => request('POST', '/api/auth/logout'),
  logoutAll: () => request('POST', '/api/auth/logout-all'),
  usernameAvailable: (username) => request('GET', `/api/auth/username-available${query({ username })}`),
  oauthProviders: () => request('GET', '/api/auth/oauth/providers'),

  feed: (params, signal) => request('GET', `/api/posts${query(params)}`, undefined, { signal }),
  post: (id) => request('GET', `/api/posts/${id}`),
  createPost: (data) => request('POST', '/api/posts', data),
  updatePost: (id, data) => request('PATCH', `/api/posts/${id}`, data),
  deletePost: (id) => request('DELETE', `/api/posts/${id}`),
  like: (id) => request('POST', `/api/posts/${id}/like`),
  repost: (id, comment = '') => request('POST', `/api/posts/${id}/repost`, { comment }),
  bookmark: (id) => request('POST', `/api/posts/${id}/bookmark`),
  vote: (id, optionId) => request('POST', `/api/posts/${id}/vote`, { optionId }),
  likers: (id) => request('GET', `/api/posts/${id}/likes`),
  comments: (id) => request('GET', `/api/posts/${id}/comments`),
  comment: (id, body, parentId = null) => request('POST', `/api/posts/${id}/comments`, { body, parentId }),
  deleteComment: (commentId) => request('DELETE', `/api/comments/${commentId}`),
  report: (id, reason, details) => request('POST', `/api/posts/${id}/report`, { reason, details }),

  user: (username) => request('GET', `/api/users/${encodeURIComponent(username)}`),
  userPosts: (username, params) =>
    request('GET', `/api/users/${encodeURIComponent(username)}/posts${query(params)}`),
  followers: (username) => request('GET', `/api/users/${encodeURIComponent(username)}/followers`),
  following: (username) => request('GET', `/api/users/${encodeURIComponent(username)}/following`),
  follow: (username) => request('POST', `/api/users/${encodeURIComponent(username)}/follow`),
  searchUsers: (q) => request('GET', `/api/search/users${query({ q })}`),

  updateMe: (data) => request('PATCH', '/api/me', data),
  deleteMe: () => request('DELETE', '/api/me'),

  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('POST', '/api/uploads', form);
  },

  notifications: (params) => request('GET', `/api/notifications${query(params)}`),
  readNotifications: (id) => request('POST', '/api/notifications/read', id ? { id } : {}),

  subscribePro: () => request('POST', '/api/pro/subscribe'),
  cancelPro: () => request('POST', '/api/pro/cancel'),

  eduardoUsage: () => request('GET', '/api/eduardo/usage'),
  eduardoHistory: () => request('GET', '/api/eduardo/history'),
  eduardoText: (tool, prompt) => request('POST', '/api/eduardo/text', { tool, prompt }),
  eduardoImage: (prompt) => request('POST', '/api/eduardo/image', { prompt }),

  adminStats: () => request('GET', '/api/admin/stats'),
  adminReports: (params) => request('GET', `/api/admin/reports${query(params)}`),
  adminReport: (id) => request('GET', `/api/admin/reports/${id}`),
  dismissReport: (id, note) => request('POST', `/api/admin/reports/${id}/dismiss`, { note }),
  adminDeletePost: (id, reason) => request('POST', `/api/admin/posts/${id}/delete`, { reason }),
  adminRestorePost: (id) => request('POST', `/api/admin/posts/${id}/restore`),
  moderateUser: (id, data) => request('POST', `/api/admin/users/${id}/moderate`, data),
  adminUsers: (params) => request('GET', `/api/admin/users${query(params)}`),

  models: () => request('GET', '/api/models'),
  userModels: (username) => request('GET', `/api/models/user/${encodeURIComponent(username)}`),
  addModel: (data) => request('POST', '/api/models', data),
  updateModel: (id, data) => request('PATCH', `/api/models/${id}`, data),
  deleteModel: (id) => request('DELETE', `/api/models/${id}`),
};
