let dailyChartInstance = null;
let hourlyChartInstance = null;
let departmentsList = [];

// Helper Formatters
function formatMoney(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '0 ₸';
  return Math.round(Number(amount)).toLocaleString('ru-RU') + ' ₸';
}

function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Math.round(Number(num)).toLocaleString('ru-RU');
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}.${parts[1]}`;
  return dateStr;
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// Mobile Custom Dates Drawer Toggle
function toggleCustomDates() {
  const panel = document.getElementById('custom-dates-panel');
  if (panel) {
    panel.classList.toggle('hidden');
  }
}

function applyCustomDates() {
  const panel = document.getElementById('custom-dates-panel');
  if (panel) {
    panel.classList.add('hidden');
  }
  
  // Deactivate preset buttons
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.className = 'preset-btn shrink-0 px-3 py-1.5 rounded-lg bg-slate-800/90 text-slate-300 hover:text-white border border-slate-700/60 font-medium transition-all text-xs';
  });
  
  const from = document.getElementById('date-from').value;
  const to = document.getElementById('date-to').value;
  const label = document.getElementById('dates-summary-label');
  if (label && from && to) {
    label.textContent = `${formatShortDate(from)} — ${formatShortDate(to)}`;
  }
  
  fetchData();
}

// Preset Handler
function setPreset(preset, btnElement) {
  // Update button styles
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.className = 'preset-btn shrink-0 px-3 py-1.5 rounded-lg bg-slate-800/90 text-slate-300 hover:text-white border border-slate-700/60 font-medium transition-all text-xs';
  });

  if (btnElement) {
    btnElement.className = 'preset-btn active shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-extrabold border border-amber-500 transition-all shadow-sm text-xs';
  }

  // Base date calculation
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  function getOffsetDate(daysBack) {
    const target = new Date(now);
    target.setDate(target.getDate() - daysBack);
    const ty = target.getFullYear();
    const tm = String(target.getMonth() + 1).padStart(2, '0');
    const td = String(target.getDate()).padStart(2, '0');
    return `${ty}-${tm}-${td}`;
  }

  let fromStr = todayStr;
  let toStr = todayStr;

  if (preset === 'today') {
    fromStr = todayStr;
    toStr = todayStr;
  } else if (preset === '5days') {
    fromStr = getOffsetDate(5);
    toStr = getOffsetDate(1);
  } else if (preset === '7days') {
    fromStr = getOffsetDate(7);
    toStr = todayStr;
  } else if (preset === '14days') {
    fromStr = getOffsetDate(14);
    toStr = todayStr;
  } else if (preset === 'month') {
    fromStr = `${y}-${m}-01`;
    toStr = todayStr;
  }

  document.getElementById('date-from').value = fromStr;
  document.getElementById('date-to').value = toStr;

  // Update summary label on button
  const label = document.getElementById('dates-summary-label');
  if (label) {
    label.textContent = `${formatShortDate(fromStr)} — ${formatShortDate(toStr)}`;
  }

  // Hide custom panel if open
  const panel = document.getElementById('custom-dates-panel');
  if (panel) panel.classList.add('hidden');

  fetchData();
}

// Load Departments on Init
async function loadDepartments() {
  const select = document.getElementById('department-select');
  try {
    const res = await fetch('/api/departments');
    const data = await res.json();

    if (!data.success) throw new Error(data.error);

    departmentsList = data.departments;
    select.innerHTML = '<option value="ALL">⭐ Вся сеть (Сводный)</option>';

    let b1Id = null;
    departmentsList.forEach(dept => {
      const opt = document.createElement('option');
      opt.value = dept.id;
      opt.textContent = `${dept.name} ${dept.code ? `(${dept.code})` : ''}`;
      select.appendChild(opt);

      // Look for B-1 as default
      if (dept.name.trim() === 'B-1' || dept.name.trim() === 'В-1' || dept.code === '2') {
        b1Id = dept.id;
      }
    });

    if (b1Id) {
      select.value = b1Id;
    } else if (departmentsList.length > 0) {
      select.value = departmentsList[0].id;
    }

    select.addEventListener('change', () => fetchData());

    fetchData();
  } catch (err) {
    console.error('Failed to load departments:', err);
    select.innerHTML = '<option value="">Ошибка загрузки точек</option>';
    showError('Не удалось загрузить список торговых точек: ' + err.message);
  }
}

function showLoading(msg) {
  const el = document.getElementById('loading-state');
  const text = document.getElementById('loading-text');
  const time = document.getElementById('loading-time');
  const btnIcon = document.getElementById('btn-icon');
  
  if (el) el.classList.remove('hidden');
  if (text) text.textContent = msg || 'Загрузка данных iiko...';
  if (time) time.textContent = new Date().toLocaleTimeString('ru-RU');
  if (btnIcon) btnIcon.classList.add('animate-spin');
  document.getElementById('error-state').classList.add('hidden');
}

function hideLoading() {
  const el = document.getElementById('loading-state');
  const btnIcon = document.getElementById('btn-icon');
  if (el) el.classList.add('hidden');
  if (btnIcon) btnIcon.classList.remove('animate-spin');
}

function showError(msg) {
  hideLoading();
  const el = document.getElementById('error-state');
  const text = document.getElementById('error-text');
  if (el) el.classList.remove('hidden');
  if (text) text.textContent = msg;
}

// Main Data Fetch
async function fetchData() {
  const deptSelect = document.getElementById('department-select');
  const deptId = deptSelect.value || 'ALL';
  const from = document.getElementById('date-from').value;
  const to = document.getElementById('date-to').value;

  if (!from || !to) {
    showError('Пожалуйста, укажите даты');
    return;
  }

  showLoading(`Загрузка "${deptSelect.options[deptSelect.selectedIndex]?.text || deptId}"...`);

  try {
    const [salesRes, shiftsRes, rankingRes] = await Promise.all([
      fetch(`/api/sales?departmentId=${encodeURIComponent(deptId)}&from=${from}&to=${to}`).then(r => r.json()),
      fetch(`/api/shifts?departmentId=${encodeURIComponent(deptId)}&from=${from}&to=${to}`).then(r => r.json()),
      fetch(`/api/ranking?from=${from}&to=${to}`).then(r => r.json())
    ]);

    if (!salesRes.success) throw new Error(salesRes.error || 'Ошибка загрузки продаж');

    hideLoading();

    // 1. Render KPIs
    renderKPIs(salesRes.kpi);

    // 2. Render Charts
    renderDailyChart(salesRes.daily);
    renderHourlyChart(salesRes.hourly);

    // 3. Render Cashiers Table
    renderCashiers(salesRes.cashiers, salesRes.kpi.totalRevenue);

    // 4. Render Shifts Table
    renderShifts(shiftsRes.success ? shiftsRes.shifts : []);

    // 5. Render Payments
    renderPayments(salesRes.payments, salesRes.kpi.totalRevenue);

    // 6. Render Top Dishes
    renderTopDishes(salesRes.topDishes);

    // 7. Render Network Ranking
    renderRanking(rankingRes.success ? rankingRes.ranking : [], deptId);

  } catch (err) {
    console.error('Fetch error:', err);
    showError('Ошибка: ' + err.message);
  }
}

// Render Functions
function renderKPIs(kpi) {
  if (!kpi) return;
  document.getElementById('kpi-revenue').textContent = formatMoney(kpi.totalRevenue);
  const days = kpi.daysCount || 1;
  document.getElementById('kpi-revenue-avg').textContent = formatMoney(kpi.totalRevenue / days);
  document.getElementById('kpi-days-count').textContent = `${days} дн.`;

  document.getElementById('kpi-orders').textContent = formatNumber(kpi.totalOrders);
  document.getElementById('kpi-orders-avg').textContent = (kpi.totalOrders / days).toFixed(1);
  document.getElementById('kpi-guests').textContent = formatNumber(kpi.totalGuests);

  document.getElementById('kpi-avg-check').textContent = formatMoney(kpi.avgCheck);
  document.getElementById('kpi-discount').textContent = formatMoney(kpi.totalDiscount);

  document.getElementById('kpi-dishes').textContent = formatNumber(kpi.totalDishes) + ' шт.';
  const perOrder = kpi.totalOrders > 0 ? (kpi.totalDishes / kpi.totalOrders).toFixed(1) : '0';
  document.getElementById('kpi-dishes-per-order').textContent = `${perOrder} шт.`;
}

function renderDailyChart(daily) {
  const ctx = document.getElementById('dailyChart').getContext('2d');
  const isMobile = window.innerWidth < 640;

  if (dailyChartInstance) {
    dailyChartInstance.destroy();
  }

  if (!daily || daily.length === 0) return;

  const labels = daily.map(d => {
    const raw = d['OpenDate.Typed'];
    const parts = raw.split('-');
    return `${parts[2]}.${parts[1]}`;
  });

  const revenues = daily.map(d => d.DishDiscountSumInt || 0);
  const orders = daily.map(d => d.UniqOrderId || 0);

  dailyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Выручка (₸)',
          data: revenues,
          backgroundColor: 'rgba(245, 158, 11, 0.85)',
          hoverBackgroundColor: '#f59e0b',
          borderRadius: 4,
          yAxisID: 'y'
        },
        {
          label: 'Чеков',
          data: orders,
          type: 'line',
          borderColor: '#60a5fa',
          backgroundColor: '#60a5fa',
          borderWidth: 2,
          pointRadius: isMobile ? 3 : 4,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#94a3b8', font: { size: isMobile ? 9 : 11 }, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              if (context.dataset.yAxisID === 'y') {
                return `Выручка: ${formatMoney(context.raw)}`;
              }
              return `Чеков: ${context.raw}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: isMobile ? 9 : 11 }, maxRotation: 0 }
        },
        y: {
          position: 'left',
          grid: { color: 'rgba(51, 65, 85, 0.3)' },
          ticks: {
            color: '#f59e0b',
            font: { size: isMobile ? 8 : 10 },
            callback: v => (v >= 1000 ? (v / 1000) + 'k' : v)
          }
        },
        y1: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#60a5fa', font: { size: isMobile ? 8 : 10 } }
        }
      }
    }
  });
}

function renderHourlyChart(hourly) {
  const ctx = document.getElementById('hourlyChart').getContext('2d');
  const isMobile = window.innerWidth < 640;

  if (hourlyChartInstance) {
    hourlyChartInstance.destroy();
  }

  if (!hourly || hourly.length === 0) return;

  const labels = hourly.map(h => h.hour);
  const revenues = hourly.map(h => h.revenue || 0);

  // Find peak hour
  let maxHour = '';
  let maxRev = 0;
  hourly.forEach(h => {
    if (h.revenue > maxRev) {
      maxRev = h.revenue;
      maxHour = h.hour;
    }
  });

  const peakHint = document.getElementById('peak-hour-hint');
  if (maxRev > 0) {
    peakHint.innerHTML = `🔥 <b>Пик:</b> ${maxHour} (${formatMoney(maxRev)})`;
  } else {
    peakHint.textContent = 'Нет данных по часам';
  }

  hourlyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Выручка (₸)',
        data: revenues,
        backgroundColor: hourly.map(h => h.hour === maxHour ? '#f59e0b' : 'rgba(100, 116, 139, 0.6)'),
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => `Выручка: ${formatMoney(context.raw)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#64748b',
            font: { size: isMobile ? 8 : 9 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: isMobile ? 6 : 12
          }
        },
        y: {
          grid: { color: 'rgba(51, 65, 85, 0.3)' },
          ticks: {
            color: '#64748b',
            font: { size: isMobile ? 8 : 9 },
            callback: v => (v >= 1000 ? (v / 1000) + 'k' : v)
          }
        }
      }
    }
  });
}

function renderCashiers(cashiers, totalRev) {
  const tbody = document.getElementById('cashiers-table-body');
  const countEl = document.getElementById('cashiers-count');
  tbody.innerHTML = '';

  if (!cashiers || cashiers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-slate-500">Нет данных о кассирах</td></tr>';
    countEl.textContent = '0 чел.';
    return;
  }

  countEl.textContent = `${cashiers.length} чел.`;

  cashiers.forEach((c, index) => {
    const rev = c.DishDiscountSumInt || 0;
    const orders = c.UniqOrderId || 0;
    const avg = c['DishDiscountSumInt.average'] || (orders > 0 ? rev / orders : 0);
    const share = totalRev > 0 ? ((rev / totalRev) * 100).toFixed(1) : '0';

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/50 transition-colors';

    let badge = '';
    if (index === 0) badge = '👑';
    else if (index === 1) badge = '🥈';
    else if (index === 2) badge = '🥉';

    tr.innerHTML = `
      <td class="p-2 sm:p-2.5">
        <div class="font-semibold text-white flex items-center gap-1 text-[11px] sm:text-xs">
          <span>${badge}</span>
          <span class="truncate max-w-[110px] sm:max-w-none">${c.Cashier || 'Не указан'}</span>
        </div>
        <span class="text-[9px] sm:text-[10px] text-slate-500 block">Таб: ${c['Cashier.Code'] || '—'} • ${share}%</span>
      </td>
      <td class="p-2 sm:p-2.5 text-right font-medium text-slate-300 text-[11px] sm:text-xs">${formatNumber(orders)}</td>
      <td class="p-2 sm:p-2.5 text-right font-medium text-purple-300 text-[11px] sm:text-xs">${formatMoney(avg)}</td>
      <td class="p-2 sm:p-2.5 text-right font-bold text-amber-400 text-[11px] sm:text-xs">${formatMoney(rev)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderShifts(shifts) {
  const tbody = document.getElementById('shifts-table-body');
  const countEl = document.getElementById('shifts-count');
  tbody.innerHTML = '';

  if (!shifts || shifts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-slate-500">Смены не найдены</td></tr>';
    countEl.textContent = '0 смен';
    return;
  }

  countEl.textContent = `${shifts.length} смен`;

  shifts.forEach(s => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/50 transition-colors';

    const isOpen = s.status === 'OPEN';
    const statusBadge = isOpen
      ? '<span class="text-[8px] sm:text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-bold">ОТКРЫТА</span>'
      : '<span class="text-[8px] sm:text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-400">ЗАКРЫТА</span>';

    tr.innerHTML = `
      <td class="p-2 sm:p-2.5">
        <span class="font-bold text-amber-400 text-[11px] sm:text-xs">#${s.sessionNumber}</span>
        <div class="mt-0.5">${statusBadge}</div>
      </td>
      <td class="p-2 sm:p-2.5">
        <div class="text-white text-[10px] sm:text-xs">${formatDateTime(s.openDate)}</div>
        <div class="text-[9px] sm:text-[10px] text-slate-500">${s.closeDate ? formatDateTime(s.closeDate) : 'В работе'}</div>
      </td>
      <td class="p-2 sm:p-2.5">
        <div class="font-medium text-slate-200 text-[10px] sm:text-xs truncate max-w-[90px] sm:max-w-none">${s.manager}</div>
        <div class="text-[9px] sm:text-[10px] text-slate-500 truncate max-w-[90px] sm:max-w-none">Отв: ${s.responsible}</div>
      </td>
      <td class="p-2 sm:p-2.5 text-right">
        <div class="font-bold text-white text-[11px] sm:text-xs">${formatMoney(s.payOrders)}</div>
        <div class="text-[9px] sm:text-[10px] text-slate-400">Нал: ${formatMoney(s.salesCash)}</div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPayments(payments, totalRev) {
  const container = document.getElementById('payments-list');
  container.innerHTML = '';

  if (!payments || payments.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-500">Нет данных по оплатам</p>';
    return;
  }

  payments.forEach(p => {
    const name = p.PayTypes || 'Без типа';
    const sum = p.DishDiscountSumInt || 0;
    const orders = p.UniqOrderId || 0;
    const pct = totalRev > 0 ? ((sum / totalRev) * 100).toFixed(1) : '0';

    let color = 'bg-slate-500';
    let textColor = 'text-slate-300';
    if (name.includes('Kaspi')) { color = 'bg-amber-500'; textColor = 'text-amber-400'; }
    else if (name.includes('Наличные') || name.includes('НАЛИЧ')) { color = 'bg-emerald-500'; textColor = 'text-emerald-400'; }
    else if (name.includes('БЕРЕКЕ') || name.includes('Эквайринг')) { color = 'bg-blue-500'; textColor = 'text-blue-400'; }
    else if (name.includes('Яндекс')) { color = 'bg-yellow-400'; textColor = 'text-yellow-400'; }
    else if (name.includes('WOLT')) { color = 'bg-sky-400'; textColor = 'text-sky-400'; }
    else if (name.includes('Glovo')) { color = 'bg-amber-600'; textColor = 'text-amber-500'; }

    const row = document.createElement('div');
    row.innerHTML = `
      <div class="flex justify-between text-[11px] sm:text-xs mb-1">
        <span class="font-semibold ${textColor} truncate mr-2">${name} (${pct}%)</span>
        <span class="text-slate-300 shrink-0">${formatMoney(sum)} <span class="text-slate-500">(${orders}ч)</span></span>
      </div>
      <div class="h-1.5 sm:h-2 bg-slate-800 rounded-full overflow-hidden">
        <div class="h-full ${color} rounded-full" style="width: ${Math.min(100, Math.max(2, pct))}%"></div>
      </div>
    `;
    container.appendChild(row);
  });
}

function renderTopDishes(dishes) {
  const container = document.getElementById('dishes-list');
  container.innerHTML = '';

  if (!dishes || dishes.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-500">Нет данных о блюдах</p>';
    return;
  }

  dishes.slice(0, 10).forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between p-1.5 sm:p-2 bg-slate-950/60 rounded-xl border border-slate-800/80 hover:bg-slate-800/40 transition-colors';
    
    let rankClass = 'text-slate-400 font-bold text-xs w-4 sm:w-5 shrink-0';
    if (i === 0) rankClass = 'text-amber-400 font-extrabold text-sm w-4 sm:w-5 shrink-0';
    else if (i === 1) rankClass = 'text-slate-300 font-bold text-xs w-4 sm:w-5 shrink-0';
    else if (i === 2) rankClass = 'text-amber-600 font-bold text-xs w-4 sm:w-5 shrink-0';

    row.innerHTML = `
      <div class="flex items-center gap-1.5 sm:gap-2 overflow-hidden mr-2">
        <span class="${rankClass}">#${i + 1}</span>
        <div class="truncate">
          <p class="text-[11px] sm:text-xs font-semibold text-white truncate">${d.DishName || 'Неизвестно'}</p>
          <span class="text-[9px] sm:text-[10px] text-slate-400 block truncate">${d.DishCategory || 'Блюда'} • ${formatNumber(d.DishAmountInt)} шт.</span>
        </div>
      </div>
      <span class="text-[11px] sm:text-xs font-bold text-amber-400 whitespace-nowrap shrink-0">${formatMoney(d.DishDiscountSumInt)}</span>
    `;
    container.appendChild(row);
  });
}

function renderRanking(ranking, currentDeptId) {
  const container = document.getElementById('ranking-list');
  container.innerHTML = '';

  if (!ranking || ranking.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-500">Нет данных рейтинга</p>';
    return;
  }

  ranking.forEach((item, i) => {
    const isCurrent = item['Department.Id'] === currentDeptId;
    const row = document.createElement('div');
    
    let bgClass = isCurrent
      ? 'bg-amber-500/10 border-amber-500/30 ring-1 ring-amber-500/20 shadow-sm'
      : 'bg-slate-950/50 border-slate-800 hover:bg-slate-800/40';

    let rankBadge = `<span class="text-[11px] sm:text-xs font-bold text-slate-400 w-5 sm:w-6 shrink-0">#${i + 1}</span>`;
    if (i === 0) rankBadge = '<span class="text-xs sm:text-sm font-extrabold text-amber-400 w-5 sm:w-6 shrink-0">🥇</span>';
    else if (i === 1) rankBadge = '<span class="text-xs sm:text-sm font-extrabold text-slate-300 w-5 sm:w-6 shrink-0">🥈</span>';
    else if (i === 2) rankBadge = '<span class="text-xs sm:text-sm font-extrabold text-amber-600 w-5 sm:w-6 shrink-0">🥉</span>';

    row.className = `flex items-center justify-between p-1.5 sm:p-2 rounded-xl border ${bgClass} transition-colors cursor-pointer active:scale-98`;
    row.onclick = () => {
      document.getElementById('department-select').value = item['Department.Id'];
      window.scrollTo({ top: 0, behavior: 'smooth' });
      fetchData();
    };

    row.innerHTML = `
      <div class="flex items-center gap-1.5 sm:gap-2 overflow-hidden mr-2">
        ${rankBadge}
        <div class="truncate">
          <p class="text-[11px] sm:text-xs font-semibold ${isCurrent ? 'text-amber-300 font-bold' : 'text-white'} truncate">
            ${item.Department} ${isCurrent ? '<span class="text-[8px] bg-amber-500/20 text-amber-300 px-1 py-0.2 rounded uppercase font-bold">Вы</span>' : ''}
          </p>
          <span class="text-[9px] sm:text-[10px] text-slate-400 block truncate">${formatNumber(item.UniqOrderId)} чек. • ср. ${formatMoney(item['DishDiscountSumInt.average'])}</span>
        </div>
      </div>
      <span class="text-[11px] sm:text-xs font-bold ${isCurrent ? 'text-amber-300' : 'text-white'} whitespace-nowrap shrink-0">${formatMoney(item.DishDiscountSumInt)}</span>
    `;
    container.appendChild(row);
  });
}

// Initial bootstrap
window.addEventListener('DOMContentLoaded', () => {
  const initialBtn = document.querySelector('.preset-btn.active');
  setPreset('5days', initialBtn);
  loadDepartments();
});
