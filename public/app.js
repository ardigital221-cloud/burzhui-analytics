/* BURЖУЙ Команда — client-only application shell.
 * Auth relies on the server HttpOnly session cookie. No tokens or sensitive data
 * are written to browser storage.
 */
(function () {
  'use strict';

  var ROLE_LABELS = { developer: 'Разработчик', manager: 'Менеджер', employee: 'Сотрудник' };
  var STATUS_LABELS = { new: 'Новые', in_progress: 'В работе', review: 'На проверке', done: 'Готово' };
  var STATUS_SHORT = { new: 'Новая', in_progress: 'В работе', review: 'Проверка', done: 'Готово' };
  var PRIORITY_LABELS = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', urgent: 'Срочный' };
  var NAV_ICONS = { overview: '⌂', tasks: '✓', team: '♙', analytics: '◌', profile: '◎' };
  var VIEW_TITLES = { overview: 'Обзор', tasks: 'Задачи', team: 'Команда', analytics: 'Аналитика', profile: 'Профиль' };

  var state = {
    user: null,
    users: [],
    departments: [],
    tasks: [],
    taskError: '',
    usersError: '',
    departmentsError: '',
    activeView: 'overview',
    taskFilter: { status: 'all', priority: 'all', query: '' },
    analytics: { from: '', to: '', departmentId: 'ALL', sales: null, shifts: [], ranking: [], loading: false, error: '' },
    taskStats: null,
    metrics: null,
    loading: false,
    modal: null,
    pendingPhoto: null,
    charts: { daily: null, hourly: null }
  };

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $all(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  window.escapeHtml = escapeHtml;
  function number(value) { var parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function money(value) { return Math.round(number(value)).toLocaleString('ru-RU') + ' ₸'; }
  function compactNumber(value) { return Math.round(number(value)).toLocaleString('ru-RU'); }
  function percent(value) { return number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%'; }
  function shortDate(value) {
    if (!value) return '—';
    var raw = String(value).slice(0, 10).split('-');
    return raw.length === 3 ? raw[2] + '.' + raw[1] : String(value);
  }
  function fullDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function dateTime(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' · ' +
      date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  function todayString() { return new Date().toISOString().slice(0, 10); }
  function dateDaysAgo(days) {
    var date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  }
  function getInitials(value) {
    var words = String(value || '—').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map(function (word) { return word.charAt(0); }).join('').toUpperCase() || '—';
  }
  function roleLabel(role) { return ROLE_LABELS[role] || 'Пользователь'; }
  function roleOf(user) { return String((user && (user.role || user.userRole)) || '').toLowerCase(); }
  function currentRole() { return roleOf(state.user); }
  function canManageTeam() { return currentRole() === 'developer' || currentRole() === 'manager'; }
  function canEditUser(user) { return currentRole() === 'developer' || (currentRole() === 'manager' && user && user.role === 'employee'); }
  function canManageTask(task) {
    if (currentRole() === 'developer' || currentRole() === 'manager') return true;
    if (!task || !state.user) return false;
    return String(task.assigneeId || '') === String(state.user.id || '');
  }
  function normalizeUser(raw) {
    raw = raw || {};
    return {
      id: raw.id || raw.userId || raw._id || '',
      name: raw.name || raw.full_name || raw.fullName || raw.displayName || raw.username || 'Без имени',
      fullName: raw.full_name || raw.fullName || raw.name || raw.displayName || '',
      username: raw.username || raw.login || '',
      role: roleOf(raw) || 'employee',
      departmentId: raw.department_id || raw.departmentId || raw.department && (raw.department.id || raw.department_id || raw.departmentId) || '',
      departmentName: raw.department_name || raw.departmentName || raw.department && raw.department.name || '',
      iikoCashierName: raw.iiko_employee_name || raw.iikoCashierName || raw.cashierName || '',
      iikoCashierCode: raw.iiko_employee_code || raw.iikoCashierCode || raw.cashierCode || '',
      active: raw.active !== false && raw.isActive !== false
    };
  }
  function normalizeTask(raw) {
    raw = raw || {};
    var comments = Array.isArray(raw.comments) ? raw.comments.map(function (comment) {
      return Object.assign({}, comment, { authorName: comment.authorName || comment.user_name || comment.userName || '' });
    }) : [];
    var attachments = Array.isArray(raw.attachments) ? raw.attachments : [];
    return {
      id: raw.id || raw.taskId || raw._id || '',
      title: raw.title || raw.name || 'Без названия',
      description: raw.description || raw.body || '',
      status: STATUS_LABELS[raw.status] ? raw.status : 'new',
      priority: PRIORITY_LABELS[raw.priority] ? raw.priority : 'normal',
      deadline: raw.due_at || raw.deadline || raw.dueDate || raw.deadlineAt || '',
      createdAt: raw.createdAt || raw.created_at || '',
      updatedAt: raw.updatedAt || raw.updated_at || '',
      assigneeId: raw.assignee_id || raw.assigneeId || raw.assignee && raw.assignee.id || '',
      assigneeName: raw.assignee_name || raw.assigneeName || '',
      assignee: raw.assignee && typeof raw.assignee === 'object' ? normalizeUser(raw.assignee) : null,
      departmentId: raw.department_id || raw.departmentId || raw.department && raw.department.id || '',
      departmentName: raw.department_name || raw.departmentName || typeof raw.department === 'string' && raw.department || raw.department && raw.department.name || '',
      creatorId: raw.creator_id || raw.creatorId || raw.createdById || '',
      comments: comments,
      attachments: attachments,
      raw: raw
    };
  }
  function departmentId(department) { return String(department && (department.id || department.departmentId || department._id) || ''); }
  function departmentName(department) { return department && (department.name || department.title || department.code) || 'Без точки'; }
  function findUser(id) {
    var item = state.users.find(function (user) { return String(user.id) === String(id); });
    return item || null;
  }
  function findDepartment(id) {
    return state.departments.find(function (department) { return String(departmentId(department)) === String(id); }) || null;
  }
  function taskAssignee(task) {
    return task.assignee || findUser(task.assigneeId) || (task.assigneeName ? { name: task.assigneeName } : null);
  }
  function taskDepartment(task) {
    return task.departmentName || (findDepartment(task.departmentId) && departmentName(findDepartment(task.departmentId))) || 'Общая';
  }
  function isOverdue(task) {
    if (!task.deadline || task.status === 'done') return false;
    var date = new Date(task.deadline);
    return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
  }
  function optionList(items, selected, getValue, getLabel, emptyLabel) {
    var html = emptyLabel ? '<option value=\"\">' + escapeHtml(emptyLabel) + '</option>' : '';
    return html + items.map(function (item) {
      var value = getValue(item);
      return '<option value=\"' + escapeHtml(value) + '\"' + (String(value) === String(selected) ? ' selected' : '') + '>' +
        escapeHtml(getLabel(item)) + '</option>';
    }).join('');
  }

  function toast(message, type) {
    var root = $('#toast-root');
    if (!root) return;
    var item = document.createElement('div');
    item.className = 'toast ' + (type || '');
    item.innerHTML = '<span class=\"toast-mark\">' + (type === 'error' ? '!' : '✦') + '</span><span>' + escapeHtml(message) + '</span>';
    root.appendChild(item);
    window.setTimeout(function () { item.remove(); }, 4200);
  }
  function setBusy(button, busy) {
    if (!button) return;
    button.classList.toggle('is-busy', Boolean(busy));
    button.disabled = Boolean(busy);
  }
  function apiError(message, status) { this.message = message; this.status = status; this.name = 'ApiError'; }
  apiError.prototype = Object.create(Error.prototype);
  function sessionExpired() {
    if (state.user) toast('Сессия завершена. Войдите снова.', 'error');
    state.user = null;
    state.modal = null;
    $('#app-screen').classList.add('is-hidden');
    $('#auth-screen').classList.remove('is-hidden');
    $('#login-password').value = '';
  }
  async function api(path, options) {
    options = options || {};
    var headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
    var request = { method: options.method || 'GET', credentials: 'same-origin', headers: headers };
    if (options.body instanceof FormData) {
      request.body = options.body;
    } else if (options.body !== undefined && options.body !== null) {
      headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(options.body);
    }
    var response;
    try {
      response = await fetch(path, request);
    } catch (error) {
      throw new apiError('Нет соединения с сервером.', 0);
    }
    if (response.status === 401) {
      sessionExpired();
      throw new apiError('Сессия завершена.', 401);
    }
    var data;
    try { data = await response.json(); } catch (error) { data = {}; }
    if (!response.ok || data.success === false) {
      throw new apiError(data.error || 'Не удалось выполнить запрос.', response.status);
    }
    return data;
  }
  function entity(data, key, fallback) {
    if (!data) return fallback;
    if (data[key] !== undefined) return data[key];
    if (data.data && data.data[key] !== undefined) return data.data[key];
    if (data.data !== undefined && key === 'data') return data.data;
    return fallback;
  }

  function renderNav() {
    var role = currentRole();
    var items = [{ key: 'overview', label: 'Обзор' }, { key: 'tasks', label: 'Задачи' }];
    if (role === 'developer' || role === 'manager') items.push({ key: 'team', label: 'Сотрудники' });
    if (role === 'developer' || role === 'manager') items.push({ key: 'analytics', label: 'Аналитика' });
    items.push({ key: 'profile', label: 'Профиль' });
    var markup = items.map(function (item) {
      return '<button class=\"nav-item' + (state.activeView === item.key ? ' active' : '') + '\" type=\"button\" data-view=\"' +
        item.key + '\"><span class=\"nav-icon\">' + NAV_ICONS[item.key] + '</span><span class=\"nav-label\">' +
        item.label + '</span></button>';
    }).join('');
    $('#desktop-nav').innerHTML = markup;
    var mobileItems = items.filter(function (item) { return item.key !== 'team'; }).slice(0, 4);
    $('#mobile-nav').innerHTML = mobileItems.map(function (item) {
      return '<button class=\"nav-item' + (state.activeView === item.key ? ' active' : '') + '\" type=\"button\" data-view=\"' +
        item.key + '\"><span class=\"nav-icon\">' + NAV_ICONS[item.key] + '</span><span class=\"nav-label\">' + item.label + '</span></button>';
    }).join('');
    $all('[data-view]', $('#desktop-nav')).concat($all('[data-view]', $('#mobile-nav'))).forEach(function (node) {
      node.addEventListener('click', function () { goTo(node.getAttribute('data-view')); });
    });
  }
  function updateHeader() {
    var name = state.user ? (state.user.name || state.user.fullName || state.user.username) : '—';
    $('#header-name').textContent = name || '—';
    $('#header-role').textContent = roleLabel(currentRole());
    $('#header-avatar').textContent = getInitials(name);
    $('#page-title').textContent = VIEW_TITLES[state.activeView] || 'Обзор';
    $('#header-kicker').textContent = currentRole() === 'employee' ? 'ЛИЧНЫЙ КАБИНЕТ' : 'BURЖУЙ · КОМАНДА';
  }
  function goTo(view) {
    var allowed = ['overview', 'tasks', 'profile'];
    if (currentRole() === 'developer' || currentRole() === 'manager') allowed.push('team', 'analytics');
    state.activeView = allowed.indexOf(view) >= 0 ? view : 'overview';
    renderNav();
    updateHeader();
    $('#sidebar').classList.remove('is-open');
    renderView();
  }
  function viewSkeleton() {
    return '<div class=\"page-intro\"><div><div class=\"skeleton skeleton-line wide\" style=\"height:27px\"></div><div class=\"skeleton skeleton-line short\"></div></div></div>' +
      '<div class=\"kpi-grid\">' + [1, 2, 3, 4].map(function () { return '<div class=\"card kpi-card\"><div class=\"skeleton skeleton-line short\"></div><div class=\"skeleton skeleton-line wide\" style=\"height:27px;margin-top:22px\"></div><div class=\"skeleton skeleton-line short\"></div></div>'; }).join('') + '</div>';
  }

  async function loadDepartments() {
    if (state.departments.length) return state.departments;
    try {
      var data = await api('/api/departments');
      state.departments = (entity(data, 'departments', []) || []).map(function (item) { return item; });
      state.departmentsError = '';
    } catch (error) {
      if (error.status !== 401) state.departmentsError = error.message;
    }
    return state.departments;
  }
  async function loadUsers() {
    if (currentRole() === 'employee') return [];
    try {
      var data = await api('/api/users');
      state.users = (entity(data, 'users', []) || []).map(normalizeUser);
      state.usersError = '';
    } catch (error) {
      if (error.status !== 401) state.usersError = error.message;
    }
    return state.users;
  }
  async function loadTasks() {
    try {
      var data = await api('/api/tasks');
      state.tasks = (entity(data, 'tasks', []) || []).map(normalizeTask);
      if (currentRole() === 'employee' && state.user && state.user.id) {
        state.tasks = state.tasks.filter(function (task) { return String(task.assigneeId) === String(state.user.id); });
      }
      if (currentRole() === 'manager' && state.user && state.user.departmentId) {
        state.tasks = state.tasks.filter(function (task) { return !task.departmentId || String(task.departmentId) === String(state.user.departmentId); });
      }
      state.taskError = '';
    } catch (error) {
      if (error.status !== 401) state.taskError = error.message;
    }
    return state.tasks;
  }
  async function loadMyMetrics() {
    if (currentRole() !== 'employee') return null;
    try {
      var data = await api('/api/my-metrics?from=' + encodeURIComponent(state.analytics.from) + '&to=' + encodeURIComponent(state.analytics.to));
      state.metrics = { revenue: data.revenue, orders: data.orders, avgCheck: data.avgCheck, drinkRate: data.drinkRate, addonRate: data.addonRate };
    } catch (error) {
      if (error.status !== 401) state.metrics = null;
    }
    return state.metrics;
  }
  async function loadTaskStats() {
    if (currentRole() === 'employee') return null;
    try {
      var data = await api('/api/task-stats');
      state.taskStats = entity(data, 'stats', data.data || null);
    } catch (error) {
      if (error.status !== 401) state.taskStats = null;
    }
    return state.taskStats;
  }
  function analyticsDates() {
    if (!state.analytics.from) state.analytics.from = dateDaysAgo(6);
    if (!state.analytics.to) state.analytics.to = todayString();
  }
  async function loadAnalytics(options) {
    options = options || {};
    if (currentRole() === 'employee') return null;
    analyticsDates();
    state.analytics.loading = true;
    state.analytics.error = '';
    await loadDepartments();
    var department = state.analytics.departmentId;
    if (currentRole() === 'manager' && state.user && state.user.departmentId) department = state.user.departmentId;
    state.analytics.departmentId = department || 'ALL';
    try {
      var query = 'departmentId=' + encodeURIComponent(state.analytics.departmentId) + '&from=' +
        encodeURIComponent(state.analytics.from) + '&to=' + encodeURIComponent(state.analytics.to);
      var result = await Promise.all([
        api('/api/sales?' + query),
        api('/api/shifts?' + query),
        api('/api/ranking?from=' + encodeURIComponent(state.analytics.from) + '&to=' + encodeURIComponent(state.analytics.to))
      ]);
      state.analytics.sales = result[0];
      state.analytics.shifts = entity(result[1], 'shifts', []);
      state.analytics.ranking = entity(result[2], 'ranking', []);
    } catch (error) {
      if (error.status !== 401) state.analytics.error = error.message;
    } finally {
      state.analytics.loading = false;
    }
    return state.analytics.sales;
  }
  async function bootstrap() {
    try {
      var data = await api('/api/auth/me');
      var me = entity(data, 'user', entity(data, 'me', null));
      if (!me) throw new apiError('Не удалось определить пользователя.', 401);
      state.user = normalizeUser(me);
      $('#auth-screen').classList.add('is-hidden');
      $('#app-screen').classList.remove('is-hidden');
      analyticsDates();
      renderNav();
      updateHeader();
      await Promise.all([loadTasks(), loadUsers(), loadDepartments(), loadTaskStats()]);
      if (currentRole() === 'employee') await loadMyMetrics();
      else await loadAnalytics({ silent: true });
      goTo('overview');
    } catch (error) {
      if (error.status !== 401) {
        $('#login-error').textContent = '';
        $('#auth-screen').classList.remove('is-hidden');
        $('#app-screen').classList.add('is-hidden');
      }
    }
  }

  function commonPageIntro(title, subtitle, actions) {
    return '<div class=\"page-intro\"><div><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(subtitle) + '</p></div>' +
      (actions ? '<div class=\"page-intro-actions\">' + actions + '</div>' : '') + '</div>';
  }
  function emptyState(title, description, icon) {
    return '<div class=\"empty-state\"><div><span class=\"empty-icon\">' + (icon || '✦') + '</span><strong>' +
      escapeHtml(title) + '</strong><p>' + escapeHtml(description || '') + '</p></div></div>';
  }
  function errorPanel(message, retryAction) {
    return '<div class=\"error-panel\"><strong>Не удалось загрузить данные</strong><p>' + escapeHtml(message || 'Попробуйте ещё раз.') +
      '</p><button class=\"button button-secondary\" type=\"button\" data-action=\"' + (retryAction || 'refresh') + '\">Повторить</button></div>';
  }
  function kpiCard(label, value, foot, accent) {
    return '<div class=\"card kpi-card\"><div class=\"kpi-label\">' + escapeHtml(label) + '</div><div class=\"kpi-value ' +
      (accent || '') + '\">' + escapeHtml(value) + '</div><div class=\"kpi-foot\">' + escapeHtml(foot || '') + '</div></div>';
  }
  function getSalesKpi() {
    var sales = state.analytics.sales || {};
    return sales.kpi || sales.stats || {};
  }
  function getMetric(obj, keys) {
    for (var i = 0; i < keys.length; i += 1) if (obj && obj[keys[i]] !== undefined) return obj[keys[i]];
    return 0;
  }
  function taskMini(task) {
    var assignee = taskAssignee(task);
    return '<button class=\"task-mini\" type=\"button\" data-action=\"open-task\" data-task-id=\"' + escapeHtml(task.id) + '\">' +
      '<span class=\"status-dot status-dot-' + task.status + '\"></span><div class=\"task-mini-main\"><div class=\"task-mini-title\">' +
      escapeHtml(task.title) + '</div><div class=\"task-mini-meta\">' + escapeHtml(STATUS_SHORT[task.status]) + ' · ' +
      escapeHtml(assignee ? assignee.name : task.departmentName || 'Без назначения') + '</div></div><span class=\"caption\">›</span></button>';
  }
  function renderOverview() {
    var role = currentRole();
    var tasks = state.tasks.slice(0, 5);
    if (role === 'employee') {
      var metrics = state.metrics || {};
      return commonPageIntro('Добрый день, ' + (state.user.name || state.user.username) + ' 👋', 'Ваш рабочий ритм на сегодня.') +
        '<div class=\"kpi-grid\">' +
        kpiCard('Выручка', money(metrics.revenue), 'за выбранный период', 'kpi-accent') +
        kpiCard('Чеков', compactNumber(metrics.orders), 'ваши продажи', 'kpi-blue') +
        kpiCard('Средний чек', money(metrics.avgCheck), 'по вашим заказам', 'kpi-purple') +
        kpiCard('Апсейл', percent(metrics.drinkRate), 'напитки · допы ' + percent(metrics.addonRate), 'kpi-green') +
        '</div><div class=\"dashboard-grid\"><section class=\"card card-pad\"><div class=\"card-title\"><div><h3>Мои задачи</h3><p>Самое важное на ближайшее время</p></div><button class=\"button button-ghost\" type=\"button\" data-view=\"tasks\">Все задачи →</button></div>' +
        (state.taskError ? errorPanel(state.taskError) : tasks.length ? '<div class=\"task-preview-list\">' + tasks.map(taskMini).join('') + '</div>' : emptyState('Задач пока нет', 'Как только появится новая задача, она будет здесь.', '✓')) +
        '</section><section class=\"card card-pad\"><div class=\"card-title\"><div><h3>Ваш фокус</h3><p>Небольшая подсказка на смену</p></div></div><div class=\"metric-highlight\"><div class=\"metric-highlight-label\">Сегодня</div><div class=\"metric-highlight-value\">Работайте в ритме</div><div class=\"metric-highlight-foot\">Закройте одну задачу до конца — это уже хороший результат.</div></div></section></div>';
    }
    var kpi = getSalesKpi();
    var days = getMetric(kpi, ['daysCount']) || 1;
    var totalRevenue = getMetric(kpi, ['totalRevenue', 'revenue']);
    var orders = getMetric(kpi, ['totalOrders', 'orders']);
    var avgCheck = getMetric(kpi, ['avgCheck', 'averageCheck']) || (orders ? totalRevenue / orders : 0);
    var totalDishes = getMetric(kpi, ['totalDishes', 'dishes']);
    var roleIntro = role === 'manager' ? 'Показатели вашей точки и задачи команды.' : 'Ключевые показатели сети и командный фокус.';
    var actions = '<button class=\"button button-secondary\" type=\"button\" data-view=\"tasks\">Открыть задачи</button><button class=\"button button-primary\" type=\"button\" data-view=\"analytics\">Аналитика →</button>';
    return commonPageIntro('Добрый день, ' + (state.user.name || state.user.username) + ' 👋', roleIntro, actions) +
      '<div class=\"kpi-grid\">' + kpiCard('Выручка', money(totalRevenue), 'среднее ' + money(totalRevenue / days) + ' / день', 'kpi-accent') +
      kpiCard('Чеков', compactNumber(orders), 'за выбранный период', 'kpi-blue') +
      kpiCard('Средний чек', money(avgCheck), 'по всем заказам', 'kpi-purple') +
      kpiCard('Блюд', compactNumber(totalDishes) + ' шт.', 'в среднем ' + (orders ? (totalDishes / orders).toFixed(1) : '0') + ' в чеке', 'kpi-green') + '</div>' +
      '<div class=\"dashboard-grid\"><section class=\"card card-pad\"><div class=\"card-title\"><div><h3>Командный фокус</h3><p>Задачи, которые требуют внимания</p></div><button class=\"button button-ghost\" type=\"button\" data-view=\"tasks\">Все задачи →</button></div>' +
      (state.taskError ? errorPanel(state.taskError) : tasks.length ? '<div class=\"task-preview-list\">' + tasks.map(taskMini).join('') + '</div>' : emptyState('Фокус свободен', 'Новых задач на горизонте нет.', '✦')) +
      '</section><section class=\"card card-pad\"><div class=\"card-title\"><div><h3>Апсейл</h3><p>Допродажи в выбранном периоде</p></div><span class=\"status-badge status-in_progress\">iiko</span></div>' +
      '<div class=\"metric-highlight\"><div class=\"metric-highlight-label\">Доля допродаж в выручке</div><div class=\"metric-highlight-value\">' + escapeHtml(percent(getMetric(state.analytics.sales && state.analytics.sales.upsell, ['upsellShare']))) + '</div><div class=\"metric-highlight-foot\">Напитки и дополнительные позиции</div></div></section></div>';
  }

  function statusBadge(status) { return '<span class=\"status-badge status-' + status + '\">' + escapeHtml(STATUS_SHORT[status] || status) + '</span>'; }
  function priorityBadge(priority) { return '<span class=\"priority-badge priority-' + priority + '\">' + escapeHtml(PRIORITY_LABELS[priority] || priority) + '</span>'; }
  function taskCard(task) {
    var assignee = taskAssignee(task);
    return '<article class=\"card task-card\"><div class=\"task-card-top\"><div>' + statusBadge(task.status) + '</div>' + priorityBadge(task.priority) +
      '</div><button class=\"button-ghost\" type=\"button\" data-action=\"open-task\" data-task-id=\"' + escapeHtml(task.id) + '\"><h3 class=\"task-card-title\">' +
      escapeHtml(task.title) + '</h3><p class=\"task-card-description\">' + escapeHtml(task.description || 'Без описания') + '</p></button>' +
      '<div class=\"task-card-bottom\"><span class=\"task-assignee\">' + (assignee ? '<span class=\"avatar-tiny\">' + escapeHtml(getInitials(assignee.name)) + '</span><span class=\"task-assignee-name\">' + escapeHtml(assignee.name) + '</span>' : '<span class=\"dim\">Не назначена</span>') +
      '</span><span class=\"' + (isOverdue(task) ? 'overdue' : '') + '\">' + (task.deadline ? 'до ' + escapeHtml(fullDate(task.deadline)) : 'Без дедлайна') + '</span></div></article>';
  }
  function getVisibleTasks() {
    var filter = state.taskFilter;
    var query = filter.query.trim().toLowerCase();
    return state.tasks.filter(function (task) {
      if (filter.status !== 'all' && task.status !== filter.status) return false;
      if (filter.priority !== 'all' && task.priority !== filter.priority) return false;
      if (query && (task.title + ' ' + task.description).toLowerCase().indexOf(query) < 0) return false;
      return true;
    });
  }
  function renderTasks() {
    var canCreate = currentRole() === 'developer' || currentRole() === 'manager';
    var actions = canCreate ? '<button class=\"button button-primary\" type=\"button\" data-action=\"create-task\">+ Новая задача</button>' : '';
    var html = commonPageIntro('Задачи', currentRole() === 'employee' ? 'Ваш личный список задач.' : 'Держите командный ритм в одном месте.', actions);
    html += '<div class=\"toolbar\"><input id=\"task-search\" class=\"text-input search-input\" type=\"search\" placeholder=\"Поиск по задачам\" value=\"' + escapeHtml(state.taskFilter.query) + '\"><select id=\"task-status-filter\" class=\"select-input\" aria-label=\"Фильтр по статусу\"><option value=\"all\">Все статусы</option>' +
      Object.keys(STATUS_LABELS).map(function (status) { return '<option value=\"' + status + '\"' + (state.taskFilter.status === status ? ' selected' : '') + '>' + STATUS_LABELS[status] + '</option>'; }).join('') +
      '</select><select id=\"task-priority-filter\" class=\"select-input\" aria-label=\"Фильтр по приоритету\"><option value=\"all\">Все приоритеты</option>' +
      Object.keys(PRIORITY_LABELS).map(function (priority) { return '<option value=\"' + priority + '\"' + (state.taskFilter.priority === priority ? ' selected' : '') + '>' + PRIORITY_LABELS[priority] + '</option>'; }).join('') +
      '</select><span class=\"filter-count\">' + getVisibleTasks().length + ' из ' + state.tasks.length + '</span></div>';
    if (state.taskError) return html + errorPanel(state.taskError, 'refresh');
    var visible = getVisibleTasks();
    return html + (visible.length ? '<div class=\"tasks-grid\">' + visible.map(taskCard).join('') + '</div>' : emptyState('Задач не найдено', 'Попробуйте изменить фильтры или создайте новую задачу.', '✓'));
  }

  function renderTeam() {
    var users = state.users.slice();
    if (currentRole() === 'manager' && state.user && state.user.departmentId) users = users.filter(function (user) { return String(user.departmentId) === String(state.user.departmentId); });
    var actions = canManageTeam() ? '<button class=\"button button-primary\" type=\"button\" data-action=\"create-user\">+ Добавить сотрудника</button>' : '';
    var html = commonPageIntro(currentRole() === 'manager' ? 'Сотрудники точки' : 'Сотрудники', 'Команда, роли и точки ответственности.', actions);
    if (state.usersError) return html + errorPanel(state.usersError, 'refresh');
    if (!users.length) return html + '<section class=\"card\">' + emptyState('Сотрудников пока нет', 'Добавьте первого сотрудника, чтобы назначать задачи.', '♙') + '</section>';
    return html + '<div class=\"people-grid\">' + users.map(function (user) {
      var department = findDepartment(user.departmentId);
      return '<article class=\"card person-card\"><div class=\"person-top\"><div class=\"avatar avatar-large\">' + escapeHtml(getInitials(user.name)) + '</div><div class=\"person-main\"><div class=\"person-name\">' +
        escapeHtml(user.name) + '</div><div class=\"person-username\">@' + escapeHtml(user.username || 'без логина') + '</div><div class=\"role-badge priority-normal\" style=\"margin-top:9px\">' + escapeHtml(roleLabel(user.role)) + '</div></div>' +
        (canEditUser(user) ? '<button class=\"icon-button\" type=\"button\" data-action=\"edit-user\" data-user-id=\"' + escapeHtml(user.id) + '\" aria-label=\"Редактировать сотрудника\">⋯</button>' : '') +
        '</div><div class=\"person-meta\"><div class=\"person-meta-row\"><span>Точка</span><strong>' + escapeHtml(user.departmentName || department && departmentName(department) || 'Не назначена') + '</strong></div><div class=\"person-meta-row\"><span>iiko кассир</span><strong>' +
        escapeHtml(user.iikoCashierName || 'Не указан') + (user.iikoCashierCode ? ' · ' + escapeHtml(user.iikoCashierCode) : '') + '</strong></div><div class=\"person-meta-row\"><span>Статус</span><strong class=\"' + (user.active ? 'active-pill' : 'inactive-pill') + '\">' + (user.active ? 'Активен' : 'Отключён') + '</strong></div></div></article>';
    }).join('') + '</div>';
  }

  function analyticsFilterHtml() {
    var locked = currentRole() === 'manager';
    var departments = [{ id: 'ALL', name: 'Вся сеть' }].concat(state.departments || []);
    return '<div class=\"analytics-filters\"><div class=\"field-group\"><label class=\"field-label\" for=\"analytics-from\">С даты</label><input id=\"analytics-from\" class=\"text-input\" type=\"date\" value=\"' + escapeHtml(state.analytics.from) + '\"></div>' +
      '<div class=\"field-group\"><label class=\"field-label\" for=\"analytics-to\">По дату</label><input id=\"analytics-to\" class=\"text-input\" type=\"date\" value=\"' + escapeHtml(state.analytics.to) + '\"></div>' +
      '<div class=\"field-group\"><label class=\"field-label\" for=\"analytics-department\">Точка</label><select id=\"analytics-department\" class=\"select-input\"' + (locked ? ' disabled' : '') + '>' +
      optionList(departments, state.analytics.departmentId, function (item) { return item.id || departmentId(item); }, function (item) { return item.name || departmentName(item); }) + '</select></div>' +
      '<button class=\"button button-primary\" type=\"button\" data-action=\"apply-analytics\">Обновить</button></div>';
  }
  function dailyRows(daily) {
    return (daily || []).slice(-7).map(function (item) {
      return { label: item['OpenDate.Typed'] || '', revenue: number(item['DishDiscountSumInt']), orders: number(item['UniqOrderId']) };
    });
  }
  function renderAnalytics() {
    var sales = state.analytics.sales || {};
    var kpi = sales.kpi || sales.stats || {};
    var upsell = sales.upsell || {};
    var daily = sales.daily || [];
    var cashiers = sales.cashiers || [];
    var payments = sales.payments || [];
    var dishes = sales.topDishes || [];
    var ranking = state.analytics.ranking || [];
    if (state.analytics.loading && !sales.kpi) return commonPageIntro('Аналитика', 'Загрузка показателей…') + analyticsFilterHtml() + viewSkeleton();
    var html = commonPageIntro('Аналитика', 'Продажи, смены и качество работы точки.') + analyticsFilterHtml();
    if (state.analytics.error && !sales.kpi) return html + errorPanel(state.analytics.error, 'refresh');
    html += '<div class=\"kpi-grid\">' + kpiCard('Выручка', money(getMetric(kpi, ['totalRevenue', 'revenue'])), 'среднее ' + money(getMetric(kpi, ['totalRevenue', 'revenue']) / (getMetric(kpi, ['daysCount']) || 1)), 'kpi-accent') +
      kpiCard('Чеков', compactNumber(getMetric(kpi, ['totalOrders', 'orders'])), 'гостей ' + compactNumber(getMetric(kpi, ['totalGuests', 'guests'])), 'kpi-blue') +
      kpiCard('Средний чек', money(getMetric(kpi, ['avgCheck', 'averageCheck'])), 'скидки ' + money(getMetric(kpi, ['totalDiscount', 'discount'])), 'kpi-purple') +
      kpiCard('Блюд', compactNumber(getMetric(kpi, ['totalDishes', 'dishes'])) + ' шт.', 'в чеке ' + (getMetric(kpi, ['totalOrders', 'orders']) ? (getMetric(kpi, ['totalDishes', 'dishes']) / getMetric(kpi, ['totalOrders', 'orders'])).toFixed(1) : '0'), 'kpi-green') + '</div>';
    html += '<div class=\"analytics-grid\"><section class=\"card card-pad span-2\"><div class=\"card-title\"><div><h3>Динамика продаж</h3><p>Выручка и количество чеков по дням</p></div><span class=\"caption\">KZT / заказы</span></div><div class=\"chart-wrap\"><canvas id=\"daily-chart\" aria-label=\"График продаж по дням\"></canvas></div></section>' +
      '<section class=\"card card-pad\"><div class=\"card-title\"><div><h3>Продажи по часам</h3><p id=\"peak-hour-hint\">Пиковая нагрузка</p></div></div><div class=\"chart-wrap\"><canvas id=\"hourly-chart\" aria-label=\"График продаж по часам\"></canvas></div></section>' +
      '<section class=\"card card-pad\"><div class=\"card-title\"><div><h3>Апсейл</h3><p>Качество допродаж</p></div><span class=\"status-badge status-in_progress\">фокус</span></div><div class=\"insight-panel\"><div class=\"insight\"><div class=\"insight-label\">Напитки к блюдам</div><div class=\"insight-value\">' + escapeHtml(percent(upsell.drinkRatioQty)) + '</div><div class=\"insight-note\">' + compactNumber(upsell.drinksCount) + ' шт.</div></div><div class=\"insight\"><div class=\"insight-label\">Допы к блюдам</div><div class=\"insight-value\">' + escapeHtml(percent(upsell.addonRatioQty)) + '</div><div class=\"insight-note\">' + compactNumber(upsell.addonsCount) + ' шт.</div></div><div class=\"insight\"><div class=\"insight-label\">Доля в выручке</div><div class=\"insight-value\">' + escapeHtml(percent(upsell.upsellShare)) + '</div><div class=\"insight-note\">' + money(upsell.totalUpsellRev) + '</div></div></div><div style=\"height:18px\"></div><div class=\"progress-item\"><div class=\"progress-label\"><span>Напитки</span><span>' + escapeHtml(percent(upsell.drinkRatioQty)) + '</span></div><div class=\"progress-track\"><div class=\"progress-value\" style=\"width:' + Math.min(100, Math.max(0, number(upsell.drinkRatioQty))) + '%\"></div></div></div><div class=\"progress-item\"><div class=\"progress-label\"><span>Дополнительные позиции</span><span>' + escapeHtml(percent(upsell.addonRatioQty)) + '</span></div><div class=\"progress-track\"><div class=\"progress-value\" style=\"width:' + Math.min(100, Math.max(0, number(upsell.addonRatioQty))) + '%\"></div></div></div></section></div>';
    html += '<div class=\"analytics-two-col\" style=\"margin-top:16px\"><section class=\"card card-pad\"><div class=\"card-title\"><div><h3>Кассиры</h3><p>Выручка и прикрепление позиций</p></div></div><div class=\"data-table-wrap\"><table class=\"data-table\"><thead><tr><th>Кассир</th><th>Апсейл</th><th>Чеки</th><th>Выручка</th></tr></thead><tbody>' +
      (cashiers.length ? cashiers.slice(0, 12).map(function (cashier, index) {
        var name = cashier.Cashier || cashier.name || 'Не указан';
        return '<tr><td class=\"strong\">' + (index < 3 ? ['🥇', '🥈', '🥉'][index] + ' ' : '') + escapeHtml(name) + '</td><td>' + escapeHtml(percent(cashier.drinkRate)) + ' / ' + escapeHtml(percent(cashier.addonRate)) + '</td><td>' + compactNumber(getMetric(cashier, ['UniqOrderId', 'orders'])) + '</td><td class=\"accent\">' + money(getMetric(cashier, ['DishDiscountSumInt', 'revenue'])) + '</td></tr>';
      }).join('') : '<tr><td colspan=\"4\">Нет данных</td></tr>') + '</tbody></table></div></section>' +
      '<section class=\"card card-pad\"><div class=\"card-title\"><div><h3>Оплаты</h3><p>Структура выручки по типам</p></div></div>' +
      (payments.length ? payments.slice(0, 8).map(function (payment) { var sum = getMetric(payment, ['DishDiscountSumInt', 'revenue']); var label = payment.PayTypes || payment.name || 'Без типа'; var share = getMetric(kpi, ['totalRevenue', 'revenue']) ? sum / getMetric(kpi, ['totalRevenue', 'revenue']) * 100 : 0; return '<div class=\"progress-item\"><div class=\"progress-label\"><span>' + escapeHtml(label) + '</span><span>' + escapeHtml(percent(share)) + '</span></div><div class=\"progress-track\"><div class=\"progress-value\" style=\"width:' + Math.min(100, Math.max(2, share)) + '%\"></div></div></div>'; }).join('') : emptyState('Оплат нет', 'Нет данных за выбранный период.', '₸')) + '</section></div>';
    html += '<div class=\"analytics-two-col\" style=\"margin-top:16px\"><section class=\"card card-pad\"><div class=\"card-title\"><div><h3>Топ блюд</h3><p>По выручке за период</p></div></div><div class=\"data-table-wrap\"><table class=\"data-table\"><thead><tr><th>#</th><th>Блюдо</th><th>Шт.</th><th>Сумма</th></tr></thead><tbody>' +
      (dishes.length ? dishes.slice(0, 10).map(function (dish, index) { return '<tr><td>' + (index + 1) + '</td><td class=\"strong\">' + escapeHtml(dish.DishName || dish.name || 'Неизвестно') + '</td><td>' + compactNumber(getMetric(dish, ['DishAmountInt', 'quantity'])) + '</td><td class=\"accent\">' + money(getMetric(dish, ['DishDiscountSumInt', 'revenue'])) + '</td></tr>'; }).join('') : '<tr><td colspan=\"4\">Нет данных</td></tr>') + '</tbody></table></div></section>' +
      '<section class=\"card card-pad\"><div class=\"card-title\"><div><h3>Рейтинг точек</h3><p>Выручка и средний чек</p></div></div><div class=\"data-table-wrap\"><table class=\"data-table\"><thead><tr><th>#</th><th>Точка</th><th>Чеки</th><th>Выручка</th></tr></thead><tbody>' +
      (ranking.length ? ranking.slice(0, 10).map(function (item, index) { var id = item['Department.Id'] || item.departmentId; var current = String(id) === String(state.analytics.departmentId); return '<tr><td>' + (index + 1) + '</td><td class=\"' + (current ? 'accent' : 'strong') + '\">' + escapeHtml(item.Department || item.department || 'Точка') + (current ? ' · вы' : '') + '</td><td>' + compactNumber(getMetric(item, ['UniqOrderId', 'orders'])) + '</td><td class=\"accent\">' + money(getMetric(item, ['DishDiscountSumInt', 'revenue'])) + '</td></tr>'; }).join('') : '<tr><td colspan=\"4\">Нет данных</td></tr>') + '</tbody></table></div></section></div>';
    html += '<section class=\"card card-pad\" style=\"margin-top:16px\"><div class=\"card-title\"><div><h3>Смены</h3><p>Открытие, закрытие и кассовые итоги</p></div><span class=\"caption\">' + state.analytics.shifts.length + ' смен</span></div><div class=\"data-table-wrap\"><table class=\"data-table\"><thead><tr><th>Смена</th><th>Статус</th><th>Открыта</th><th>Ответственный</th><th>Итого</th></tr></thead><tbody>' +
      (state.analytics.shifts.length ? state.analytics.shifts.slice(0, 12).map(function (shift) { return '<tr><td class=\"strong\">#' + escapeHtml(shift.sessionNumber || shift.id || '—') + '</td><td>' + (String(shift.status || '').toUpperCase() === 'OPEN' ? '<span class=\"active-pill\">Открыта</span>' : '<span class=\"dim\">Закрыта</span>') + '</td><td>' + escapeHtml(dateTime(shift.openDate)) + '</td><td>' + escapeHtml(shift.responsible || shift.manager || '—') + '</td><td class=\"accent\">' + money(shift.payOrders || shift.total || 0) + '</td></tr>'; }).join('') : '<tr><td colspan=\"5\">Нет данных по сменам</td></tr>') + '</tbody></table></div></section>';
    return html;
  }

  function renderProfile() {
    var user = state.user || {};
    return commonPageIntro('Профиль', 'Личные данные и безопасность аккаунта.') +
      '<div class=\"profile-grid\"><section class=\"card card-pad\"><div class=\"profile-identity\"><div class=\"avatar avatar-large\">' + escapeHtml(getInitials(user.name)) + '</div><div><h3>' + escapeHtml(user.name) + '</h3><p>' + escapeHtml(roleLabel(currentRole())) + '</p></div></div><div class=\"profile-list\"><div class=\"profile-list-row\"><span>Логин</span><strong>' + escapeHtml(user.username || '—') + '</strong></div><div class=\"profile-list-row\"><span>Точка</span><strong>' + escapeHtml(user.departmentName || (findDepartment(user.departmentId) && departmentName(findDepartment(user.departmentId))) || 'Не назначена') + '</strong></div><div class=\"profile-list-row\"><span>iiko имя кассира</span><strong>' + escapeHtml(user.iikoCashierName || 'Не указано') + '</strong></div><div class=\"profile-list-row\"><span>iiko табельный код</span><strong>' + escapeHtml(user.iikoCashierCode || 'Не указан') + '</strong></div></div></section>' +
      '<section class=\"card card-pad\"><div class=\"card-title\"><div><h3>Смена пароля</h3><p>Новый пароль должен быть не короче 8 символов.</p></div></div><form id=\"password-form\" class=\"form-grid\"><div class=\"field-group\"><label class=\"field-label\" for=\"current-password\">Текущий пароль</label><input id=\"current-password\" class=\"text-input\" type=\"password\" autocomplete=\"current-password\" required></div><div class=\"field-group\"><label class=\"field-label\" for=\"new-password\">Новый пароль</label><input id=\"new-password\" class=\"text-input\" type=\"password\" autocomplete=\"new-password\" minlength=\"8\" required></div><div class=\"field-group\"><label class=\"field-label\" for=\"repeat-password\">Повторите новый пароль</label><input id=\"repeat-password\" class=\"text-input\" type=\"password\" autocomplete=\"new-password\" minlength=\"8\" required></div><p id=\"password-error\" class=\"form-error\"></p><div class=\"button-row button-row-end\"><button class=\"button button-primary\" type=\"submit\">Сохранить пароль</button></div></form></section></div>';
  }

  async function renderView() {
    var main = $('#main-content');
    destroyCharts();
    main.innerHTML = viewSkeleton();
    if (state.activeView === 'analytics' && !state.analytics.sales && !state.analytics.loading) await loadAnalytics();
    if (state.activeView === 'overview' && (currentRole() === 'developer' || currentRole() === 'manager') && !state.analytics.sales) await loadAnalytics({ silent: true });
    if (state.activeView === 'overview' && currentRole() === 'employee' && !state.metrics) await loadMyMetrics();
    var content = state.activeView === 'overview' ? renderOverview() : state.activeView === 'tasks' ? renderTasks() : state.activeView === 'team' ? renderTeam() : state.activeView === 'analytics' ? renderAnalytics() : renderProfile();
    main.innerHTML = content;
    bindViewEvents();
    if (state.activeView === 'analytics') renderCharts();
  }

  function bindViewEvents() {
    var main = $('#main-content');
    $all('[data-view]', main).forEach(function (node) { node.addEventListener('click', function () { goTo(node.getAttribute('data-view')); }); });
    $all('[data-action=\"open-task\"]', main).forEach(function (node) { node.addEventListener('click', function () { openTaskModal(node.getAttribute('data-task-id')); }); });
    var search = $('#task-search');
    if (search) search.addEventListener('input', function (event) { state.taskFilter.query = event.target.value; renderView(); });
    var status = $('#task-status-filter');
    if (status) status.addEventListener('change', function (event) { state.taskFilter.status = event.target.value; renderView(); });
    var priority = $('#task-priority-filter');
    if (priority) priority.addEventListener('change', function (event) { state.taskFilter.priority = event.target.value; renderView(); });
    var passwordForm = $('#password-form');
    if (passwordForm) passwordForm.addEventListener('submit', changePassword);
    $all('[data-action=\"create-task\"]', main).forEach(function (node) { node.addEventListener('click', function () { openTaskModal(null); }); });
    $all('[data-action=\"create-user\"]', main).forEach(function (node) { node.addEventListener('click', function () { openUserModal(null); }); });
    $all('[data-action=\"edit-user\"]', main).forEach(function (node) { node.addEventListener('click', function () { openUserModal(node.getAttribute('data-user-id')); }); });
    $all('[data-action=\"apply-analytics\"]', main).forEach(function (node) { node.addEventListener('click', applyAnalytics); });
    $all('[data-action=\"refresh\"]', main).forEach(function (node) { node.addEventListener('click', refreshCurrentView); });
  }
  async function refreshCurrentView() {
    if (currentRole() === 'employee') await loadTasks(); else await Promise.all([loadTasks(), loadUsers(), loadDepartments(), loadTaskStats()]);
    if (state.activeView === 'analytics' || state.activeView === 'overview') await (currentRole() === 'employee' ? loadMyMetrics() : loadAnalytics());
    renderView();
  }
  async function applyAnalytics() {
    var from = $('#analytics-from').value;
    var to = $('#analytics-to').value;
    if (!from || !to || from > to) { toast('Проверьте диапазон дат.', 'error'); return; }
    state.analytics.from = from; state.analytics.to = to; state.analytics.departmentId = $('#analytics-department').value || 'ALL';
    await loadAnalytics();
    renderView();
  }
  function destroyCharts() {
    Object.keys(state.charts).forEach(function (key) { if (state.charts[key]) { state.charts[key].destroy(); state.charts[key] = null; } });
  }
  function renderCharts() {
    if (!window.Chart) return;
    var sales = state.analytics.sales || {};
    var daily = dailyRows(sales.daily || []);
    var hourly = sales.hourly || [];
    var dailyCanvas = $('#daily-chart');
    var hourlyCanvas = $('#hourly-chart');
    var chartColors = { amber: '#f4aa32', blue: '#6ea8ff', grid: 'rgba(255,255,255,.07)', text: '#8f96a5' };
    if (dailyCanvas) {
      state.charts.daily = new Chart(dailyCanvas, { type: 'bar', data: { labels: daily.map(function (item) { return shortDate(item.label); }), datasets: [{ label: 'Выручка', data: daily.map(function (item) { return item.revenue; }), backgroundColor: 'rgba(244,170,50,.76)', borderRadius: 5, yAxisID: 'revenue' }, { label: 'Чеки', data: daily.map(function (item) { return item.orders; }), type: 'line', borderColor: chartColors.blue, backgroundColor: chartColors.blue, borderWidth: 2, tension: .35, pointRadius: 3, yAxisID: 'orders' }] }, options: chartOptions(chartColors, true) });
    }
    if (hourlyCanvas) {
      var peak = hourly.reduce(function (best, item) { return number(item.revenue) > number(best.revenue) ? item : best; }, { revenue: 0, hour: '' });
      var hint = $('#peak-hour-hint'); if (hint) hint.textContent = peak.hour ? 'Пик: ' + peak.hour + ' · ' + money(peak.revenue) : 'Пиковая нагрузка';
      state.charts.hourly = new Chart(hourlyCanvas, { type: 'bar', data: { labels: hourly.map(function (item) { return item.hour || item.label || ''; }), datasets: [{ label: 'Выручка', data: hourly.map(function (item) { return number(item.revenue || item.DishDiscountSumInt); }), backgroundColor: hourly.map(function (item) { return item === peak ? chartColors.amber : 'rgba(111,120,136,.55)'; }), borderRadius: 4 }] }, options: chartOptions(chartColors, false) });
    }
  }
  function chartOptions(colors, dual) {
    var scales = { x: { grid: { display: false }, ticks: { color: colors.text, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 9 }, callback: function (value) { return value >= 1000 ? Math.round(value / 1000) + 'k' : value; } } } };
    if (dual) { scales.revenue = { position: 'left', grid: { color: colors.grid }, ticks: { color: colors.amber, font: { size: 9 }, callback: function (value) { return value >= 1000 ? Math.round(value / 1000) + 'k' : value; } } }; scales.orders = { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: colors.blue, font: { size: 9 } } }; delete scales.y; }
    return { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', labels: { color: '#c1c6d0', font: { size: 10 }, boxWidth: 12, usePointStyle: true } }, tooltip: { callbacks: { label: function (context) { return context.dataset.yAxisID === 'revenue' || context.dataset.label === 'Выручка' ? ' Выручка: ' + money(context.raw) : ' Чеков: ' + compactNumber(context.raw); } } } }, scales: scales };
  }

  function modalShell(title, subtitle, body, footer, wide) {
    return '<div class=\"modal-backdrop\" role=\"presentation\"><div class=\"modal' + (wide ? ' modal-wide' : '') + '\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"modal-title\"><div class=\"modal-header\"><div><h2 id=\"modal-title\">' + escapeHtml(title) + '</h2>' + (subtitle ? '<p>' + escapeHtml(subtitle) + '</p>' : '') + '</div><button class=\"icon-button close-button\" type=\"button\" data-action=\"close-modal\" aria-label=\"Закрыть\">×</button></div><div class=\"modal-body\">' + body + '</div>' + (footer ? '<div class=\"modal-footer\">' + footer + '</div>' : '') + '</div></div>';
  }
  function showModal(markup) {
    $('#modal-root').innerHTML = markup;
    document.body.style.overflow = 'hidden';
    var backdrop = $('.modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', function (event) { if (event.target === backdrop) closeModal(); });
    $all('[data-action=\"close-modal\"]', $('#modal-root')).forEach(function (node) { node.addEventListener('click', closeModal); });
  }
  function closeModal() {
    $('#modal-root').innerHTML = '';
    document.body.style.overflow = '';
    state.modal = null;
    state.pendingPhoto = null;
  }
  async function openTaskModal(id) {
    state.modal = { type: 'task', id: id };
    if (!id) { showTaskForm(null); return; }
    showModal(modalShell('Задача', 'Загрузка деталей…', '<div class=\"empty-state\"><div><span class=\"empty-icon\">…</span><strong>Загружаем задачу</strong><p>История и комментарии появятся через секунду.</p></div></div>', '', true));
    try {
      var data = await api('/api/tasks/' + encodeURIComponent(id));
      var task = normalizeTask(entity(data, 'task', data.data || {}));
      showTaskDetail(task);
    } catch (error) {
      var fallback = state.tasks.find(function (item) { return String(item.id) === String(id); });
      if (fallback) showTaskDetail(fallback); else { closeModal(); toast(error.message, 'error'); }
    }
  }
  function showTaskForm(task) {
    var editing = Boolean(task);
    var body = '<form id=\"task-form\" class=\"form-grid\" data-task-id=\"' + escapeHtml(task ? task.id : '') + '\"><div class=\"field-group\"><label class=\"field-label\" for=\"task-title\">Название</label><input id=\"task-title\" class=\"text-input\" type=\"text\" required maxlength=\"180\" value=\"' + escapeHtml(task ? task.title : '') + '\" placeholder=\"Например, проверить витрину\"></div><div class=\"field-group\"><label class=\"field-label\" for=\"task-description\">Описание</label><textarea id=\"task-description\" class=\"textarea-input\" rows=\"5\" maxlength=\"4000\" placeholder=\"Что нужно сделать и какой результат ожидаем?\">' + escapeHtml(task ? task.description : '') + '</textarea></div><div class=\"form-grid\" style=\"grid-template-columns:repeat(2,minmax(0,1fr))\"><div class=\"field-group\"><label class=\"field-label\" for=\"task-status\">Статус</label><select id=\"task-status\" class=\"select-input\">' + Object.keys(STATUS_LABELS).map(function (item) { return '<option value=\"' + item + '\"' + ((task ? task.status : 'new') === item ? ' selected' : '') + '>' + STATUS_SHORT[item] + '</option>'; }).join('') + '</select></div><div class=\"field-group\"><label class=\"field-label\" for=\"task-priority\">Приоритет</label><select id=\"task-priority\" class=\"select-input\">' + Object.keys(PRIORITY_LABELS).map(function (item) { return '<option value=\"' + item + '\"' + ((task ? task.priority : 'normal') === item ? ' selected' : '') + '>' + PRIORITY_LABELS[item] + '</option>'; }).join('') + '</select></div></div><div class=\"form-grid\" style=\"grid-template-columns:repeat(2,minmax(0,1fr))\"><div class=\"field-group\"><label class=\"field-label\" for=\"task-deadline\">Дедлайн</label><input id=\"task-deadline\" class=\"text-input\" type=\"datetime-local\" value=\"' + escapeHtml(task && task.deadline ? String(task.deadline).slice(0, 16) : '') + '\"></div><div class=\"field-group\"><label class=\"field-label\" for=\"task-assignee\">Назначить сотруднику</label><select id=\"task-assignee\" class=\"select-input\"><option value=\"\">Без назначения</option>' + state.users.map(function (user) { return '<option value=\"' + escapeHtml(user.id) + '\"' + (task && String(task.assigneeId) === String(user.id) ? ' selected' : '') + '>' + escapeHtml(user.name) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class=\"field-group\"><label class=\"field-label\" for=\"task-department\">Точка</label><select id=\"task-department\" class=\"select-input\"><option value=\"\">Общая задача</option>' + state.departments.map(function (department) { var value = departmentId(department); return '<option value=\"' + escapeHtml(value) + '\"' + (task && String(task.departmentId) === String(value) ? ' selected' : '') + '>' + escapeHtml(departmentName(department)) + '</option>'; }).join('') + '</select></div></form>';
    showModal(modalShell(editing ? 'Редактировать задачу' : 'Новая задача', editing ? 'Обновите данные и сохраните изменения.' : 'Поставьте задачу ясно и по делу.', body, '<button class=\"button button-secondary\" type=\"button\" data-action=\"close-modal\">Отмена</button><button class=\"button button-primary\" type=\"submit\" form=\"task-form\">' + (editing ? 'Сохранить' : 'Создать задачу') + '</button>', false));
    var form = $('#task-form');
    if (form) form.addEventListener('submit', saveTask);
  }
  function canEditTask(task) { return currentRole() === 'developer' || currentRole() === 'manager'; }
  function showTaskDetail(task) {
    state.modal = { type: 'task', id: task.id, task: task };
    var assignee = taskAssignee(task);
    var comments = task.comments || [];
    var attachments = task.attachments || [];
    var canEdit = canEditTask(task);
    var canChangeStatus = canEdit || String(task.assigneeId) === String(state.user && state.user.id);
    var commentHtml = comments.length ? comments.map(function (comment) { var author = comment.author || comment.user || {}; var authorName = typeof author === 'string' ? author : author.name || comment.authorName || 'Команда'; return '<article class=\"comment\"><div class=\"comment-meta\"><span class=\"comment-author\">' + escapeHtml(authorName) + '</span><span>' + escapeHtml(dateTime(comment.createdAt || comment.created_at)) + '</span></div><p class=\"comment-body\">' + escapeHtml(comment.body || comment.text || '') + '</p></article>'; }).join('') : emptyState('Комментариев пока нет', 'Будьте первым — добавьте короткий контекст к задаче.', '✎');
    var attachmentHtml = attachments.length ? '<div class=\"attachment-list\">' + attachments.map(function (attachment) { var id = attachment.id || attachment.attachmentId; return '<button type=\"button\" class=\"attachment-chip\" data-action=\"open-attachment\" data-attachment-id=\"' + escapeHtml(id) + '\">▧ ' + escapeHtml(attachment.name || attachment.filename || 'Фото') + '</button>'; }).join('') + '</div>' : '<p class=\"caption\">Фото пока не прикреплены.</p>';
    var allowedStatuses = currentRole() === 'employee' ? ['new', 'in_progress', 'review'] : Object.keys(STATUS_LABELS);
    var statusControl = canChangeStatus ? '<div class=\"field-group\"><label class=\"field-label\" for=\"detail-status\">Изменить статус</label><select id=\"detail-status\" class=\"select-input\">' + allowedStatuses.map(function (status) { return '<option value=\"' + status + '\"' + (task.status === status ? ' selected' : '') + '>' + STATUS_SHORT[status] + '</option>'; }).join('') + '</select></div>' : '';
    var body = '<div class=\"task-detail-head\">' + statusBadge(task.status) + priorityBadge(task.priority) + (isOverdue(task) ? '<span class=\"status-badge priority-urgent\">Дедлайн просрочен</span>' : '') + '</div><p class=\"detail-description\">' + escapeHtml(task.description || 'Описание не добавлено.') + '</p><div class=\"detail-meta\"><div class=\"detail-meta-item\"><span>Ответственный</span><strong>' + escapeHtml(assignee ? assignee.name : 'Не назначен') + '</strong></div><div class=\"detail-meta-item\"><span>Дедлайн</span><strong class=\"' + (isOverdue(task) ? 'overdue' : '') + '\">' + escapeHtml(task.deadline ? dateTime(task.deadline) : 'Без дедлайна') + '</strong></div><div class=\"detail-meta-item\"><span>Точка</span><strong>' + escapeHtml(taskDepartment(task)) + '</strong></div><div class=\"detail-meta-item\"><span>Создана</span><strong>' + escapeHtml(dateTime(task.createdAt)) + '</strong></div></div>' + (canEdit ? '<button class=\"button button-secondary\" type=\"button\" data-action=\"edit-task\">Редактировать задачу</button>' : '') + '<div style=\"height:22px\"></div><h3 class=\"subheading\">История комментариев</h3><div class=\"comments-list\">' + commentHtml + '</div><h3 class=\"subheading\">Фото и вложения</h3>' + attachmentHtml + '<form id=\"attachment-form\" class=\"field-group\"><label class=\"field-label\" for=\"task-photo\">Добавить фото</label><input id=\"task-photo\" class=\"file-input\" type=\"file\" accept=\"image/*\"><div id=\"photo-preview\" class=\"photo-preview\"><img alt=\"Предпросмотр фото\"><button type=\"button\" data-action=\"clear-photo\" aria-label=\"Убрать фото\">×</button></div><button class=\"button button-secondary\" type=\"submit\">Загрузить фото</button></form><div style=\"height:20px\"></div>' + statusControl + '<form id=\"comment-form\" class=\"field-group\" style=\"margin-top:15px\"><label class=\"field-label\" for=\"comment-body\">Новый комментарий</label><textarea id=\"comment-body\" class=\"textarea-input\" rows=\"3\" maxlength=\"2000\" placeholder=\"Добавьте контекст или результат…\"></textarea><button class=\"button button-primary\" type=\"submit\">Добавить комментарий</button></form>';
    showModal(modalShell(task.title, 'Детали задачи и рабочая история', body, '<button class=\"button button-secondary\" type=\"button\" data-action=\"close-modal\">Закрыть</button>', true));
    var file = $('#task-photo'); if (file) file.addEventListener('change', previewPhoto);
    var attachmentForm = $('#attachment-form'); if (attachmentForm) attachmentForm.addEventListener('submit', uploadPhoto);
    var commentForm = $('#comment-form'); if (commentForm) commentForm.addEventListener('submit', addComment);
    var statusSelect = $('#detail-status'); if (statusSelect) statusSelect.addEventListener('change', changeTaskStatus);
    var editButton = $('[data-action=\"edit-task\"]'); if (editButton) editButton.addEventListener('click', function () { showTaskForm(task); });
    $all('[data-action=\"open-attachment\"]', $('#modal-root')).forEach(function (node) { node.addEventListener('click', function () { openAttachment(node.getAttribute('data-attachment-id')); }); });
    var clearButton = $('[data-action=\"clear-photo\"]'); if (clearButton) clearButton.addEventListener('click', clearPhoto);
  }
  async function saveTask(event) {
    event.preventDefault();
    var form = event.target;
    var id = form.getAttribute('data-task-id');
    var title = $('#task-title').value.trim();
    if (!title) { toast('Введите название задачи.', 'error'); return; }
    var selectedDepartmentId = $('#task-department').value || null;
    var selectedDepartment = selectedDepartmentId ? findDepartment(selectedDepartmentId) : null;
    var body = { title: title, description: $('#task-description').value.trim(), status: $('#task-status').value, priority: $('#task-priority').value, due_at: $('#task-deadline').value || null, assignee_id: $('#task-assignee').value || null, department_id: selectedDepartmentId, department_name: selectedDepartment ? departmentName(selectedDepartment) : null };
    var submit = $('button[type=\"submit\"]', form.parentElement.parentElement);
    setBusy(submit, true);
    try {
      var data = id ? await api('/api/tasks/' + encodeURIComponent(id), { method: 'PATCH', body: body }) : await api('/api/tasks', { method: 'POST', body: body });
      var task = entity(data, 'task', null);
      await loadTasks();
      closeModal();
      toast(id ? 'Задача обновлена.' : 'Задача создана.', 'success');
      if (task && id) openTaskModal(task.id || id); else renderView();
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(submit, false); }
  }
  async function changeTaskStatus(event) {
    var task = state.modal && state.modal.task;
    if (!task) return;
    try {
      await api('/api/tasks/' + encodeURIComponent(task.id), { method: 'PATCH', body: { status: event.target.value } });
      await loadTasks();
      var data = await api('/api/tasks/' + encodeURIComponent(task.id));
      showTaskDetail(normalizeTask(entity(data, 'task', data.data || task)));
      toast('Статус обновлён.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  }
  async function addComment(event) {
    event.preventDefault();
    var task = state.modal && state.modal.task;
    var field = $('#comment-body');
    if (!task || !field || !field.value.trim()) { toast('Напишите комментарий.', 'error'); return; }
    var submit = $('button[type=\"submit\"]', event.target);
    setBusy(submit, true);
    try {
      await api('/api/tasks/' + encodeURIComponent(task.id) + '/comments', { method: 'POST', body: { body: field.value.trim() } });
      var data = await api('/api/tasks/' + encodeURIComponent(task.id));
      showTaskDetail(normalizeTask(entity(data, 'task', data.data || task)));
      toast('Комментарий добавлен.', 'success');
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(submit, false); }
  }
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Не удалось прочитать изображение.')); };
      reader.onload = function () {
        var image = new Image();
        image.onerror = function () { reject(new Error('Файл не похож на изображение.')); };
        image.onload = function () {
          var scale = Math.min(1, 1600 / Math.max(image.width, image.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
          var context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          var quality = .84;
          function attempt() { canvas.toBlob(function (blob) { if (!blob) return reject(new Error('Не удалось сжать изображение.')); if (blob.size <= 1572864 || quality <= .46) return resolve(blob); quality -= .08; attempt(); }, 'image/jpeg', quality); }
          attempt();
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  async function previewPhoto(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      var blob = await resizeImage(file);
      state.pendingPhoto = { blob: blob, name: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg' };
      var preview = $('#photo-preview');
      var image = $('img', preview);
      image.src = URL.createObjectURL(blob);
      preview.classList.add('has-image');
    } catch (error) { event.target.value = ''; toast(error.message, 'error'); }
  }
  function clearPhoto() {
    state.pendingPhoto = null;
    var input = $('#task-photo'); if (input) input.value = '';
    var preview = $('#photo-preview'); if (preview) { preview.classList.remove('has-image'); var image = $('img', preview); if (image) image.removeAttribute('src'); }
  }
  async function uploadPhoto(event) {
    event.preventDefault();
    var task = state.modal && state.modal.task;
    if (!task || !state.pendingPhoto) { toast('Выберите фото для загрузки.', 'error'); return; }
    var submit = $('button[type=\"submit\"]', event.target);
    setBusy(submit, true);
    var formData = new FormData();
    formData.append('photo', state.pendingPhoto.blob, state.pendingPhoto.name);
    try {
      await api('/api/tasks/' + encodeURIComponent(task.id) + '/attachments', { method: 'POST', body: formData });
      var data = await api('/api/tasks/' + encodeURIComponent(task.id));
      showTaskDetail(normalizeTask(entity(data, 'task', data.data || task)));
      toast('Фото прикреплено.', 'success');
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(submit, false); }
  }
  function openAttachment(id) {
    if (!id) { toast('У вложения нет идентификатора.', 'error'); return; }
    window.open('/api/attachments/' + encodeURIComponent(id), '_blank', 'noopener,noreferrer');
  }

  function userForm(user) {
    var editing = Boolean(user);
    var body = '<form id=\"user-form\" class=\"form-grid\" data-user-id=\"' + escapeHtml(user ? user.id : '') + '\"><div class=\"field-group\"><label class=\"field-label\" for=\"user-full-name\">ФИО</label><input id=\"user-full-name\" class=\"text-input\" type=\"text\" required maxlength=\"120\" value=\"' + escapeHtml(user ? user.name : '') + '\" placeholder=\"Имя и фамилия\"></div><div class=\"form-grid\" style=\"grid-template-columns:repeat(2,minmax(0,1fr))\"><div class=\"field-group\"><label class=\"field-label\" for=\"user-username\">Логин</label><input id=\"user-username\" class=\"text-input\" type=\"text\" required autocomplete=\"username\" value=\"' + escapeHtml(user ? user.username : '') + '\"></div><div class=\"field-group\"><label class=\"field-label\" for=\"user-password\">' + (editing ? 'Новый временный пароль' : 'Временный пароль') + '</label><input id=\"user-password\" class=\"text-input\" type=\"password\" autocomplete=\"new-password\" ' + (editing ? '' : 'required') + ' placeholder=\"' + (editing ? 'Оставьте пустым без изменений' : 'Не короче 8 символов') + '\"></div></div><div class=\"form-grid\" style=\"grid-template-columns:repeat(2,minmax(0,1fr))\"><div class=\"field-group\"><label class=\"field-label\" for=\"user-role\">Роль</label><select id=\"user-role\" class=\"select-input\">' + Object.keys(ROLE_LABELS).map(function (role) { return '<option value=\"' + role + '\"' + ((user ? user.role : 'employee') === role ? ' selected' : '') + '>' + ROLE_LABELS[role] + '</option>'; }).join('') + '</select></div><div class=\"field-group\"><label class=\"field-label\" for=\"user-department\">Точка</label><select id=\"user-department\" class=\"select-input\"><option value=\"\">Не назначена</option>' + state.departments.map(function (department) { var value = departmentId(department); return '<option value=\"' + escapeHtml(value) + '\"' + (user && String(user.departmentId) === String(value) ? ' selected' : '') + '>' + escapeHtml(departmentName(department)) + '</option>'; }).join('') + '</select></div></div><div class=\"form-grid\" style=\"grid-template-columns:repeat(2,minmax(0,1fr))\"><div class=\"field-group\"><label class=\"field-label\" for=\"user-cashier\">iiko имя кассира</label><input id=\"user-cashier\" class=\"text-input\" type=\"text\" value=\"' + escapeHtml(user ? user.iikoCashierName : '') + '\" placeholder=\"Как отображается в iiko\"></div><div class=\"field-group\"><label class=\"field-label\" for=\"user-cashier-code\">Табельный код iiko</label><input id=\"user-cashier-code\" class=\"text-input\" type=\"text\" maxlength=\"100\" value=\"' + escapeHtml(user ? user.iikoCashierCode : '') + '\" placeholder=\"Код из таблицы кассиров\"></div></div><label class=\"check-field\"><input id=\"user-active\" type=\"checkbox\"' + (!user || user.active ? ' checked' : '') + '> Аккаунт активен</label></form>';
    showModal(modalShell(editing ? 'Редактировать сотрудника' : 'Новый сотрудник', 'Доступ, роль и привязка к точке.', body, '<button class=\"button button-secondary\" type=\"button\" data-action=\"close-modal\">Отмена</button><button class=\"button button-primary\" type=\"submit\" form=\"user-form\">' + (editing ? 'Сохранить' : 'Создать сотрудника') + '</button>', false));
    if (currentRole() === 'manager') {
      var roleField = $('#user-role');
      var departmentField = $('#user-department');
      if (roleField && roleField.closest('.field-group')) roleField.closest('.field-group').remove();
      if (departmentField && departmentField.closest('.field-group')) departmentField.closest('.field-group').remove();
    }
    var form = $('#user-form'); if (form) form.addEventListener('submit', saveUser);
  }
  function openUserModal(id) {
    if (!canManageTeam()) return;
    var user = id ? findUser(id) : null;
    if (user && !canEditUser(user)) return;
    userForm(user);
  }
  async function saveUser(event) {
    event.preventDefault();
    var form = event.target;
    var id = form.getAttribute('data-user-id');
    var name = $('#user-full-name').value.trim();
    var username = $('#user-username').value.trim();
    var password = $('#user-password').value;
    if (!name || !username || (!id && password.length < 8)) { toast(!name || !username ? 'Заполните обязательные поля.' : 'Временный пароль должен быть не короче 8 символов.', 'error'); return; }
    var departmentField = $('#user-department');
    var department = currentRole() === 'manager' ? (state.user && state.user.departmentId) : (departmentField ? departmentField.value : '');
    department = department || null;
    var departmentInfo = department ? findDepartment(department) : null;
    var roleField = $('#user-role');
    var body = { full_name: name, username: username, role: currentRole() === 'manager' ? 'employee' : (roleField ? roleField.value : 'employee'), department_id: department, department_name: departmentInfo ? departmentName(departmentInfo) : (currentRole() === 'manager' ? state.user.departmentName : null), iiko_employee_name: $('#user-cashier').value.trim(), iiko_employee_code: $('#user-cashier-code').value.trim(), active: $('#user-active').checked };
    if (id && currentRole() === 'manager') {
      delete body.role;
      delete body.department_id;
      delete body.department_name;
    }
    if (password) body.password = password;
    var submit = $('button[type=\"submit\"]', form.parentElement.parentElement); setBusy(submit, true);
    try {
      await api(id ? '/api/users/' + encodeURIComponent(id) : '/api/users', { method: id ? 'PATCH' : 'POST', body: body });
      await loadUsers(); closeModal(); toast(id ? 'Профиль сотрудника обновлён.' : 'Сотрудник добавлен.', 'success'); renderView();
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(submit, false); }
  }
  async function changePassword(event) {
    event.preventDefault();
    var currentPassword = $('#current-password').value;
    var newPassword = $('#new-password').value;
    var repeat = $('#repeat-password').value;
    var errorEl = $('#password-error');
    if (newPassword.length < 8) { errorEl.textContent = 'Новый пароль должен быть не короче 8 символов.'; return; }
    if (newPassword !== repeat) { errorEl.textContent = 'Пароли не совпадают.'; return; }
    errorEl.textContent = '';
    var submit = $('button[type=\"submit\"]', event.target); setBusy(submit, true);
    try { await api('/api/auth/password', { method: 'PATCH', body: { current_password: currentPassword, new_password: newPassword } }); event.target.reset(); toast('Пароль изменён.', 'success'); }
    catch (error) { errorEl.textContent = error.message; }
    finally { setBusy(submit, false); }
  }
  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } }); } catch (error) {}
    sessionExpired();
    $('#login-error').textContent = '';
  }

  function bindGlobal() {
    $('#login-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var username = $('#login-username').value.trim();
      var password = $('#login-password').value;
      var errorEl = $('#login-error');
      if (!username || !password) { errorEl.textContent = 'Введите логин и пароль.'; return; }
      var submit = $('#login-submit'); setBusy(submit, true); errorEl.textContent = '';
      try {
        var data = await api('/api/auth/login', { method: 'POST', body: { username: username, password: password } });
        state.user = normalizeUser(entity(data, 'user', null));
        if (!state.user.id && !state.user.username) throw new apiError('Сервер не вернул данные пользователя.');
        $('#auth-screen').classList.add('is-hidden'); $('#app-screen').classList.remove('is-hidden');
        state.tasks = []; state.users = []; state.departments = []; state.analytics.sales = null; state.metrics = null;
        await Promise.all([loadTasks(), loadUsers(), loadDepartments(), loadTaskStats()]);
        analyticsDates();
        if (currentRole() === 'employee') await loadMyMetrics(); else await loadAnalytics({ silent: true });
        renderNav(); updateHeader(); goTo('overview');
      } catch (error) { if (error.status !== 401) errorEl.textContent = error.message || 'Не удалось войти. Проверьте данные.'; }
      finally { setBusy(submit, false); }
    });
    $('#toggle-login-password').addEventListener('click', function () {
      var input = $('#login-password'); var visible = input.type === 'text'; input.type = visible ? 'password' : 'text'; this.textContent = visible ? 'Показать' : 'Скрыть'; this.setAttribute('aria-label', visible ? 'Показать пароль' : 'Скрыть пароль');
    });
    $('#header-logout').addEventListener('click', logout);
    $('#sidebar-logout').addEventListener('click', logout);
    $('#refresh-button').addEventListener('click', refreshCurrentView);
    $('#sidebar-collapse').addEventListener('click', function () { $('#sidebar').classList.toggle('is-collapsed'); });
    $('#mobile-menu').addEventListener('click', function () { $('#sidebar').classList.toggle('is-open'); });
    document.addEventListener('click', function (event) {
      var view = event.target.closest && event.target.closest('[data-view]');
      if (view && !view.closest('#main-content') && !view.closest('#desktop-nav') && !view.closest('#mobile-nav')) goTo(view.getAttribute('data-view'));
    });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && $('#modal-root').innerHTML) closeModal(); });
  }

  window.addEventListener('DOMContentLoaded', function () {
    bindGlobal();
    bootstrap();
  });
})();
