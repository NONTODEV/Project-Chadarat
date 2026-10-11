import {
  state, isTherapist, sessionsForDay, sessionsForMonth, sessionsForYear, sessionsForHalfMonth,
  expensesForDay, expensesForMonth, expensesForYear, expensesForHalfMonth,
  packagesForDay, packagesForMonth, packagesForYear, packagesForHalfMonth,
  availableMonths, availableYears, availableHalfMonths,
  outstandingBalanceBeforeMonth, minDailyWage, leavesOnDate,
} from '../store.js';
import { THB, esc, fmtDate, todayISO, halfMonthLabel } from '../utils.js';

const PERIOD_STORAGE_KEY = 'chadarat_dashboard_period';
const savedPeriod = JSON.parse(localStorage.getItem(PERIOD_STORAGE_KEY) || '{}');

function defaultHalfMonth() {
  const d = new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${month}-${d.getDate() <= 15 ? 'H1' : 'H2'}`;
}

let periodType = savedPeriod.periodType || 'monthly'; // daily | half-month | monthly | yearly
let selectedDay = savedPeriod.selectedDay || todayISO();
let selectedHalfMonth = savedPeriod.selectedHalfMonth || defaultHalfMonth();
let selectedMonth = savedPeriod.selectedMonth || null; // lazily defaulted to current month
let selectedYear = savedPeriod.selectedYear || null; // lazily defaulted to current year
let expandedDays = new Set();

function savePeriod() {
  localStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify({ periodType, selectedDay, selectedHalfMonth, selectedMonth, selectedYear }));
}

function halfMonthPeriodLabel(period) {
  const month = period.slice(0, 7);
  const half = period.endsWith('H1') ? 1 : 2;
  return halfMonthLabel(month, half);
}

// สรุปค่าคอมรายวันแยกตามพนักงาน + ยอดเบิกล่วงหน้าปัจจุบันของแต่ละคน
function dailyEmployeeBreakdown(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = `${s.date}|${s.employeeId}`;
    if (!map.has(key)) map.set(key, { date: s.date, employeeId: s.employeeId, employeeName: s.employeeName, revenue: 0, commission: 0, hasIssue: false });
    const row = map.get(key);
    row.revenue += (Number(s.customerPrice) || 0) - (Number(s.discount) || 0);
    row.commission += Number(s.commission) || 0;
    if (s.late || s.leftEarly) row.hasIssue = true;
  }
  return Array.from(map.values()).sort((a, b) => {
    const byDate = (b.date || '').localeCompare(a.date || '');
    return byDate !== 0 ? byDate : (a.employeeName || '').localeCompare(b.employeeName || '', 'th');
  });
}

// ถ้าค่าคอมวันนั้นไม่ถึงค่าแรงขั้นต่ำประกัน (และไม่ได้มาสาย/ออกก่อนเวลา) ร้านจ่ายเพิ่มให้ครบ
// ขั้นต่ำ — โชว์ "+X ประกัน" บอกว่าเพิ่มให้เท่าไหร่ ไม่งั้นดูเหมือนค่าคอมจริงเฉยๆ
// hasRecord=false คือไม่มีบันทึกการนวดเลยวันนั้น (แถวเติม 0 ของมุมมองรายวัน) เลยไม่ถือว่า
// ได้ค่าประกัน เพราะไม่มีหลักฐานว่ามาทำงานจริง
function commissionCellHtml(row, hasRecord = true) {
  if (!hasRecord) return `<div>${THB(row.commission)}</div>`;
  const topUp = guaranteeTopUp(row);
  return `<div>${THB(row.commission)}${topUp > 0 ? `<div class="cell-sub">+${THB(topUp)} ประกัน</div>` : ''}</div>`;
}

function guaranteeTopUp(row) {
  const minWage = minDailyWage();
  return !row.hasIssue && row.commission < minWage ? minWage - row.commission : 0;
}

// ยอดที่ร้านต้องจ่ายจริงให้หมอคนนั้นวันนั้น (ค่าคอม + เงินประกันที่เติมให้ถ้ามี)
function guaranteedAmount(row, hasRecord = true) {
  if (!hasRecord) return 0;
  return row.commission + guaranteeTopUp(row);
}

// รายเดือน/รายปีมีหลายวันซ้อนกัน ถ้าโชว์เป็นตารางแบนรายคน-รายวันจะยาวจนอ่านยาก
// เลยจัดกลุ่มเป็นรายวัน พับ/กางดูรายละเอียดรายคนได้ทีละวันแทน (รายวันไม่ต้องจัดกลุ่มเพราะมีวันเดียวอยู่แล้ว)
function groupByDay(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, { date: r.date, rows: [] });
    map.get(r.date).rows.push(r);
  }
  return Array.from(map.values()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function dayGroupHtml(day) {
  const open = expandedDays.has(day.date);
  const dayTotal = day.rows.reduce((sum, r) => sum + guaranteedAmount(r), 0);
  return `
    <div class="widget" style="padding-bottom:${open ? '8px' : '0'}">
      <button class="widget-head" data-toggle-day="${day.date}" style="width:100%;border:none;background:none;cursor:pointer;text-align:left;padding:14px 0">
        <h2>${open ? '▾' : '▸'} ${fmtDate(day.date)}</h2>
        <span class="cell-sub">${day.rows.length} คน · รวมต้องจ่าย ${THB(dayTotal)}</span>
      </button>
      ${open ? `
        <div class="drop-anim table-wrap flat" style="margin-bottom:12px">
          <table>
            <thead><tr><th>พนักงาน</th><th class="num">ค่าคอม</th><th class="num">ต้องจ่าย</th><th class="num">เบิกล่วงหน้า</th></tr></thead>
            <tbody>
              ${day.rows.map((r) => `
                <tr>
                  <td data-label="พนักงาน">${esc(r.employeeName)}</td>
                  <td class="num" data-label="ค่าคอม">${commissionCellHtml(r)}</td>
                  <td class="num" data-label="ต้องจ่าย"><b>${THB(guaranteedAmount(r))}</b></td>
                  <td class="num" data-label="เบิกล่วงหน้า">${r.owed > 0 ? THB(r.owed) : '-'}</td>
                </tr>
              `).join('')}
              <tr style="font-weight:700">
                <td data-label="รวม">รวมต้องจ่ายหมอนวด</td>
                <td class="num" data-label="ค่าคอม"></td>
                <td class="num" data-label="ต้องจ่าย">${THB(dayTotal)}</td>
                <td class="num" data-label="เบิกล่วงหน้า"></td>
              </tr>
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

export function renderDashboard() {
  const el = document.getElementById('dashboard');
  if (!el) return;

  const months = availableMonths();
  const years = availableYears();
  const halfMonths = availableHalfMonths();
  if (!selectedMonth || !months.includes(selectedMonth)) selectedMonth = months[0];
  if (!selectedYear || !years.includes(selectedYear)) selectedYear = years[0];
  if (!selectedHalfMonth || !halfMonths.includes(selectedHalfMonth)) selectedHalfMonth = halfMonths[0];

  let periodSessions, periodExpenses, periodPackages, periodLabel;
  if (periodType === 'daily') {
    periodSessions = sessionsForDay(selectedDay);
    periodExpenses = expensesForDay(selectedDay);
    periodPackages = packagesForDay(selectedDay);
    periodLabel = fmtDate(selectedDay);
  } else if (periodType === 'half-month') {
    periodSessions = sessionsForHalfMonth(selectedHalfMonth);
    periodExpenses = expensesForHalfMonth(selectedHalfMonth);
    periodPackages = packagesForHalfMonth(selectedHalfMonth);
    periodLabel = halfMonthPeriodLabel(selectedHalfMonth);
  } else if (periodType === 'yearly') {
    periodSessions = sessionsForYear(selectedYear);
    periodExpenses = expensesForYear(selectedYear);
    periodPackages = packagesForYear(selectedYear);
    periodLabel = `ปี ${selectedYear}`;
  } else {
    periodSessions = sessionsForMonth(selectedMonth);
    periodExpenses = expensesForMonth(selectedMonth);
    periodPackages = packagesForMonth(selectedMonth);
    periodLabel = selectedMonth;
  }

  const activeEmployees = state.employees.filter((e) => e.active !== false).length;
  const revenue = periodSessions.reduce((sum, s) => sum + (Number(s.customerPrice) || 0) - (Number(s.discount) || 0), 0);
  // ใช้ guaranteedAmount ต่อคน-ต่อวัน (สูตรเดียวกับตาราง "ค่าคอมแยกตามพนักงาน" ด้านล่าง) แทน
  // ค่าคอมดิบ เพราะร้านจ่ายเงินประกันขั้นต่ำเพิ่มให้จริงเมื่อค่าคอมวันนั้นไม่ถึง ถ้านับแค่ค่าคอมดิบ
  // ต้นทุนพนักงาน/รายได้สุทธิจะต่ำกว่าความเป็นจริง
  const employeeDayRows = dailyEmployeeBreakdown(periodSessions);
  const commission = employeeDayRows.reduce((sum, r) => sum + guaranteedAmount(r), 0);
  const expenseTotal = periodExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const packageRevenue = periodPackages.reduce((sum, p) => sum + (Number(p.price) || 0), 0);
  // แม่บ้านไม่มี session ให้นับค่าคอมจากที่นี่ เงินเดือนตายตัวของแม่บ้าน (fixedSalary ต่อรอบ
  // ครึ่งเดือน) จึงไม่เคยถูกหักเป็นต้นทุนในหน้านี้เลยถ้าไม่บวกเข้ามาตรงนี้เอง — คูณตามจำนวนรอบ
  // ที่ครอบคลุมในมุมมองนั้น (ครึ่งเดือน=1, เดือน=2, ปี=24) ส่วนมุมมองรายวันไม่หัก เพราะเงินเดือน
  // ตายตัวไม่ได้จ่ายเป็นรายวัน เฉลี่ยลงวันจะคลาดเคลื่อนมากกว่าไม่หักเลย
  const housekeeperSalaryPerRound = state.employees
    .filter((e) => e.active !== false && !isTherapist(e))
    .reduce((sum, e) => sum + (Number(e.fixedSalary) || 0), 0);
  const housekeeperRounds = periodType === 'half-month' ? 1 : periodType === 'monthly' ? 2 : periodType === 'yearly' ? 24 : 0;
  const housekeeperCost = housekeeperSalaryPerRound * housekeeperRounds;
  // "รายได้ร้าน" ข้างบนตั้งใจโชว์แยกเฉพาะยอดจากการนวด (ไม่รวมแพ็กเกจ เพราะมีการ์ด "ยอดขาย
  // แพ็กเกจ" แยกให้ดูอยู่แล้ว) แต่ "รายได้สุทธิ" ต้องเป็นกำไรจริงทั้งหมด จึงต้องรวมยอดขาย
  // แพ็กเกจเข้ามาด้วย ไม่งั้นเดือนที่มีขายแพ็กเกจ ตัวเลขนี้จะไม่ตรงกับใบสรุปรายได้ซึ่งรวมไว้แล้ว
  const netRevenue = revenue + packageRevenue - commission - expenseTotal - housekeeperCost;

  // ค่าคอมของพาร์ทไทม์นับรวมอยู่ใน "commission" (เลยไม่ต้องหักซ้ำใน netRevenue) แต่พาร์ทไทม์
  // จ่ายเงินสดให้ทุกวันตอนเลิกงานแล้ว (ไม่รอจ่ายงวดแบบพนักงานประจำ) เลยแยกโชว์เป็นยอดของตัวเอง
  // ไว้ดูว่าจ่ายเงินสดออกไปให้พาร์ทไทม์วันนี้/ช่วงนี้เท่าไรแล้ว
  const parttimeIds = new Set(state.employees.filter((e) => e.role === 'parttime').map((e) => e.id));
  const parttimeCommission = employeeDayRows
    .filter((r) => parttimeIds.has(r.employeeId))
    .reduce((sum, r) => sum + guaranteedAmount(r), 0);

  // มานวดครั้งเดียวแต่ทำหลายบริการ จะถูกบันทึกเป็นหลาย session แยกกันแต่แชร์ visitId เดียวกัน
  // (ของเก่าที่ไม่มี visitId ใช้ id ตัวเองแทน = กลุ่มละ 1 รายการ) — กลุ่มรวมกันก่อนตัด 10 รายการ
  // ล่าสุด ไม่งั้นมานวด 1 ครั้ง 2-3 บริการจะเห็นเป็นหลายแถวแยกกันในตารางนี้
  const recentVisits = Array.from(
    periodSessions.reduce((map, s) => {
      const key = s.visitId || s.id;
      if (!map.has(key)) map.set(key, { date: s.date, employeeName: s.employeeName, items: [] });
      map.get(key).items.push(s);
      return map;
    }, new Map()).values()
  )
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 10);

  // '9999-99' อยู่หลังทุกงวดจริงเสมอ เพื่อให้ได้ยอดเบิกค้าง "ปัจจุบันจริง" ที่ไม่ขึ้นกับว่า
  // ตอนนี้เดือน/ครึ่งเดือนไหน (สอดคล้องกับวิธีคิดในหน้าเงินเดือน)
  const dailyBreakdown = employeeDayRows.map((row) => ({
    ...row,
    owed: outstandingBalanceBeforeMonth(row.employeeId, '9999-99'),
  }));
  const dayGroups = periodType === 'daily' ? [] : groupByDay(dailyBreakdown);

  // มุมมองรายวันมีแค่วันเดียว เลยโชว์พนักงานนวดที่ยังทำงานอยู่ทุกคน แม้วันนั้นยังไม่มี
  // รายได้เลย (0 บาท) จะได้เห็นว่าใครยังไม่ได้บันทึกอะไรเลยในวันนั้น
  const leavesToday = periodType === 'daily' ? leavesOnDate(selectedDay) : [];
  const dailyRowsWithZero = periodType !== 'daily' ? [] : state.employees
    .filter((e) => e.active !== false && isTherapist(e))
    .map((e) => {
      const match = dailyBreakdown.find((r) => r.employeeId === e.id);
      return {
        employeeId: e.id,
        employeeName: e.name,
        revenue: match ? match.revenue : 0,
        commission: match ? match.commission : 0,
        hasIssue: match ? match.hasIssue : false,
        hasRecord: !!match,
        onLeave: leavesToday.some((l) => l.employeeId === e.id),
        owed: outstandingBalanceBeforeMonth(e.id, '9999-99'),
      };
    })
    .sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || '', 'th'));
  const dailyTotalPay = dailyRowsWithZero.reduce((sum, r) => sum + guaranteedAmount(r, r.hasRecord), 0);

  el.innerHTML = `
    <div class="widget-head" style="margin-bottom:10px">
      <div class="seg-toggle">
        <button data-period="daily" class="${periodType === 'daily' ? 'active' : ''}">รายวัน</button>
        <button data-period="half-month" class="${periodType === 'half-month' ? 'active' : ''}">รายครึ่งเดือน</button>
        <button data-period="monthly" class="${periodType === 'monthly' ? 'active' : ''}">รายเดือน</button>
        <button data-period="yearly" class="${periodType === 'yearly' ? 'active' : ''}">รายปี</button>
      </div>
      ${periodType === 'daily' ? `<input type="date" class="month-filter" id="dash_day" aria-label="เลือกวันที่" value="${selectedDay}" />` : ''}
      ${periodType === 'half-month' ? `
        <select class="month-filter" id="dash_halfmonth" aria-label="เลือกครึ่งเดือน">
          ${halfMonths.map((p) => `<option value="${p}" ${p === selectedHalfMonth ? 'selected' : ''}>${esc(halfMonthPeriodLabel(p))}</option>`).join('')}
        </select>
      ` : ''}
      ${periodType === 'monthly' ? `
        <select class="month-filter" id="dash_month" aria-label="เลือกเดือน">
          ${months.map((m) => `<option value="${m}" ${m === selectedMonth ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      ` : ''}
      ${periodType === 'yearly' ? `
        <select class="month-filter" id="dash_year" aria-label="เลือกปี">
          ${years.map((y) => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      ` : ''}
    </div>

    <div class="summary-cards">
      <div class="summary-card"><span>พนักงานที่ทำงานอยู่</span><b>${activeEmployees} คน</b></div>
      <div class="summary-card"><span>ยอดนวด (${esc(periodLabel)})</span><b>${periodSessions.length} ครั้ง</b></div>
      <div class="summary-card"><span>รายได้ร้าน (${esc(periodLabel)})</span><b>${THB(revenue)}</b></div>
      <div class="summary-card"><span>ค่าคอม (${esc(periodLabel)})</span><b>${THB(commission)}</b></div>
      <div class="summary-card"><span>รายจ่ายจิปาถะ (${esc(periodLabel)})</span><b>${THB(expenseTotal)}</b></div>
      ${housekeeperCost > 0 ? `<div class="summary-card"><span>เงินเดือนแม่บ้าน (${esc(periodLabel)})</span><b>${THB(housekeeperCost)}</b></div>` : ''}
      ${parttimeCommission > 0 ? `<div class="summary-card"><span>ค่าแรงพาร์ทไทม์ จ่ายรายวัน (${esc(periodLabel)})</span><b>${THB(parttimeCommission)}</b></div>` : ''}
      <div class="summary-card"><span>รายได้สุทธิ (${esc(periodLabel)})</span><b style="color:${netRevenue < 0 ? 'var(--bad)' : 'var(--good)'}">${THB(netRevenue)}</b></div>
      <div class="summary-card"><span>ยอดขายแพ็กเกจ (${esc(periodLabel)})</span><b>${THB(packageRevenue)}</b></div>
    </div>

    <div class="widget-head" style="margin-bottom:10px">
      <h2 style="font-size:1rem">ค่าคอมแยกตามพนักงาน (${esc(periodLabel)})</h2>
    </div>
    ${periodType === 'daily' ? `
      <div class="table-wrap flat" style="margin-bottom:18px">
        <table>
          <thead><tr><th>พนักงาน</th><th class="num">ค่าคอม</th><th class="num">ต้องจ่าย</th><th class="num">เบิกล่วงหน้า</th></tr></thead>
          <tbody>
            ${dailyRowsWithZero.length ? dailyRowsWithZero.map((row) => `
              <tr>
                <td data-label="พนักงาน">${esc(row.employeeName)}${row.onLeave ? ' <span class="pill warn">ลา</span>' : ''}</td>
                <td class="num" data-label="ค่าคอม">${commissionCellHtml(row, row.hasRecord)}</td>
                <td class="num" data-label="ต้องจ่าย"><b>${THB(guaranteedAmount(row, row.hasRecord))}</b></td>
                <td class="num" data-label="เบิกล่วงหน้า">${row.owed > 0 ? THB(row.owed) : '-'}</td>
              </tr>`).join('') : `<tr><td colspan="4">ไม่มีข้อมูลในช่วงนี้</td></tr>`}
            ${dailyRowsWithZero.length ? `
              <tr style="font-weight:700">
                <td data-label="รวม">รวมต้องจ่ายหมอนวด</td>
                <td class="num" data-label="ค่าคอม"></td>
                <td class="num" data-label="ต้องจ่าย">${THB(dailyTotalPay)}</td>
                <td class="num" data-label="เบิกล่วงหน้า"></td>
              </tr>
            ` : ''}
          </tbody>
        </table>
      </div>
    ` : (dayGroups.length ? dayGroups.map(dayGroupHtml).join('') : `<p class="cell-sub">ไม่มีข้อมูลในช่วงนี้</p>`)}

    <div class="widget">
      <div class="widget-head"><h2>การนวดล่าสุด (${esc(periodLabel)})</h2><button class="icon-btn" data-tab-jump="sessions" aria-label="ไปที่หน้าบันทึกการนวด">↗</button></div>
      <div class="table-wrap flat">
        <table>
          <thead><tr><th>วันที่</th><th>พนักงาน</th><th>บริการ</th><th class="num">ราคา</th></tr></thead>
          <tbody>
            ${recentVisits.length ? recentVisits.map((v) => {
              const multi = v.items.length > 1;
              const total = v.items.reduce((sum, s) => sum + (Number(s.customerPrice) || 0) - (Number(s.discount) || 0), 0);
              const discountTotal = v.items.reduce((sum, s) => sum + (Number(s.discount) || 0), 0);
              const serviceLabel = v.items.map((s) => `${esc(s.serviceName)} (${s.duration} นาที)`).join(', ');
              const notes = v.items
                .map((s) => s.packageId ? 'ใช้แพ็กเกจ' : s.isOwner ? 'เจ้าของร้านนวดเอง' : s.attendanceOnly ? 'ไม่มีลูกค้า' : '')
                .filter(Boolean);
              if (discountTotal > 0) notes.push(`ส่วนลด ${THB(discountTotal)}`);
              return `
              <tr>
                <td data-label="วันที่">${fmtDate(v.date)}</td>
                <td data-label="พนักงาน">${esc(v.employeeName)}</td>
                <td data-label="บริการ"><div>${multi ? `<span class="pill neutral" style="margin-bottom:4px">${v.items.length} รายการ</span><br>` : ''}${serviceLabel}</div></td>
                <td class="num" data-label="ราคา"><div>${THB(total)}${notes.length ? `<div class="cell-sub">(${notes.join(', ')})</div>` : ''}</div></td>
              </tr>`;
            }).join('') : `<tr><td colspan="4">ไม่มีข้อมูลในช่วงนี้</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  el.querySelectorAll('[data-tab-jump]').forEach((btn) => {
    btn.addEventListener('click', () => window.__switchTab(btn.dataset.tabJump));
  });

  el.querySelectorAll('[data-toggle-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.toggleDay;
      if (expandedDays.has(date)) expandedDays.delete(date);
      else expandedDays.add(date);
      renderDashboard();
    });
  });

  el.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      periodType = btn.dataset.period;
      savePeriod();
      renderDashboard();
    });
  });

  document.getElementById('dash_day')?.addEventListener('change', (e) => {
    selectedDay = e.target.value;
    savePeriod();
    renderDashboard();
  });
  document.getElementById('dash_halfmonth')?.addEventListener('change', (e) => {
    selectedHalfMonth = e.target.value;
    savePeriod();
    renderDashboard();
  });
  document.getElementById('dash_month')?.addEventListener('change', (e) => {
    selectedMonth = e.target.value;
    savePeriod();
    renderDashboard();
  });
  document.getElementById('dash_year')?.addEventListener('change', (e) => {
    selectedYear = e.target.value;
    savePeriod();
    renderDashboard();
  });
}
