const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { Pool } = require('pg');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

require('dotenv').config();

const REQUIRED_ENV = ['DATABASE_URL', 'IIKO_HOST', 'IIKO_LOGIN', 'IIKO_PASSWORD', 'APP_ADMIN_USERNAME', 'APP_ADMIN_PASSWORD', 'APP_ADMIN_NAME'];
const missingEnv = REQUIRED_ENV.filter((name) => !String(process.env[name] || '').trim());
if (missingEnv.length) {
  console.error(`[BURЖУЙ] Не заданы обязательные переменные окружения: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const IIKO_HOST = process.env.IIKO_HOST.replace(/\/+$/, '');
const IIKO_LOGIN = process.env.IIKO_LOGIN;
const IIKO_PASSWORD = process.env.IIKO_PASSWORD;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render's private Postgres endpoint presents a platform-managed self-signed chain.
  // Traffic remains inside Render's private network; certificate verification must be disabled there.
  ssl: IS_PRODUCTION ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000
});
pool.on('error', (error) => console.error('[BURЖУЙ] Ошибка пула PostgreSQL:', error.code || error.name || 'database_error'));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"],
      objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'same-origin' }
}));
app.use(express.json({ limit: '1mb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

class AppError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR') { super(message); this.status = status; this.code = code; }
}
function fail(status, message, code) { throw new AppError(status, message, code); }
function asyncHandler(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
function sendError(res, status, message, code) { return res.status(status).json({ success: false, error: message, code }); }

function parseCookies(header) {
  const result = {};
  String(header || '').split(';').forEach((part) => {
    const index = part.indexOf('='); if (index < 0) return;
    const key = part.slice(0, index).trim(); const value = part.slice(index + 1).trim();
    try { result[key] = decodeURIComponent(value); } catch (_) { result[key] = value; }
  });
  return result;
}
function hashSessionToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function cookieOptions() { return { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'strict', path: '/', maxAge: SESSION_TTL_MS }; }
function boundedString(value, name, max, required = false) {
  if (value === undefined || value === null) { if (required) fail(400, `Поле ${name} обязательно`, 'VALIDATION_ERROR'); return null; }
  if (typeof value !== 'string') fail(400, `Поле ${name} должно быть строкой`, 'VALIDATION_ERROR');
  const result = value.trim();
  if (required && !result) fail(400, `Поле ${name} обязательно`, 'VALIDATION_ERROR');
  if (result.length > max) fail(400, `Поле ${name} слишком длинное`, 'VALIDATION_ERROR');
  return result || null;
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) fail(400, 'Пароль должен содержать от 8 до 256 символов', 'INVALID_PASSWORD');
}
function normalizeUsername(value) {
  if (typeof value !== 'string') fail(400, 'Некорректный логин', 'INVALID_USERNAME');
  const username = value.trim().toLowerCase();
  if (!/^[a-zа-яё0-9._-]{3,64}$/iu.test(username)) fail(400, 'Некорректный логин', 'INVALID_USERNAME');
  return username;
}
function normalizeRole(value) { if (!['developer', 'supervisor', 'manager', 'employee'].includes(value)) fail(400, 'Недопустимая роль', 'INVALID_ROLE'); return value; }
function isNetworkRole(role) { return role === 'developer' || role === 'supervisor'; }
function isUuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function normalizeDepartmentIds(value, name = 'department_ids') {
  if (!Array.isArray(value)) fail(400, `Поле ${name} должно быть массивом UUID`, 'VALIDATION_ERROR');
  const ids = [...new Set(value.map((item) => {
    if (typeof item !== 'string' || !isUuid(item.trim())) fail(400, `Поле ${name} содержит некорректный UUID`, 'VALIDATION_ERROR');
    return item.trim();
  }))];
  if (ids.length > 45) fail(400, `Поле ${name} содержит слишком много точек`, 'VALIDATION_ERROR');
  return ids;
}
function legacyDepartmentIds(row) {
  if (Array.isArray(row && row.department_ids)) return row.department_ids.filter(Boolean);
  return row && row.department_id ? [row.department_id] : [];
}
function userScope(row) {
  return { all: row && row.role === 'developer' ? true : Boolean(row && row.all_departments), ids: legacyDepartmentIds(row) };
}
function scopeAllows(scope, departmentId) { return Boolean(scope.all || (departmentId && scope.ids.includes(departmentId))); }
function scopeIsSubset(child, parent) { return Boolean(parent.all || (!child.all && !parent.all && child.ids.every((id) => parent.ids.includes(id)))); }
function scopesOverlap(left, right) {
  return Boolean(left.all || right.all || left.ids.some((id) => right.ids.includes(id)));
}
function scopeForRequest(body, current, role, actor) {
  if (isNetworkRole(role)) return { all: true, ids: [] };
  const hasIds = Object.prototype.hasOwnProperty.call(body || {}, 'department_ids');
  const hasAll = Object.prototype.hasOwnProperty.call(body || {}, 'all_departments');
  const hasLegacy = Object.prototype.hasOwnProperty.call(body || {}, 'department_id');
  let ids = hasIds ? normalizeDepartmentIds(body.department_ids) : (hasLegacy ? (body.department_id ? normalizeDepartmentIds([boundedString(body.department_id, 'department_id', 128)]) : []) : legacyDepartmentIds(current));
  let all = hasAll ? body.all_departments : (hasIds || hasLegacy ? false : (current ? Boolean(current.all_departments) : isNetworkRole(role)));
  if (typeof all !== 'boolean') fail(400, 'Поле all_departments должно быть boolean', 'VALIDATION_ERROR');
  if (!hasIds && hasLegacy && !hasAll) all = false;
  if (isNetworkRole(role) && !hasIds && !hasLegacy && !hasAll) all = true;
  if (all) ids = [];
  if (!all && !ids.length) fail(400, 'Назначьте пользователю хотя бы одну точку или всю сеть', 'SCOPE_REQUIRED');
  const scope = { all, ids };
  if (actor && actor.role === 'manager' && !scopeIsSubset(scope, userScope(actor))) fail(403, 'Область сотрудника выходит за пределы ваших точек', 'FORBIDDEN');
  return scope;
}
async function ensureIikoCodeAvailable(code, scope, excludeId = null) {
  if (!code) return;
  const rows = (await pool.query('SELECT id, role, department_ids, all_departments, department_id FROM users WHERE iiko_employee_code = $1 AND ($2::uuid IS NULL OR id <> $2)', [code, excludeId])).rows;
  if (rows.some((row) => scopesOverlap(scope, userScope(row)))) fail(409, 'Этот табельный код iiko уже используется в пересекающейся области точек', 'IIKO_CODE_EXISTS');
}
function normalizeStatus(value) { if (!['new', 'in_progress', 'review', 'done'].includes(value)) fail(400, 'Недопустимый статус задачи', 'INVALID_STATUS'); return value; }
function normalizePriority(value) { if (!['low', 'normal', 'high', 'urgent'].includes(value)) fail(400, 'Недопустимый приоритет задачи', 'INVALID_PRIORITY'); return value; }
function idValue(value, label = 'id') { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) fail(400, `Некорректный ${label}`, 'INVALID_ID'); return number; }
function dateValue(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function dateRange(query) {
  if (!dateValue(query.from) || !dateValue(query.to) || query.from > query.to) fail(400, 'Некорректный диапазон дат', 'INVALID_DATE_RANGE');
  const to = new Date(`${query.to}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 1);
  return { from: query.from, to: query.to, toInclusive: to.toISOString().slice(0, 10) };
}

function sameOrigin(req, res, next) {
  const expected = `${req.protocol}://${req.get('host')}`;
  const candidates = [];
  if (req.get('origin')) candidates.push(req.get('origin'));
  if (req.get('referer')) { try { candidates.push(new URL(req.get('referer')).origin); } catch (_) { return sendError(res, 403, 'Недопустимый источник запроса', 'CSRF_REJECTED'); } }
  if (!candidates.length || candidates.some((candidate) => candidate !== expected)) return sendError(res, 403, 'Недопустимый источник запроса', 'CSRF_REJECTED');
  return next();
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
async function hashPassword(password) {
  validatePassword(password); const salt = crypto.randomBytes(16); const key = await scryptAsync(password, salt);
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$'); if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  if (Number(parts[1]) !== 16384 || Number(parts[2]) !== 8 || Number(parts[3]) !== 1) return false;
  try {
    const expected = Buffer.from(parts[5], 'base64url'); const actual = await scryptAsync(password, Buffer.from(parts[4], 'base64url'));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) { return false; }
}

const USER_COLUMNS = `id, username, full_name, "role" AS role, department_id, department_name, department_ids, all_departments, iiko_employee_name, iiko_employee_code, active, password_hash, created_at, updated_at`;
const USER_COLUMNS_QUALIFIED = `u.id, u.username, u.full_name, u."role" AS role, u.department_id, u.department_name, u.department_ids, u.all_departments, u.iiko_employee_name, u.iiko_employee_code, u.active, u.password_hash, u.created_at, u.updated_at`;
function userView(row) {
  if (!row) return row;
  const scope = userScope(row);
  return { id: row.id, username: row.username, full_name: row.full_name, role: row.role, department_id: row.department_id, department_name: row.department_name, department_ids: scope.ids, all_departments: scope.all, iiko_employee_name: row.iiko_employee_name, iiko_employee_code: row.iiko_employee_code, active: row.active, created_at: row.created_at, updated_at: row.updated_at };
}
async function getUserById(id) { return (await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id])).rows[0] || null; }
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashSessionToken(token), userId, expiresAt]);
  return { token, expiresAt };
}
async function authMiddleware(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie).burzhui_session;
    if (!token) return sendError(res, 401, 'Требуется авторизация', 'AUTH_REQUIRED');
    const result = await pool.query(`SELECT ${USER_COLUMNS_QUALIFIED} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.active = TRUE`, [hashSessionToken(token)]);
    if (!result.rows[0]) return sendError(res, 401, 'Сессия недействительна', 'AUTH_REQUIRED');
    req.user = result.rows[0]; req.sessionTokenHash = hashSessionToken(token);
    await pool.query('UPDATE sessions SET last_seen_at = NOW() WHERE token_hash = $1', [req.sessionTokenHash]);
    return next();
  } catch (error) { return next(error); }
}
function requireRoles(...roles) { return (req, res, next) => roles.includes(req.user && req.user.role) ? next() : sendError(res, 403, 'Недостаточно прав', 'FORBIDDEN'); }
function scopedDepartment(req, value = 'ALL') {
  const scope = userScope(req.user);
  if (value === 'ALL') {
    if (scope.all) return null;
    if (!scope.ids.length) fail(403, 'Для пользователя не назначены точки', 'FORBIDDEN');
    return scope.ids.length === 1 ? scope.ids[0] : scope.ids;
  }
  if (!isUuid(value) || !scopeAllows(scope, value)) fail(403, 'Нет доступа к этой точке', 'FORBIDDEN');
  return value;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE, full_name VARCHAR(200) NOT NULL, "role" VARCHAR(20) NOT NULL CHECK ("role" IN ('developer','supervisor','manager','employee')), department_id VARCHAR(128), department_name VARCHAR(200), department_ids TEXT[] NOT NULL DEFAULT '{}'::text[], all_departments BOOLEAN NOT NULL DEFAULT FALSE, iiko_employee_name VARCHAR(200), iiko_employee_code VARCHAR(100), active BOOLEAN NOT NULL DEFAULT TRUE, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_ids TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS all_departments BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS iiko_employee_code VARCHAR(100);
DO $$ DECLARE item RECORD; BEGIN
  FOR item IN SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP EXECUTE format('ALTER TABLE users DROP CONSTRAINT IF EXISTS %I', item.conname); END LOOP;
END $$;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK ("role" IN ('developer','supervisor','manager','employee'));
UPDATE users SET department_ids = CASE WHEN NULLIF(BTRIM(department_id), '') IS NULL THEN '{}'::text[] ELSE ARRAY[department_id]::text[] END WHERE department_ids IS NULL;
UPDATE users SET all_departments = ("role" IN ('developer','supervisor')) WHERE all_departments IS NULL;
UPDATE users SET all_departments = TRUE, department_ids = '{}'::text[] WHERE "role" = 'developer';
UPDATE users SET department_id = department_ids[1] WHERE department_id IS NULL AND COALESCE(array_length(department_ids, 1), 0) > 0;
ALTER TABLE users ALTER COLUMN department_ids SET DEFAULT '{}'::text[];
ALTER TABLE users ALTER COLUMN department_ids SET NOT NULL;
ALTER TABLE users ALTER COLUMN all_departments SET DEFAULT FALSE;
ALTER TABLE users ALTER COLUMN all_departments SET NOT NULL;
DROP INDEX IF EXISTS users_department_iiko_code_unique;
CREATE INDEX IF NOT EXISTS users_iiko_employee_code_idx ON users(iiko_employee_code) WHERE iiko_employee_code IS NOT NULL;
CREATE TABLE IF NOT EXISTS sessions (token_hash CHAR(64) PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS tasks (id BIGSERIAL PRIMARY KEY, title VARCHAR(200) NOT NULL, description TEXT, status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','review','done')), priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')), department_id VARCHAR(128), department_name VARCHAR(200), creator_id UUID NOT NULL REFERENCES users(id), assignee_id UUID REFERENCES users(id), due_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(20);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
ALTER TABLE tasks ALTER COLUMN priority SET DEFAULT 'normal';
UPDATE tasks SET priority = 'normal' WHERE priority IS NULL;
ALTER TABLE tasks ALTER COLUMN priority SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_priority_check') THEN ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('low','normal','high','urgent')); END IF; END $$;
CREATE INDEX IF NOT EXISTS tasks_department_idx ON tasks(department_id); CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id);
CREATE TABLE IF NOT EXISTS task_comments (id BIGSERIAL PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id), body TEXT NOT NULL, kind VARCHAR(20) NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','report')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments(task_id, created_at);
CREATE TABLE IF NOT EXISTS task_attachments (id UUID PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id), filename VARCHAR(255) NOT NULL, mime_type VARCHAR(100) NOT NULL, size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880), data BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON task_attachments(task_id, created_at);
CREATE TABLE IF NOT EXISTS task_events (id BIGSERIAL PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id), event_type VARCHAR(80) NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events(task_id, created_at);
`;
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query(SCHEMA_SQL); await client.query('DELETE FROM sessions WHERE expires_at <= NOW()');
    const count = await client.query('SELECT COUNT(*)::int AS count FROM users');
    if (count.rows[0].count === 0) {
      const hash = await hashPassword(process.env.APP_ADMIN_PASSWORD);
      await client.query('INSERT INTO users (id, username, full_name, "role", department_ids, all_departments, active, password_hash) VALUES ($1, $2, $3, \'developer\', \'{}\'::text[], TRUE, TRUE, $4)', [crypto.randomUUID(), normalizeUsername(process.env.APP_ADMIN_USERNAME), boundedString(process.env.APP_ADMIN_NAME, 'APP_ADMIN_NAME', 200, true), hash]);
      console.log('[BURЖУЙ] Создан первый developer из переменных окружения.');
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function getTask(id) {
  return (await pool.query(`SELECT t.*, cu.full_name AS creator_name, au.full_name AS assignee_name FROM tasks t JOIN users cu ON cu.id = t.creator_id LEFT JOIN users au ON au.id = t.assignee_id WHERE t.id = $1`, [id])).rows[0] || null;
}
function canAccessTask(task, user) {
  if (!task) return false;
  if (user.role === 'developer') return true;
  if (user.role === 'supervisor' || user.role === 'manager') return scopeAllows(userScope(user), task.department_id);
  return user.role === 'employee' && task.assignee_id === user.id;
}
async function taskDetail(task, user) {
  if (!canAccessTask(task, user)) fail(403, 'Нет доступа к задаче', 'FORBIDDEN');
  const [comments, attachments] = await Promise.all([
    pool.query('SELECT c.id, c.task_id, c.user_id, c.body, c.kind, c.created_at, u.full_name AS user_name FROM task_comments c JOIN users u ON u.id = c.user_id WHERE c.task_id = $1 ORDER BY c.created_at, c.id', [task.id]),
    pool.query('SELECT id, task_id, user_id, filename, mime_type, size_bytes, created_at FROM task_attachments WHERE task_id = $1 ORDER BY created_at', [task.id])
  ]);
  return { ...task, comments: comments.rows, attachments: attachments.rows };
}
async function taskEvent(taskId, userId, type, payload = {}) {
  await pool.query('INSERT INTO task_events (task_id, user_id, event_type, payload) VALUES ($1, $2, $3, $4::jsonb)', [taskId, userId, type, JSON.stringify(payload)]);
}
async function listTasks(user) {
  let query = 'SELECT t.*, cu.full_name AS creator_name, au.full_name AS assignee_name FROM tasks t JOIN users cu ON cu.id = t.creator_id LEFT JOIN users au ON au.id = t.assignee_id'; const params = [];
  if (user.role === 'supervisor') { const scope = userScope(user); if (!scope.all) { query += ' WHERE t.department_id = ANY($1::text[])'; params.push(scope.ids); } }
  if (user.role === 'manager') { const scope = userScope(user); if (scope.all) query += ' WHERE t.department_id IS NOT NULL'; else { query += ' WHERE t.department_id = ANY($1::text[])'; params.push(scope.ids); } }
  if (user.role === 'employee') { query += ' WHERE t.assignee_id = $1'; params.push(user.id); }
  query += ' ORDER BY t.updated_at DESC, t.id DESC'; return (await pool.query(query, params)).rows;
}
function validateTaskDepartment(user, departmentId) {
  if (!departmentId || !isUuid(departmentId)) fail(400, 'Для задачи нужна корректная точка', 'VALIDATION_ERROR');
  if (!scopeAllows(userScope(user), departmentId)) fail(403, 'Нет доступа к этой точке', 'FORBIDDEN');
}
function validateTaskAssignee(assignee, departmentId) {
  if (!assignee || !assignee.active) fail(400, 'Исполнитель не найден или деактивирован', 'INVALID_ASSIGNEE');
  if (assignee.role !== 'employee') fail(400, 'Задачу можно назначить только сотруднику', 'INVALID_ASSIGNEE');
  if (!scopeAllows(userScope(assignee), departmentId)) fail(400, 'Исполнитель не привязан к выбранной точке', 'INVALID_ASSIGNEE');
}

function validImage(file) {
  const b = file.buffer;
  const jpeg = b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  const png = b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  if (!((file.mimetype === 'image/jpeg' && jpeg) || (file.mimetype === 'image/png' && png) || (file.mimetype === 'image/webp' && webp))) fail(400, 'Разрешены только JPEG, PNG и WebP', 'INVALID_ATTACHMENT');
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (req, file, cb) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ? cb(null, true) : cb(new AppError(400, 'Разрешены только JPEG, PNG и WebP', 'INVALID_ATTACHMENT')) });

// iiko integration. Report shapes and analytics response keys remain compatible with the old dashboard.
let cachedToken = null; let tokenExpiresAt = 0; let cachedEmployees = null; let employeesExpiresAt = 0;
function sha1(value) { return crypto.createHash('sha1').update(value).digest('hex'); }
function makeRequest(urlString, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString); const client = url.protocol === 'https:' ? https : http;
    const request = client.request({ hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search, method: options.method || 'GET', headers: options.headers || {} }, (response) => {
      let data = ''; response.setEncoding('utf8'); response.on('data', (part) => { data += part; }); response.on('end', () => resolve({ status: response.statusCode, body: data }));
    });
    request.on('error', reject); request.setTimeout(25000, () => request.destroy(new Error('iiko request timeout')));
    if (body) request.write(typeof body === 'string' ? body : JSON.stringify(body)); request.end();
  });
}
async function getIikoToken(force = false) {
  if (!force && cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const passHash = sha1(IIKO_PASSWORD); const body = `login=${encodeURIComponent(IIKO_LOGIN)}&pass=${encodeURIComponent(passHash)}`;
  const result = await makeRequest(`${IIKO_HOST}/resto/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, body);
  if (result.status !== 200 || !result.body.trim()) throw new Error(`iiko authentication failed: ${result.status}`);
  cachedToken = result.body.trim(); tokenExpiresAt = Date.now() + 25 * 60 * 1000; return cachedToken;
}
async function iikoFetch(urlPath, options = {}, body = null, retry = true) {
  const token = await getIikoToken();
  const result = await makeRequest(`${IIKO_HOST}${urlPath}`, { ...options, headers: { ...(options.headers || {}), Cookie: `key=${token}` } }, body);
  if ((result.status === 401 || result.status === 403 || result.body.includes('Session expired')) && retry) { await getIikoToken(true); return iikoFetch(urlPath, options, body, false); }
  return result;
}
function jsonBody(body) { try { return JSON.parse(body || '{}'); } catch (_) { throw new Error('Invalid iiko JSON response'); } }
async function getEmployeesMap() {
  if (cachedEmployees && Date.now() < employeesExpiresAt) return cachedEmployees;
  const response = await iikoFetch('/resto/api/employees'); if (response.status !== 200) throw new Error(`iiko employees: ${response.status}`);
  const map = {}; const regex = /<employee>(.*?)<\/employee>/gs; let match;
  while ((match = regex.exec(response.body)) !== null) { const item = match[1]; const id = (item.match(/<id>(.*?)<\/id>/) || [])[1]; if (id) map[id] = { name: (item.match(/<name>(.*?)<\/name>/) || [])[1] || 'Не указано', code: (item.match(/<code>(.*?)<\/code>/) || [])[1] || '' }; }
  cachedEmployees = map; employeesExpiresAt = Date.now() + 30 * 60 * 1000; return map;
}
async function fetchDepartments() {
  const response = await iikoFetch('/resto/api/corporation/departments'); if (response.status !== 200) throw new Error(`iiko departments: ${response.status}`);
  const items = []; const regex = /<corporateItemDto>(.*?)<\/corporateItemDto>/gs; let match;
  while ((match = regex.exec(response.body)) !== null) {
    const item = match[1]; const type = (item.match(/<type>(.*?)<\/type>/) || [])[1]; const id = (item.match(/<id>(.*?)<\/id>/) || [])[1]; const name = (item.match(/<name>(.*?)<\/name>/) || [])[1]; const code = (item.match(/<code>(.*?)<\/code>/) || [])[1];
    if (type === 'DEPARTMENT' && id && name) items.push({ id, name, code: code || '' });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' }));
}
function salesFilters(dates, departmentId, cashier, cashierCode) {
  const filters = { 'OpenDate.Typed': { filterType: 'DateRange', periodType: 'CUSTOM', from: dates.from, to: dates.toInclusive }, OrderDeleted: { filterType: 'IncludeValues', values: ['NOT_DELETED'] } };
  if (Array.isArray(departmentId) && departmentId.length) filters['Department.Id'] = { filterType: 'IncludeValues', values: departmentId };
  else if (departmentId && departmentId !== 'ALL') filters['Department.Id'] = { filterType: 'IncludeValues', values: [departmentId] };
  if (cashier) filters.Cashier = { filterType: 'IncludeValues', values: [cashier] };
  if (cashierCode) filters['Cashier.Code'] = { filterType: 'IncludeValues', values: [cashierCode] };
  return filters;
}
async function olap(body) {
  const response = await iikoFetch('/resto/api/v2/reports/olap', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify(body));
  if (response.status !== 200) throw new Error(`iiko report: ${response.status}`); return jsonBody(response.body).data || [];
}
async function fetchSales(departmentId, dates) {
  const filters = salesFilters(dates, departmentId);
  const requests = [
    ['OpenDate.Typed', ['DishDiscountSumInt', 'DishSumInt', 'DiscountSum', 'UniqOrderId', 'DishDiscountSumInt.average', 'DishAmountInt', 'GuestNum']],
    ['PayTypes', ['DishDiscountSumInt', 'UniqOrderId']],
    ['DishName', ['DishAmountInt', 'DishDiscountSumInt'], ['DishCategory']],
    ['OpenTime.Minutes15', ['DishDiscountSumInt', 'UniqOrderId']],
    ['Cashier', ['DishDiscountSumInt', 'UniqOrderId', 'DishDiscountSumInt.average'], ['Cashier.Code']],
    ['DishGroup.TopParent', ['DishAmountInt', 'DishDiscountSumInt'], ['DishType']],
    ['Cashier', ['DishAmountInt', 'DishDiscountSumInt'], ['DishGroup.TopParent', 'DishType']]
  ];
  const responses = await Promise.all(requests.map(([group, aggregateFields, extra = []]) => olap({ reportType: 'SALES', buildSummary: false, groupByRowFields: [group, ...extra], aggregateFields, filters })));
  const [daily0, payments0, dishes0, hourly0, cashiers0, upsell0, cashierItems0] = responses;
  const daily = daily0.sort((a, b) => String(a['OpenDate.Typed']).localeCompare(String(b['OpenDate.Typed'])));
  const dishes = dishes0.sort((a, b) => (b.DishDiscountSumInt || 0) - (a.DishDiscountSumInt || 0));
  const cashiers = cashiers0.sort((a, b) => (b.DishDiscountSumInt || 0) - (a.DishDiscountSumInt || 0));
  const classify = (row) => { const group = String(row['DishGroup.TopParent'] || ''), type = String(row.DishType || ''); if (group.includes('Напитки') || group.toLowerCase().includes('коктейл')) return 'drinks'; if (group.includes('Модификаторы') || type === 'MODIFIER' || group.includes('УБРАТЬ')) return 'addons'; if (!group.includes('Сервисный сбор')) return 'main'; return 'ignore'; };
  let mainDishesCount = 0, mainDishesRevenue = 0, drinksCount = 0, drinksRevenue = 0, addonsCount = 0, addonsRevenue = 0;
  upsell0.forEach((row) => { const qty = Number(row.DishAmountInt || 0), revenue = Number(row.DishDiscountSumInt || 0), kind = classify(row); if (kind === 'main') { mainDishesCount += qty; mainDishesRevenue += revenue; } if (kind === 'drinks') { drinksCount += qty; drinksRevenue += revenue; } if (kind === 'addons') { addonsCount += qty; addonsRevenue += revenue; } });
  const cashierUpsell = {};
  cashierItems0.forEach((row) => { const name = row.Cashier || 'Не указан'; cashierUpsell[name] ||= { main: 0, drinks: 0, addons: 0 }; const kind = classify(row); const qty = Number(row.DishAmountInt || 0); if (kind !== 'ignore') cashierUpsell[name][kind] += qty; });
  cashiers.forEach((row) => { const stats = cashierUpsell[row.Cashier || 'Не указан'] || { main: 0, drinks: 0, addons: 0 }; row.mainCount = stats.main; row.drinkCount = stats.drinks; row.addonCount = stats.addons; row.drinkRate = stats.main ? ((stats.drinks / stats.main) * 100).toFixed(1) : '0'; row.addonRate = stats.main ? ((stats.addons / stats.main) * 100).toFixed(1) : '0'; });
  const totals = daily.reduce((result, row) => { result.totalRevenue += Number(row.DishDiscountSumInt || 0); result.totalGrossRevenue += Number(row.DishSumInt || 0); result.totalDiscount += Number(row.DiscountSum || 0); result.totalOrders += Number(row.UniqOrderId || 0); result.totalDishes += Number(row.DishAmountInt || 0); result.totalGuests += Number(row.GuestNum || 0); return result; }, { totalRevenue: 0, totalGrossRevenue: 0, totalDiscount: 0, totalOrders: 0, totalDishes: 0, totalGuests: 0 });
  const hourlyMap = {}; for (let hour = 0; hour < 24; hour += 1) { const key = String(hour).padStart(2, '0'); hourlyMap[key] = { hour: `${key}:00`, revenue: 0, orders: 0 }; }
  hourly0.forEach((row) => { const key = String(row['OpenTime.Minutes15'] || '00:00').split(':')[0]; if (hourlyMap[key]) { hourlyMap[key].revenue += Number(row.DishDiscountSumInt || 0); hourlyMap[key].orders += Number(row.UniqOrderId || 0); } });
  const totalUpsellRev = drinksRevenue + addonsRevenue;
  return { success: true, kpi: { ...totals, avgCheck: totals.totalOrders ? Math.round(totals.totalRevenue / totals.totalOrders) : 0, daysCount: daily.length }, daily,
    upsell: { mainDishesCount, mainDishesRevenue, drinksCount, drinksRevenue, drinkRatioQty: mainDishesCount ? ((drinksCount / mainDishesCount) * 100).toFixed(1) : '0', drinkRatioRev: mainDishesRevenue ? ((drinksRevenue / mainDishesRevenue) * 100).toFixed(1) : '0', addonsCount, addonsRevenue, addonRatioQty: mainDishesCount ? ((addonsCount / mainDishesCount) * 100).toFixed(1) : '0', addonRatioRev: mainDishesRevenue ? ((addonsRevenue / mainDishesRevenue) * 100).toFixed(1) : '0', totalUpsellRev, upsellShare: totals.totalRevenue ? ((totalUpsellRev / totals.totalRevenue) * 100).toFixed(1) : '0' },
    payments: payments0.sort((a, b) => (b.DishDiscountSumInt || 0) - (a.DishDiscountSumInt || 0)), topDishes: dishes.slice(0, 20), hourly: Object.values(hourlyMap), cashiers };
}
async function fetchShifts(departmentId, dates) {
  const [shiftResponse, employees] = await Promise.all([iikoFetch(`/resto/api/v2/cashshifts/list?openDateFrom=${dates.from}&openDateTo=${dates.toInclusive}&status=ANY`), getEmployeesMap()]);
  if (shiftResponse.status !== 200) throw new Error(`iiko shifts: ${shiftResponse.status}`); let shifts = jsonBody(shiftResponse.body); if (!Array.isArray(shifts)) shifts = [];
  if (departmentId && departmentId !== 'ALL') { const rows = await olap({ reportType: 'SALES', buildSummary: false, groupByRowFields: ['SessionNum'], aggregateFields: ['DishDiscountSumInt'], filters: salesFilters(dates, departmentId) }); const sessions = new Set(rows.map((row) => Number(row.SessionNum))); shifts = shifts.filter((row) => sessions.has(Number(row.sessionNumber))); }
  return { success: true, shifts: shifts.map((row) => ({ id: row.id, sessionNumber: row.sessionNumber, status: row.sessionStatus, openDate: row.openDate, closeDate: row.closeDate, manager: employees[row.managerId] ? employees[row.managerId].name : 'Не указан', responsible: employees[row.responsibleUserId] ? employees[row.responsibleUserId].name : 'Не указан', payOrders: row.payOrders || 0, salesCash: row.salesCash || 0, salesCard: row.salesCard || 0, cashDiff: row.cashDiff || 0 })).sort((a, b) => b.sessionNumber - a.sessionNumber) };
}
async function fetchRanking(departmentId, dates) {
  const rows = await olap({ reportType: 'SALES', buildSummary: false, groupByRowFields: ['Department', 'Department.Id'], aggregateFields: ['DishDiscountSumInt', 'UniqOrderId', 'DishDiscountSumInt.average'], filters: salesFilters(dates, departmentId) });
  return { success: true, ranking: rows.sort((a, b) => (b.DishDiscountSumInt || 0) - (a.DishDiscountSumInt || 0)) };
}
async function fetchMyMetrics(user, dates) {
  if ((!userScope(user).all && !userScope(user).ids.length) || !user.iiko_employee_code) fail(400, 'Для пользователя не заданы точки и табельный код iiko', 'PROFILE_INCOMPLETE');
  const filters = salesFilters(dates, userScope(user).all ? null : userScope(user).ids, null, user.iiko_employee_code);
  const [summary, upsell] = await Promise.all([
    olap({ reportType: 'SALES', buildSummary: false, groupByRowFields: ['Cashier', 'Cashier.Code'], aggregateFields: ['DishDiscountSumInt', 'UniqOrderId', 'DishDiscountSumInt.average'], filters }),
    olap({ reportType: 'SALES', buildSummary: false, groupByRowFields: ['DishGroup.TopParent', 'DishType'], aggregateFields: ['DishAmountInt'], filters })
  ]);
  const row = summary.find((item) => String(item['Cashier.Code'] || '') === String(user.iiko_employee_code)) || {}; let main = 0, drinks = 0, addons = 0;
  upsell.forEach((item) => { const group = String(item['DishGroup.TopParent'] || ''), type = String(item.DishType || ''), qty = Number(item.DishAmountInt || 0); if (group.includes('Напитки') || group.toLowerCase().includes('коктейл')) drinks += qty; else if (group.includes('Модификаторы') || type === 'MODIFIER' || group.includes('УБРАТЬ')) addons += qty; else if (!group.includes('Сервисный сбор')) main += qty; });
  const revenue = Number(row.DishDiscountSumInt || 0), orders = Number(row.UniqOrderId || 0);
  return { success: true, cashier: row.Cashier || user.iiko_employee_name || user.full_name, cashierCode: user.iiko_employee_code, revenue, orders, avgCheck: orders ? Math.round(revenue / orders) : 0, drinkRate: main ? ((drinks / main) * 100).toFixed(1) : '0', addonRate: main ? ((addons / main) * 100).toFixed(1) : '0' };
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api', (req, res, next) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? sameOrigin(req, res, next) : next());
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, handler: (req, res) => sendError(res, 429, 'Слишком много попыток входа', 'RATE_LIMITED') });

app.post('/api/auth/login', loginLimiter, asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body && req.body.username); const password = req.body && req.body.password;
  if (typeof password !== 'string' || password.length > 256) fail(401, 'Неверный логин или пароль', 'INVALID_CREDENTIALS');
  const user = (await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE username = $1 AND active = TRUE`, [username])).rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) fail(401, 'Неверный логин или пароль', 'INVALID_CREDENTIALS');
  const session = await createSession(user.id); res.cookie('burzhui_session', session.token, cookieOptions());
  return res.json({ success: true, user: userView(user) });
}));
app.post('/api/auth/logout', authMiddleware, asyncHandler(async (req, res) => { await pool.query('DELETE FROM sessions WHERE token_hash = $1', [req.sessionTokenHash]); res.clearCookie('burzhui_session', cookieOptions()); return res.json({ success: true }); }));
app.get('/api/auth/me', authMiddleware, (req, res) => res.json({ success: true, user: userView(req.user) }));
app.patch('/api/auth/password', authMiddleware, asyncHandler(async (req, res) => {
  if (!(await verifyPassword(req.body && req.body.current_password, req.user.password_hash))) fail(401, 'Текущий пароль неверен', 'INVALID_CREDENTIALS');
  validatePassword(req.body && req.body.new_password); const hash = await hashPassword(req.body.new_password);
  await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);
  await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.id, req.sessionTokenHash]); return res.json({ success: true });
}));

app.get('/api/users', authMiddleware, requireRoles('developer', 'supervisor', 'manager'), asyncHandler(async (req, res) => {
  const rows = (await pool.query(`SELECT ${USER_COLUMNS} FROM users${req.user.role === 'developer' ? '' : ' WHERE "role" = \'employee\''} ORDER BY full_name`)).rows;
  const users = req.user.role === 'developer' ? rows : rows.filter((row) => req.user.role === 'supervisor' ? scopesOverlap(userScope(req.user), userScope(row)) : scopeIsSubset(userScope(row), userScope(req.user)));
  return res.json({ success: true, users: users.map(userView) });
}));
app.post('/api/users', authMiddleware, requireRoles('developer', 'manager'), asyncHandler(async (req, res) => {
  const body = req.body || {}; const role = normalizeRole(body.role); const username = normalizeUsername(body.username); const name = boundedString(body.full_name, 'full_name', 200, true);
  const departmentName = boundedString(body.department_name, 'department_name', 200); const iikoName = boundedString(body.iiko_employee_name, 'iiko_employee_name', 200); const iikoCode = boundedString(body.iiko_employee_code, 'iiko_employee_code', 100);
  validatePassword(body.password);
  if (req.user.role === 'manager' && role !== 'employee') fail(403, 'Менеджер может создавать только сотрудников', 'FORBIDDEN');
  const scope = scopeForRequest(body, null, role, req.user.role === 'manager' ? req.user : null);
  await ensureIikoCodeAvailable(iikoCode, scope);
  const departmentId = scope.all ? null : scope.ids[0];
  try {
    const result = await pool.query(`INSERT INTO users (id, username, full_name, "role", department_id, department_name, department_ids, all_departments, iiko_employee_name, iiko_employee_code, active, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11) RETURNING ${USER_COLUMNS}`, [crypto.randomUUID(), username, name, role, departmentId, departmentName, scope.ids, scope.all, iikoName, iikoCode, await hashPassword(body.password)]);
    return res.status(201).json({ success: true, user: userView(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') fail(409, 'Пользователь с таким логином уже существует', 'USERNAME_EXISTS');
    throw error;
  }
}));
app.patch('/api/users/:id', authMiddleware, asyncHandler(async (req, res) => {
  const body = req.body || {}; const target = await getUserById(req.params.id); if (!target) fail(404, 'Пользователь не найден', 'NOT_FOUND');
  const self = target.id === req.user.id; const targetScope = userScope(target);
  if (req.user.role === 'supervisor') fail(403, 'Управляющий не может изменять сотрудников', 'FORBIDDEN');
  if (req.user.role === 'manager' && (target.role !== 'employee' || !scopeIsSubset(targetScope, userScope(req.user)))) fail(403, 'Нет доступа к этому сотруднику', 'FORBIDDEN');
  if (req.user.role === 'employee' && (!self || Object.keys(body).some((key) => !['current_password', 'password'].includes(key)))) fail(403, 'Сотрудник может менять только свой пароль', 'FORBIDDEN');
  const nextRole = body.role === undefined ? target.role : normalizeRole(body.role);
  if (req.user.role !== 'developer' && body.role !== undefined) fail(403, 'Только developer может менять роли', 'FORBIDDEN');
  if (req.user.role === 'manager' && nextRole !== 'employee') fail(403, 'Менеджер может изменять только сотрудников', 'FORBIDDEN');
  const hasScopeFields = ['department_ids', 'all_departments', 'department_id'].some((key) => Object.prototype.hasOwnProperty.call(body, key));
  let scope = targetScope;
  if (req.user.role !== 'employee' && (hasScopeFields || body.role !== undefined)) {
    if (body.role !== undefined && isNetworkRole(nextRole) && !hasScopeFields) scope = { all: true, ids: [] };
    else if (body.role !== undefined && !isNetworkRole(nextRole) && isNetworkRole(target.role) && !hasScopeFields) fail(400, 'Для этой роли назначьте точки', 'SCOPE_REQUIRED');
    else scope = scopeForRequest(body, target, nextRole, req.user.role === 'manager' ? req.user : null);
  }
  const fields = []; const values = []; const add = (column, value) => { fields.push(`${column} = $${values.length + 1}`); values.push(value); };
  if (body.username !== undefined) add('username', normalizeUsername(body.username));
  if (body.full_name !== undefined) add('full_name', boundedString(body.full_name, 'full_name', 200, true));
  if (body.department_name !== undefined) add('department_name', boundedString(body.department_name, 'department_name', 200));
  if (body.iiko_employee_name !== undefined) add('iiko_employee_name', boundedString(body.iiko_employee_name, 'iiko_employee_name', 200));
  if (body.iiko_employee_code !== undefined) add('iiko_employee_code', boundedString(body.iiko_employee_code, 'iiko_employee_code', 100));
  if (body.active !== undefined) { if (typeof body.active !== 'boolean') fail(400, 'Поле active должно быть boolean', 'VALIDATION_ERROR'); if (self && !body.active) fail(400, 'Нельзя деактивировать текущего пользователя', 'VALIDATION_ERROR'); add('active', body.active); }
  if (body.role !== undefined) add('"role"', nextRole);
  if (req.user.role !== 'employee' && (hasScopeFields || body.role !== undefined)) { add('department_ids', scope.ids); add('all_departments', scope.all); add('department_id', scope.all ? null : scope.ids[0]); }
  if (body.password !== undefined) { if (req.user.role === 'employee' && !(await verifyPassword(body.current_password, req.user.password_hash))) fail(401, 'Текущий пароль неверен', 'INVALID_CREDENTIALS'); validatePassword(body.password); add('password_hash', await hashPassword(body.password)); }
  if (body.iiko_employee_code !== undefined || hasScopeFields || body.role !== undefined) await ensureIikoCodeAvailable(body.iiko_employee_code === undefined ? target.iiko_employee_code : boundedString(body.iiko_employee_code, 'iiko_employee_code', 100), scope, target.id);
  if (!fields.length) fail(400, 'Нет изменений', 'VALIDATION_ERROR'); fields.push('updated_at = NOW()'); values.push(target.id);
  let updated;
  try {
    updated = (await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING ${USER_COLUMNS}`, values)).rows[0];
  } catch (error) {
    if (error.code === '23505') fail(409, 'Пользователь с таким логином уже существует', 'USERNAME_EXISTS');
    throw error;
  }
  if (req.body.active === false || req.body.password !== undefined) await pool.query('DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR token_hash <> $2)', [target.id, self ? req.sessionTokenHash : null]);
  return res.json({ success: true, user: userView(updated) });
}));

app.get('/api/tasks', authMiddleware, asyncHandler(async (req, res) => res.json({ success: true, tasks: await listTasks(req.user) })));
app.get('/api/tasks/:id', authMiddleware, asyncHandler(async (req, res) => { const task = await getTask(idValue(req.params.id)); if (!task) fail(404, 'Задача не найдена', 'NOT_FOUND'); return res.json({ success: true, task: await taskDetail(task, req.user) }); }));
app.post('/api/tasks', authMiddleware, requireRoles('developer', 'supervisor', 'manager'), asyncHandler(async (req, res) => {
  const body = req.body || {}; const title = boundedString(body.title, 'title', 200, true); const description = boundedString(body.description, 'description', 50000); const status = normalizeStatus(body.status || 'new'); const priority = normalizePriority(body.priority || 'normal'); const dueAt = body.due_at ? new Date(body.due_at) : null; if (dueAt && Number.isNaN(dueAt.getTime())) fail(400, 'Некорректная дата выполнения', 'VALIDATION_ERROR');
  let departmentId = body.department_id ? boundedString(body.department_id, 'department_id', 128) : null; let departmentName = boundedString(body.department_name, 'department_name', 200); const assigneeId = body.assignee_id ? String(body.assignee_id) : null;
  const assignee = assigneeId ? await getUserById(assigneeId) : null;
  if (assignee && !departmentId) {
    const assigneeScope = userScope(assignee);
    if (!assigneeScope.all && assigneeScope.ids.length === 1) { departmentId = assigneeScope.ids[0]; departmentName = assignee.department_name; }
  }
  validateTaskDepartment(req.user, departmentId);
  if (assigneeId) validateTaskAssignee(assignee, departmentId);
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await client.query('INSERT INTO tasks (title,description,status,priority,department_id,department_name,creator_id,assignee_id,due_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [title, description, status, priority, departmentId, departmentName, req.user.id, assigneeId, dueAt]); await client.query('INSERT INTO task_events (task_id,user_id,event_type,payload) VALUES ($1,$2,$3,$4::jsonb)', [result.rows[0].id, req.user.id, 'task_created', JSON.stringify({ status, priority, due_at: dueAt })]); await client.query('COMMIT'); const task = await getTask(result.rows[0].id); return res.status(201).json({ success: true, task: await taskDetail(task, req.user) }); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}));
app.patch('/api/tasks/:id', authMiddleware, asyncHandler(async (req, res) => {
  const taskId = idValue(req.params.id); const task = await getTask(taskId); if (!task) fail(404, 'Задача не найдена', 'NOT_FOUND'); if (!canAccessTask(task, req.user)) fail(403, 'Нет доступа к задаче', 'FORBIDDEN');
  const body = req.body || {}; const keys = Object.keys(body);
  if (req.user.role === 'employee' && (task.assignee_id !== req.user.id || keys.some((key) => key !== 'status'))) fail(403, 'Исполнитель может менять только статус своей задачи', 'FORBIDDEN');
  if (req.user.role === 'employee' && body.status === 'done') fail(403, 'Завершить задачу может только manager, supervisor или developer', 'FORBIDDEN');
  const fields = []; const values = []; const add = (column, value) => { fields.push(`${column} = $${values.length + 1}`); values.push(value); };
  if (body.title !== undefined) add('title', boundedString(body.title, 'title', 200, true));
  if (body.description !== undefined) add('description', boundedString(body.description, 'description', 50000));
  if (body.status !== undefined) add('status', normalizeStatus(body.status));
  if (body.priority !== undefined) add('priority', normalizePriority(body.priority));
  if (body.due_at !== undefined) { const due = body.due_at === null ? null : new Date(body.due_at); if (due && Number.isNaN(due.getTime())) fail(400, 'Некорректная дата выполнения', 'VALIDATION_ERROR'); add('due_at', due); }
  const nextDepartmentId = body.department_id === undefined ? task.department_id : boundedString(body.department_id, 'department_id', 128);
  const nextDepartmentName = body.department_name === undefined ? task.department_name : boundedString(body.department_name, 'department_name', 200);
  if (body.department_id !== undefined || body.department_name !== undefined) { if (!['developer', 'supervisor', 'manager'].includes(req.user.role)) fail(403, 'Недостаточно прав для смены точки задачи', 'FORBIDDEN'); validateTaskDepartment(req.user, nextDepartmentId); if (body.department_id !== undefined) add('department_id', nextDepartmentId); if (body.department_name !== undefined) add('department_name', nextDepartmentName); }
  if (body.assignee_id !== undefined) { if (!['developer', 'supervisor', 'manager'].includes(req.user.role)) fail(403, 'Недостаточно прав для смены исполнителя', 'FORBIDDEN'); const assignee = body.assignee_id ? await getUserById(String(body.assignee_id)) : null; if (assignee) validateTaskAssignee(assignee, nextDepartmentId); add('assignee_id', assignee ? assignee.id : null); }
  if (body.assignee_id === undefined && task.assignee_id && body.department_id !== undefined) { const currentAssignee = await getUserById(task.assignee_id); if (currentAssignee) validateTaskAssignee(currentAssignee, nextDepartmentId); }
  if (!['employee'].includes(req.user.role) && body.department_id === undefined && !canAccessTask(task, req.user)) fail(403, 'Нет доступа к точке задачи', 'FORBIDDEN');
  if (!fields.length) fail(400, 'Нет изменений', 'VALIDATION_ERROR'); fields.push('updated_at = NOW()'); values.push(taskId);
  await pool.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = $${values.length}`, values); await taskEvent(taskId, req.user.id, 'task_updated', { fields: keys });
  const updated = await getTask(taskId); return res.json({ success: true, task: await taskDetail(updated, req.user) });
}));
app.post('/api/tasks/:id/comments', authMiddleware, asyncHandler(async (req, res) => {
  const task = await getTask(idValue(req.params.id)); if (!task || !canAccessTask(task, req.user)) fail(404, 'Задача не найдена', 'NOT_FOUND');
  const body = boundedString(req.body && req.body.body, 'body', 20000, true); const kind = req.body && req.body.kind ? req.body.kind : 'comment'; if (!['comment', 'report'].includes(kind)) fail(400, 'Недопустимый тип комментария', 'VALIDATION_ERROR');
  const result = await pool.query('INSERT INTO task_comments (task_id,user_id,body,kind) VALUES ($1,$2,$3,$4) RETURNING id,task_id,user_id,body,kind,created_at', [task.id, req.user.id, body, kind]); await pool.query('UPDATE tasks SET updated_at = NOW() WHERE id = $1', [task.id]); await taskEvent(task.id, req.user.id, 'comment_added', { kind });
  return res.status(201).json({ success: true, comment: { ...result.rows[0], user_name: req.user.full_name } });
}));
app.post('/api/tasks/:id/attachments', authMiddleware, upload.single('photo'), asyncHandler(async (req, res) => {
  const task = await getTask(idValue(req.params.id)); if (!task || !canAccessTask(task, req.user)) fail(404, 'Задача не найдена', 'NOT_FOUND'); if (!req.file) fail(400, 'Поле photo обязательно', 'INVALID_ATTACHMENT'); validImage(req.file);
  const id = crypto.randomUUID(); const filename = path.basename(req.file.originalname || 'photo').replace(/[\r\n]/g, '_').slice(0, 255) || 'photo';
  await pool.query('INSERT INTO task_attachments (id,task_id,user_id,filename,mime_type,size_bytes,data) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, task.id, req.user.id, filename, req.file.mimetype, req.file.size, req.file.buffer]); await pool.query('UPDATE tasks SET updated_at = NOW() WHERE id = $1', [task.id]); await taskEvent(task.id, req.user.id, 'attachment_added', { attachment_id: id, mime_type: req.file.mimetype, size_bytes: req.file.size });
  return res.status(201).json({ success: true, attachment: { id, task_id: task.id, filename, mime_type: req.file.mimetype, size_bytes: req.file.size } });
}));
app.get('/api/attachments/:id', authMiddleware, asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) fail(400, 'Некорректный идентификатор вложения', 'INVALID_ID');
  const row = (await pool.query('SELECT a.*, t.department_id, t.assignee_id, t.creator_id FROM task_attachments a JOIN tasks t ON t.id = a.task_id WHERE a.id = $1', [req.params.id])).rows[0]; if (!row || !canAccessTask(row, req.user)) fail(404, 'Вложение не найдено', 'NOT_FOUND');
  res.set('Content-Type', row.mime_type); res.set('Content-Length', String(row.size_bytes)); res.set('Content-Disposition', `inline; filename="${row.filename.replace(/["\\\r\n]/g, '_')}"`); return res.send(row.data);
}));
app.get('/api/task-stats', authMiddleware, asyncHandler(async (req, res) => {
  let query = 'SELECT status, COUNT(*)::int AS count FROM tasks'; const params = []; if (req.user.role === 'supervisor') { const scope = userScope(req.user); if (!scope.all) { query += ' WHERE department_id = ANY($1::text[])'; params.push(scope.ids); } } if (req.user.role === 'manager') { const scope = userScope(req.user); if (scope.all) query += ' WHERE department_id IS NOT NULL'; else { query += ' WHERE department_id = ANY($1::text[])'; params.push(scope.ids); } } if (req.user.role === 'employee') { query += ' WHERE assignee_id = $1'; params.push(req.user.id); } query += ' GROUP BY status';
  const stats = { total: 0, new: 0, in_progress: 0, review: 0, done: 0 }; (await pool.query(query, params)).rows.forEach((row) => { stats[row.status] = row.count; stats.total += row.count; }); return res.json({ success: true, stats });
}));

app.get('/api/departments', authMiddleware, requireRoles('developer', 'supervisor', 'manager'), asyncHandler(async (req, res) => { const departments = await fetchDepartments(); const scope = userScope(req.user); return res.json({ success: true, departments: scope.all ? departments : departments.filter((item) => scope.ids.includes(item.id)) }); }));
app.get('/api/sales', authMiddleware, requireRoles('developer', 'supervisor'), asyncHandler(async (req, res) => res.json(await fetchSales(scopedDepartment(req, req.query.departmentId || 'ALL'), dateRange(req.query)))));
app.get('/api/shifts', authMiddleware, requireRoles('developer', 'supervisor'), asyncHandler(async (req, res) => res.json(await fetchShifts(scopedDepartment(req, req.query.departmentId || 'ALL'), dateRange(req.query)))));
app.get('/api/ranking', authMiddleware, requireRoles('developer', 'supervisor'), asyncHandler(async (req, res) => res.json(await fetchRanking(scopedDepartment(req, req.query.departmentId || 'ALL'), dateRange(req.query)))));
app.get('/api/my-metrics', authMiddleware, requireRoles('employee'), asyncHandler(async (req, res) => res.json(await fetchMyMetrics(req.user, dateRange(req.query)))));

const PUBLIC_ROOT = path.resolve(__dirname, 'dist');
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
function staticPath(urlPath) {
  let decoded; try { decoded = decodeURIComponent(urlPath); } catch (_) { return null; }
  if (decoded.includes('\0')) return null; const result = path.resolve(PUBLIC_ROOT, `.${decoded === '/' ? '/index.html' : decoded}`); if (result !== PUBLIC_ROOT && !result.startsWith(`${PUBLIC_ROOT}${path.sep}`)) return null; return result;
}
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next(); const requested = staticPath(req.path); if (!requested) return sendError(res, 403, 'Недопустимый путь', 'INVALID_PATH');
  fs.stat(requested, (error, stats) => { const actual = !error && stats.isFile() ? requested : path.join(PUBLIC_ROOT, 'index.html'); fs.readFile(actual, (readError, content) => { if (readError) return next(readError); res.type(MIME_TYPES[path.extname(actual).toLowerCase()] || 'application/octet-stream'); res.set('Cache-Control', actual.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'); return res.send(content); }); });
});
app.use((req, res) => sendError(res, 404, 'Ресурс не найден', 'NOT_FOUND'));
app.use((error, req, res, next) => { if (res.headersSent) return next(error); const status = error instanceof AppError ? error.status : error.code === 'LIMIT_FILE_SIZE' ? 413 : 500; const message = error instanceof AppError ? error.message : status === 413 ? 'Файл слишком большой' : 'Внутренняя ошибка сервера'; console.error('[BURЖУЙ] request error', req.method, req.path, error.code || error.name || 'Error', error.message || 'unknown'); return sendError(res, status, message, error instanceof AppError ? error.code : 'INTERNAL_ERROR'); });

let server; let cleanupTimer;
async function start() { await initializeDatabase(); cleanupTimer = setInterval(() => pool.query('DELETE FROM sessions WHERE expires_at <= NOW()').catch(() => {}), 60 * 60 * 1000); server = app.listen(PORT, () => console.log(`[BURЖУЙ] Сервер запущен на порту ${PORT}`)); }
async function shutdown(signal) { console.log(`[BURЖУЙ] Завершение работы (${signal})`); if (cleanupTimer) clearInterval(cleanupTimer); if (server) await new Promise((resolve) => server.close(resolve)); await pool.end(); process.exit(0); }
process.once('SIGTERM', () => shutdown('SIGTERM')); process.once('SIGINT', () => shutdown('SIGINT'));
start().catch((error) => { console.error('[BURЖУЙ] Не удалось запустить сервер:', error.code || error.name || 'startup_error', error.message || 'unknown'); pool.end().finally(() => process.exit(1)); });
