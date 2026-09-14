/**
 * WebSocket-сервер для реального времени (личные сообщения): один сокет на
 * вкладку, привязан к сессии тем же httpOnly-куки, что и обычные запросы —
 * отдельного логина по WS не требуется.
 */
import { WebSocketServer } from 'ws';
import { userBySession } from './auth.js';
import { config } from './config.js';

const wss = new WebSocketServer({ noServer: true });
const socketsByUser = new Map();

function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      jar[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      jar[key] = part.slice(eq + 1).trim();
    }
  }
  return jar;
}

function addSocket(userId, ws) {
  if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
  socketsByUser.get(userId).add(ws);
}

function removeSocket(userId, ws) {
  const set = socketsByUser.get(userId);
  if (!set) return;
  set.delete(ws);
  if (!set.size) socketsByUser.delete(userId);
}

/** Подключает обработку апгрейда до WebSocket к уже работающему HTTP-серверу. */
export function attachWebSocketServer(httpServer) {
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://internal').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // Origin должен совпадать с Host — тот же принцип, что и у
    // X-Requested-With для обычных запросов: чужой сайт не должен уметь
    // открыть WS-соединение от имени залогиненного пользователя.
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
    }

    const token = parseCookies(req.headers.cookie)[config.session.cookieName];
    const user = userBySession(token);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      addSocket(user.id, ws);
      ws.on('close', () => removeSocket(user.id, ws));
      ws.on('error', () => removeSocket(user.id, ws));
    });
  });
}

/** Отправляет JSON-событие во все открытые вкладки пользователя (если он онлайн). */
export function pushToUser(userId, payload) {
  const sockets = socketsByUser.get(userId);
  if (!sockets || !sockets.size) return;
  const data = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}
