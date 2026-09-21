const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Try loading dotenv if available
try {
  require('dotenv').config();
} catch (e) {}

const PORT = process.env.PORT || 3000;
const IIKO_HOST = (process.env.IIKO_HOST || 'https://too-burzhui-co.iiko.it').replace(/\/+$/, '');
const IIKO_LOGIN = process.env.IIKO_LOGIN || 'Belyi';
const IIKO_PASSWORD = process.env.IIKO_PASSWORD || '19062025';

// Auth Token Cache
let cachedToken = null;
let tokenExpiresAt = 0;

// Employees Cache
let cachedEmployees = null;
let employeesExpiresAt = 0;

function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

function addDays(dateStr, days = 1) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Request helper
function makeRequest(urlStr, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });

    req.on('error', reject);
    req.setTimeout(25000, () => {
      req.destroy();
      reject(new Error('Request timeout to iiko API'));
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// Get or refresh iiko token
async function getIikoToken(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const passHash = sha1(IIKO_PASSWORD);
  const authUrl = `${IIKO_HOST}/resto/api/auth`;
  const postData = `login=${encodeURIComponent(IIKO_LOGIN)}&pass=${encodeURIComponent(passHash)}`;

  const res = await makeRequest(authUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);

  if (res.status === 200 && res.body) {
    cachedToken = res.body.trim();
    tokenExpiresAt = Date.now() + 25 * 60 * 1000; // 25 min cache
    return cachedToken;
  }

  throw new Error(`iiko auth failed (${res.status}): ${res.body}`);
}

// Authenticated iiko query
async function iikoFetch(urlPath, options = {}, body = null, retry = true) {
  const token = await getIikoToken();
  const url = `${IIKO_HOST}${urlPath}`;
  const headers = Object.assign({}, options.headers, {
    'Cookie': `key=${token}`
  });

  const res = await makeRequest(url, Object.assign({}, options, { headers }), body);

  if ((res.status === 401 || res.status === 403 || res.body.includes('Session expired')) && retry) {
    await getIikoToken(true);
    return iikoFetch(urlPath, options, body, false);
  }

  return res;
}

// Fetch employees map
async function getEmployeesMap() {
  const now = Date.now();
  if (cachedEmployees && now < employeesExpiresAt) {
    return cachedEmployees;
  }

  try {
    const res = await iikoFetch('/resto/api/employees');
    if (res.status === 200) {
      const map = {};
      const xml = res.body;
      const employeeRegex = /<employee>(.*?)<\/employee>/gs;
      let match;
      while ((match = employeeRegex.exec(xml)) !== null) {
        const item = match[1];
        const id = (item.match(/<id>(.*?)<\/id>/) || [])[1];
        const name = (item.match(/<name>(.*?)<\/name>/) || [])[1];
        const code = (item.match(/<code>(.*?)<\/code>/) || [])[1];
        if (id) {
          map[id] = { name: name || 'Не указано', code: code || '' };
        }
      }
      cachedEmployees = map;
      employeesExpiresAt = now + 30 * 60 * 1000;
      return map;
    }
  } catch (e) {
    console.error('Error fetching employees:', e.message);
  }
  return cachedEmployees || {};
}

// API Handlers
async function handleDepartments(req, res) {
  try {
    const apiRes = await iikoFetch('/resto/api/corporation/departments');
    if (apiRes.status !== 200) {
      throw new Error(`iiko returned status ${apiRes.status}`);
    }

    const xml = apiRes.body;
    const items = [];
    const itemRegex = /<corporateItemDto>(.*?)<\/corporateItemDto>/gs;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const content = match[1];
      const type = (content.match(/<type>(.*?)<\/type>/) || [])[1];
      if (type === 'DEPARTMENT') {
        const id = (content.match(/<id>(.*?)<\/id>/) || [])[1];
        const name = (content.match(/<name>(.*?)<\/name>/) || [])[1];
        const code = (content.match(/<code>(.*?)<\/code>/) || [])[1];
        if (id && name) {
          items.push({ id, name, code: code || '' });
        }
      }
    }

    // Sort naturally: B-1, B-2, В-10...
    items.sort((a, b) => {
      return a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' });
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, departments: items }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function handleSales(req, res, urlObj) {
  try {
    const departmentId = urlObj.searchParams.get('departmentId') || 'ALL';
    const from = urlObj.searchParams.get('from');
    const to = urlObj.searchParams.get('to');

    if (!from || !to) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: false, error: 'Параметры from и to обязательны' }));
    }

    // iiko to date is exclusive, so add 1 day
    const toInclusive = addDays(to, 1);

    const baseFilter = {
      "OpenDate.Typed": {
        "filterType": "DateRange",
        "periodType": "CUSTOM",
        "from": from,
        "to": toInclusive
      },
      "OrderDeleted": {
        "filterType": "IncludeValues",
        "values": ["NOT_DELETED"]
      }
    };

    if (departmentId && departmentId !== 'ALL') {
      baseFilter["Department.Id"] = {
        "filterType": "IncludeValues",
        "values": [departmentId]
      };
    }

    // 1. Daily Report
    const bodyDaily = {
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields: ["OpenDate.Typed"],
      aggregateFields: ["DishDiscountSumInt", "DishSumInt", "DiscountSum", "UniqOrderId", "DishDiscountSumInt.average", "DishAmountInt", "GuestNum"],
      filters: baseFilter
    };

    // 2. Payments Report
    const bodyPay = {
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields: ["PayTypes"],
      aggregateFields: ["DishDiscountSumInt", "UniqOrderId"],
      filters: baseFilter
    };

    // 3. Top Dishes
    const bodyDishes = {
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields: ["DishName", "DishCategory"],
      aggregateFields: ["DishAmountInt", "DishDiscountSumInt"],
      filters: baseFilter
    };

    // 4. Hourly Distribution
    const bodyHourly = {
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields: ["OpenTime.Minutes15"],
      aggregateFields: ["DishDiscountSumInt", "UniqOrderId"],
      filters: baseFilter
    };

    // 5. Cashiers Summary
    const bodyCashiers = {
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields: ["Cashier", "Cashier.Code"],
      aggregateFields: ["DishDiscountSumInt", "UniqOrderId", "DishDiscountSumInt.average"],
      filters: baseFilter
    };

    // 6. Upsell Categories (Main dishes, Drinks, Add-ons)
    const bodyUpsell = {
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields: ["DishGroup.TopParent", "DishType"],
      aggregateFields: ["DishAmountInt", "DishDiscountSumInt"],
      filters: baseFilter
    };

    // 7. Cashier Items (Upsell by employee)
    const bodyCashierItems = {
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields: ["Cashier", "DishGroup.TopParent", "DishType"],
      aggregateFields: ["DishAmountInt", "DishDiscountSumInt"],
      filters: baseFilter
    };

    const headers = { 'Content-Type': 'application/json' };

    const [resDaily, resPay, resDishes, resHourly, resCashiers, resUpsell, resCashierItems] = await Promise.all([
      iikoFetch('/resto/api/v2/reports/olap', { method: 'POST', headers }, JSON.stringify(bodyDaily)),
      iikoFetch('/resto/api/v2/reports/olap', { method: 'POST', headers }, JSON.stringify(bodyPay)),
      iikoFetch('/resto/api/v2/reports/olap', { method: 'POST', headers }, JSON.stringify(bodyDishes)),
      iikoFetch('/resto/api/v2/reports/olap', { method: 'POST', headers }, JSON.stringify(bodyHourly)),
      iikoFetch('/resto/api/v2/reports/olap', { method: 'POST', headers }, JSON.stringify(bodyCashiers)),
      iikoFetch('/resto/api/v2/reports/olap', { method: 'POST', headers }, JSON.stringify(bodyUpsell)),
      iikoFetch('/resto/api/v2/reports/olap', { method: 'POST', headers }, JSON.stringify(bodyCashierItems))
    ]);

    const dailyData = (JSON.parse(resDaily.body || '{}').data || []).sort((a, b) => a['OpenDate.Typed'].localeCompare(b['OpenDate.Typed']));
    const payData = JSON.parse(resPay.body || '{}').data || [];
    const dishesData = (JSON.parse(resDishes.body || '{}').data || []).sort((a, b) => (b['DishDiscountSumInt'] || 0) - (a['DishDiscountSumInt'] || 0));
    const hourlyRaw = JSON.parse(resHourly.body || '{}').data || [];
    const cashiersData = (JSON.parse(resCashiers.body || '{}').data || []).sort((a, b) => (b['DishDiscountSumInt'] || 0) - (a['DishDiscountSumInt'] || 0));
    const upsellRaw = JSON.parse(resUpsell.body || '{}').data || [];
    const cashierItemsRaw = JSON.parse(resCashierItems.body || '{}').data || [];

    // Calculate Point-Level Upsell Metrics
    let mainDishesCount = 0;
    let mainDishesRevenue = 0;
    let drinksCount = 0;
    let drinksRevenue = 0;
    let addonsCount = 0;
    let addonsRevenue = 0;

    upsellRaw.forEach(item => {
      const topGroup = String(item['DishGroup.TopParent'] || '');
      const type = String(item['DishType'] || '');
      const amount = Number(item['DishAmountInt'] || 0);
      const revenue = Number(item['DishDiscountSumInt'] || 0);

      if (topGroup.includes('Напитки') || topGroup.toLowerCase().includes('коктейл')) {
        drinksCount += amount;
        drinksRevenue += revenue;
      } else if (topGroup.includes('Модификаторы') || type === 'MODIFIER' || topGroup.includes('УБРАТЬ')) {
        addonsCount += amount;
        addonsRevenue += revenue;
      } else if (!topGroup.includes('Сервисный сбор')) {
        mainDishesCount += amount;
        mainDishesRevenue += revenue;
      }
    });

    const drinkRatioQty = mainDishesCount > 0 ? ((drinksCount / mainDishesCount) * 100).toFixed(1) : '0';
    const drinkRatioRev = mainDishesRevenue > 0 ? ((drinksRevenue / mainDishesRevenue) * 100).toFixed(1) : '0';
    const addonRatioQty = mainDishesCount > 0 ? ((addonsCount / mainDishesCount) * 100).toFixed(1) : '0';
    const addonRatioRev = mainDishesRevenue > 0 ? ((addonsRevenue / mainDishesRevenue) * 100).toFixed(1) : '0';
    const totalUpsellRev = drinksRevenue + addonsRevenue;

    // Calculate Cashier-Level Upsell
    const cashierUpsellMap = {};
    cashierItemsRaw.forEach(row => {
      const c = row['Cashier'] || 'Не указан';
      if (!cashierUpsellMap[c]) {
        cashierUpsellMap[c] = { main: 0, drinks: 0, addons: 0 };
      }
      const topGroup = String(row['DishGroup.TopParent'] || '');
      const type = String(row['DishType'] || '');
      const amount = Number(row['DishAmountInt'] || 0);

      if (topGroup.includes('Напитки') || topGroup.toLowerCase().includes('коктейл')) {
        cashierUpsellMap[c].drinks += amount;
      } else if (topGroup.includes('Модификаторы') || type === 'MODIFIER' || topGroup.includes('УБРАТЬ')) {
        cashierUpsellMap[c].addons += amount;
      } else if (!topGroup.includes('Сервисный сбор')) {
        cashierUpsellMap[c].main += amount;
      }
    });

    // Enrich cashiers data
    cashiersData.forEach(c => {
      const name = c['Cashier'] || 'Не указан';
      const stats = cashierUpsellMap[name] || { main: 0, drinks: 0, addons: 0 };
      c.mainCount = stats.main;
      c.drinkCount = stats.drinks;
      c.addonCount = stats.addons;
      c.drinkRate = stats.main > 0 ? ((stats.drinks / stats.main) * 100).toFixed(1) : '0';
      c.addonRate = stats.main > 0 ? ((stats.addons / stats.main) * 100).toFixed(1) : '0';
    });

    // Aggregate KPI totals
    let totalRevenue = 0;
    let totalGrossRevenue = 0;
    let totalDiscount = 0;
    let totalOrders = 0;
    let totalDishes = 0;
    let totalGuests = 0;

    dailyData.forEach(d => {
      totalRevenue += (d.DishDiscountSumInt || 0);
      totalGrossRevenue += (d.DishSumInt || 0);
      totalDiscount += (d.DiscountSum || 0);
      totalOrders += (d.UniqOrderId || 0);
      totalDishes += (d.DishAmountInt || 0);
      totalGuests += (d.GuestNum || 0);
    });

    const avgCheck = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    // Aggregate Hourly (0 to 23)
    const hourlyMap = {};
    for (let h = 0; h < 24; h++) {
      const pad = String(h).padStart(2, '0');
      hourlyMap[pad] = { hour: `${pad}:00`, revenue: 0, orders: 0 };
    }

    hourlyRaw.forEach(item => {
      const timeStr = String(item['OpenTime.Minutes15'] || '00:00');
      const hour = timeStr.split(':')[0] || '00';
      if (hourlyMap[hour]) {
        hourlyMap[hour].revenue += (item.DishDiscountSumInt || 0);
        hourlyMap[hour].orders += (item.UniqOrderId || 0);
      }
    });

    const hourlyList = Object.values(hourlyMap);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      kpi: {
        totalRevenue,
        totalGrossRevenue,
        totalDiscount,
        totalOrders,
        avgCheck,
        totalDishes,
        totalGuests,
        daysCount: dailyData.length
      },
      daily: dailyData,
      upsell: {
        mainDishesCount,
        mainDishesRevenue,
        drinksCount,
        drinksRevenue,
        drinkRatioQty,
        drinkRatioRev,
        addonsCount,
        addonsRevenue,
        addonRatioQty,
        addonRatioRev,
        totalUpsellRev,
        upsellShare: totalRevenue > 0 ? ((totalUpsellRev / totalRevenue) * 100).toFixed(1) : '0'
      },
      payments: payData.sort((a, b) => (b.DishDiscountSumInt || 0) - (a.DishDiscountSumInt || 0)),
      topDishes: dishesData.slice(0, 20),
      hourly: hourlyList,
      cashiers: cashiersData
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function handleShifts(req, res, urlObj) {
  try {
    const from = urlObj.searchParams.get('from');
    const to = urlObj.searchParams.get('to');
    const departmentId = urlObj.searchParams.get('departmentId');

    if (!from || !to) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: false, error: 'Параметры from и to обязательны' }));
    }

    const toInclusive = addDays(to, 1);
    const [shiftsRes, employeesMap] = await Promise.all([
      iikoFetch(`/resto/api/v2/cashshifts/list?openDateFrom=${from}&openDateTo=${toInclusive}&status=ANY`),
      getEmployeesMap()
    ]);

    if (shiftsRes.status !== 200) {
      throw new Error(`Ошибка загрузки смен: ${shiftsRes.status}`);
    }

    const allShifts = JSON.parse(shiftsRes.body || '[]');

    // If point selected, we filter by target department points
    let filtered = allShifts;
    if (departmentId && departmentId !== 'ALL') {
      // Find matching session numbers from OLAP if pointOfSaleId doesn't match directly
      const olapSessions = await iikoFetch('/resto/api/v2/reports/olap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, JSON.stringify({
        reportType: "SALES",
        buildSummary: false,
        groupByRowFields: ["SessionNum"],
        aggregateFields: ["DishDiscountSumInt"],
        filters: {
          "OpenDate.Typed": { "filterType": "DateRange", "periodType": "CUSTOM", "from": from, "to": toInclusive },
          "Department.Id": { "filterType": "IncludeValues", "values": [departmentId] },
          "OrderDeleted": { "filterType": "IncludeValues", "values": ["NOT_DELETED"] }
        }
      }));

      const sessionNums = new Set(
        (JSON.parse(olapSessions.body || '{}').data || []).map(d => Number(d.SessionNum))
      );

      filtered = allShifts.filter(s => sessionNums.has(Number(s.sessionNumber)));
    }

    // Format shifts with employee names
    const enrichedShifts = filtered.map(s => {
      const mgr = employeesMap[s.managerId] ? employeesMap[s.managerId].name : 'Не указан';
      const resp = employeesMap[s.responsibleUserId] ? employeesMap[s.responsibleUserId].name : 'Не указан';
      return {
        id: s.id,
        sessionNumber: s.sessionNumber,
        status: s.sessionStatus,
        openDate: s.openDate,
        closeDate: s.closeDate,
        manager: mgr,
        responsible: resp,
        payOrders: s.payOrders || 0,
        salesCash: s.salesCash || 0,
        salesCard: s.salesCard || 0,
        cashDiff: s.cashDiff || 0
      };
    }).sort((a, b) => b.sessionNumber - a.sessionNumber);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, shifts: enrichedShifts }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function handleRanking(req, res, urlObj) {
  try {
    const from = urlObj.searchParams.get('from');
    const to = urlObj.searchParams.get('to');

    if (!from || !to) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: false, error: 'Параметры from и to обязательны' }));
    }

    const toInclusive = addDays(to, 1);

    const body = {
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields: ["Department", "Department.Id"],
      aggregateFields: ["DishDiscountSumInt", "UniqOrderId", "DishDiscountSumInt.average"],
      filters: {
        "OpenDate.Typed": { "filterType": "DateRange", "periodType": "CUSTOM", "from": from, "to": toInclusive },
        "OrderDeleted": { "filterType": "IncludeValues", "values": ["NOT_DELETED"] }
      }
    };

    const apiRes = await iikoFetch('/resto/api/v2/reports/olap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify(body));

    const data = JSON.parse(apiRes.body || '{}').data || [];
    data.sort((a, b) => (b.DishDiscountSumInt || 0) - (a.DishDiscountSumInt || 0));

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, ranking: data }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

// Static File Server
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '') safePath = '/index.html';

  const filePath = path.join(__dirname, 'public', safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA
      const indexPath = path.join(__dirname, 'public', 'index.html');
      fs.readFile(indexPath, (indexErr, content) => {
        if (indexErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('404 Not Found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('500 Server Error');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
}

// Server Dispatcher
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
  }

  if (pathname === '/api/departments') {
    return handleDepartments(req, res);
  }

  if (pathname === '/api/sales') {
    return handleSales(req, res, urlObj);
  }

  if (pathname === '/api/shifts') {
    return handleShifts(req, res, urlObj);
  }

  if (pathname === '/api/ranking') {
    return handleRanking(req, res, urlObj);
  }

  // Otherwise serve static frontend
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`[BURЖУЙ Analytics] Server started on port ${PORT}`);
  console.log(`Connecting to iiko: ${IIKO_HOST}`);
});
