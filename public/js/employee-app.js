import { initCloudSync } from './firestore-service.js';
import { state, isTherapist, advancesForEmployee, approvedAdvanceTotalForEmployee, leavesForEmployee, countLeaveDays, guaranteedEarningsTotalForEmployee, guaranteedEarningsForSessions, minDailyWage } from './store.js';
import { esc, fmtDate, avatarHtml, THB, groupSessionsByPeriod } from './utils.js';

const params = new URLSearchParams(window.location.search);
const employeeId = params.get('id');
let grouping = 'daily'; // daily | half-month | monthly | yearly
let expandedGroups = new Set();
let showAllAdvances = false;
let showAllLeaves = false;
let sumPeriodType = 'monthly'; // daily | half-month | monthly | yearly — scopes the summary cards only
let sumSelectedLabel = null;

function advanceRowHtml(a) {
  const statusPill = a.status === 'approved' ? '<span class="pill good">อนุมัติแล้ว</span>'
    : a.status === 'rejected' ? '<span class="pill bad">ปฏิเสธ</span>'
    : '<span class="pill warn">รออนุมัติ</span>';
  return `
    <tr>
      <td data-label="วันที่">${fmtDate(a.date)}</td>
      <td class="num" data-label="จำนวนเงิน">${THB(a.amount)}</td>
      <td data-label="สถานะ">${statusPill}</td>
      <td data-label="เหตุผล">${esc(a.reason || '-')}</td>
    </tr>
  `;
}

function guaranteePillForDay(daySessions, commission, therapist) {
  if (!therapist) return '';
  const hasIssue = daySessions.some((s) => s.late || s.leftEarly);
  if (hasIssue) return '<span class="pill warn">มาสาย/ออกก่อน · ไม่ได้ค่าประกัน</span>';
  const minWage = minDailyWage();
  if (commission < minWage) return `<span class="pill good">ได้ค่าประกัน ${THB(minWage)}</span>`;
  return '';
}

function sessionPillsHtml(sessions) {
  return `<div style="display:flex;flex-wrap:wrap;gap:6px">
    ${sessions.map((s) => `<span class="pill neutral">${esc(s.serviceName)} (${s.duration} น.) · ${THB(s.customerPrice)}${s.late ? ' · มาสาย' : ''}${s.leftEarly ? ' · ออกก่อน' : ''}</span>`).join('')}
  </div>`;
}

function leaveRowHtml(l) {
  const dateRange = l.startDate === l.endDate ? fmtDate(l.startDate) : `${fmtDate(l.startDate)} - ${fmtDate(l.endDate)}`;
  const statusPill = l.status === 'approved' ? '<span class="pill good">อนุมัติแล้ว</span>'
    : l.status === 'rejected' ? '<span class="pill bad">ปฏิเสธ</span>'
    : '<span class="pill warn">รออนุมัติ</span>';
  return `
    <tr>
      <td data-label="วันที่ลา">${dateRange}</td>
      <td class="num" data-label="จำนวนวัน">${countLeaveDays(l)} วัน</td>
      <td data-label="สถานะ">${statusPill}</td>
      <td data-label="เหตุผล">${esc(l.reason || '-')}</td>
    </tr>
  `;
}

function render() {
  const el = document.getElementById('emp-content');
  const emp = state.employees.find((e) => e.id === employeeId);

  if (!emp) {
    el.innerHTML = `<p>ไม่พบพนักงานนี้</p>`;
    return;
  }

  const sessions = state.sessions.filter((s) => s.employeeId === employeeId);
  const groups = groupSessionsByPeriod(sessions, grouping);

  const therapist = isTherapist(emp);
  const advances = advancesForEmployee(employeeId);
  const leaves = leavesForEmployee(employeeId);
  const totalAdvance = approvedAdvanceTotalForEmployee(employeeId);
  const totalEarned = therapist ? guaranteedEarningsTotalForEmployee(employeeId) : 0;
  const remaining = totalEarned - totalAdvance;

  // ช่วงเวลาสำหรับการ์ดสรุปยอดด้านบนเท่านั้น (แยกจาก grouping ของ "ประวัติการนวด" ด้านล่าง)
  // sumPeriodType === 'all' คือโหมดดูยอดรวมทั้งหมด ไม่ต้องเลือกช่วงย่อย
  const isAllTime = sumPeriodType === 'all';
  const sumGroups = isAllTime ? [] : groupSessionsByPeriod(sessions, sumPeriodType);
  if (!isAllTime && (!sumSelectedLabel || !sumGroups.some((g) => g.label === sumSelectedLabel))) {
    sumSelectedLabel = sumGroups[0]?.label || null;
  }
  const currentSumGroup = isAllTime ? null : sumGroups.find((g) => g.label === sumSelectedLabel);
  const totalRevenue = sessions.reduce((sum, s) => sum + (Number(s.customerPrice) || 0), 0);
  const totalCommission = sessions.reduce((sum, s) => sum + (Number(s.commission) || 0), 0);
  const periodSessions = isAllTime ? sessions : (currentSumGroup ? currentSumGroup.sessions : []);
  const periodRevenue = isAllTime ? totalRevenue : (currentSumGroup ? currentSumGroup.revenue : 0);
  const periodCommission = isAllTime ? totalCommission : (currentSumGroup ? currentSumGroup.commission : 0);
  const periodLabel = isAllTime ? 'ทั้งหมด' : (currentSumGroup ? currentSumGroup.label : 'ยังไม่มีข้อมูล');
  const periodEarned = therapist ? (isAllTime ? totalEarned : guaranteedEarningsForSessions(periodSessions)) : 0;
  const periodGuaranteeTopUp = periodEarned - periodCommission;

  const statusPill = emp.active === false
    ? `<span class="pill neutral">ลาออกแล้ว</span>`
    : `<span class="pill good">ทำงานอยู่</span>`;
  const rolePill = emp.role === 'housekeeper'
    ? `<span class="pill warn">แม่บ้าน</span>`
    : `<span class="pill neutral">พนักงานนวด</span>`;

  const groupsHtml = groups.length ? groups.map((g, i) => {
    const open = expandedGroups.has(i);
    const headerGuaranteePill = grouping === 'daily' ? guaranteePillForDay(g.sessions, g.commission, therapist) : '';

    let body = '';
    if (open) {
      if (grouping === 'daily') {
        body = `<div class="drop-anim" style="padding-bottom:12px">${sessionPillsHtml(g.sessions)}</div>`;
      } else {
        const days = groupSessionsByPeriod(g.sessions, 'daily');
        body = `<div class="drop-anim">${days.map((d) => `
          <div style="padding:10px 0 10px 14px;border-left:2px solid var(--border);margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px">
              <b style="font-size:.85rem">${esc(d.label)}</b>
              <span class="cell-sub">${d.sessions.length} ครั้ง · ${THB(d.commission)} ${guaranteePillForDay(d.sessions, d.commission, therapist)}</span>
            </div>
            ${sessionPillsHtml(d.sessions)}
          </div>
        `).join('')}</div>`;
      }
    }

    return `
    <div class="widget" style="padding-bottom:${open ? '8px' : '0'}">
      <button class="widget-head" data-toggle-group="${i}" style="width:100%;border:none;background:none;cursor:pointer;text-align:left;padding:14px 0">
        <h2>${open ? '▾' : '▸'} ${esc(g.label)}</h2>
        <span class="cell-sub">${g.sessions.length} ครั้ง · รายได้ ${THB(g.revenue)} · ค่าคอม ${THB(g.commission)} ${headerGuaranteePill}</span>
      </button>
      ${body}
    </div>
  `;
  }).join('') : `<p class="cell-sub">ยังไม่มีประวัติการนวด</p>`;

  el.innerHTML = `
    <div class="emp-header">
      ${avatarHtml(emp.name, emp.id, 'lg')}
      <div>
        <h1>${esc(emp.name)}</h1>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${rolePill} ${statusPill}</div>
      </div>
    </div>

    <div class="summary-cards">
      <div class="summary-card"><span>เบอร์โทร</span><b style="font-size:1rem">${esc(emp.phone || '-')}</b></div>
      <div class="summary-card"><span>วันที่เริ่มงาน</span><b style="font-size:1rem">${fmtDate(emp.startDate)}</b></div>
    </div>

    <div class="widget-head" style="margin-bottom:10px">
      <h2 style="font-size:1rem">สรุปยอด</h2>
      <div class="seg-toggle">
        <button data-sum-period="all" class="${isAllTime ? 'active' : ''}">ทั้งหมด</button>
        <button data-sum-period="daily" class="${sumPeriodType === 'daily' ? 'active' : ''}">รายวัน</button>
        <button data-sum-period="half-month" class="${sumPeriodType === 'half-month' ? 'active' : ''}">รายครึ่งเดือน</button>
        <button data-sum-period="monthly" class="${sumPeriodType === 'monthly' ? 'active' : ''}">รายเดือน</button>
        <button data-sum-period="yearly" class="${sumPeriodType === 'yearly' ? 'active' : ''}">รายปี</button>
      </div>
      ${isAllTime ? '' : `
        <select class="month-filter" id="emp_sum_bucket" aria-label="เลือกช่วงเวลาสรุปยอด">
          ${sumGroups.map((g) => `<option value="${esc(g.label)}" ${g.label === sumSelectedLabel ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}
        </select>
      `}
    </div>
    <div class="summary-cards">
      <div class="summary-card"><span>จำนวนครั้งที่นวด (${esc(periodLabel)})</span><b>${periodSessions.length} ครั้ง</b></div>
      <div class="summary-card"><span>รายได้รวม (${esc(periodLabel)})</span><b>${THB(periodRevenue)}</b></div>
      ${therapist ? `
        <div class="summary-card"><span>ได้เงินรวม (${esc(periodLabel)})</span><b>${THB(periodEarned)}</b>${periodGuaranteeTopUp > 0 ? `<span class="cell-sub">ค่าคอมจริง ${THB(periodCommission)} + ประกัน ${THB(periodGuaranteeTopUp)}</span>` : ''}</div>
        <div class="summary-card"><span>เบิกล่วงหน้ารวม (อนุมัติแล้ว ทั้งหมด)</span><b style="color:var(--warn)">-${THB(totalAdvance)}</b></div>
        <div class="summary-card"><span>คงเหลือ (ทั้งหมด)</span><b style="color:${remaining < 0 ? 'var(--bad)' : 'var(--good)'}">${THB(remaining)}</b></div>
      ` : `
        <div class="summary-card"><span>เงินเดือนตายตัว</span><b>${emp.fixedSalary != null ? THB(emp.fixedSalary) + ' /รอบ' : 'ยังไม่ตั้ง'}</b></div>
        <div class="summary-card"><span>เบิกล่วงหน้ารวม (อนุมัติแล้ว ทั้งหมด)</span><b style="color:var(--warn)">-${THB(totalAdvance)}</b></div>
      `}
    </div>

    <div class="widget-head" style="margin-bottom:12px">
      <h2 style="font-size:1rem">ประวัติเบิกเงินล่วงหน้า</h2>
    </div>
    <div class="table-wrap" style="margin-bottom:8px">
      <table>
        <thead><tr><th>วันที่</th><th class="num">จำนวนเงิน</th><th>สถานะ</th><th>เหตุผล</th></tr></thead>
        <tbody>
          ${advances.length ? (showAllAdvances ? advances : advances.slice(0, 5)).map(advanceRowHtml).join('') : `<tr><td colspan="4">ยังไม่มีประวัติเบิกเงินล่วงหน้า</td></tr>`}
        </tbody>
      </table>
    </div>
    ${advances.length > 5 ? `<div style="margin-bottom:18px"><button class="btn small" id="toggle_advances">${showAllAdvances ? 'ย่อ' : `ดูทั้งหมด (${advances.length} รายการ)`}</button></div>` : '<div style="margin-bottom:18px"></div>'}

    <div class="widget-head" style="margin-bottom:12px">
      <h2 style="font-size:1rem">ประวัติการลา</h2>
    </div>
    <div class="table-wrap" style="margin-bottom:8px">
      <table>
        <thead><tr><th>วันที่ลา</th><th class="num">จำนวนวัน</th><th>สถานะ</th><th>เหตุผล</th></tr></thead>
        <tbody>
          ${leaves.length ? (showAllLeaves ? leaves : leaves.slice(0, 5)).map(leaveRowHtml).join('') : `<tr><td colspan="4">ยังไม่มีประวัติการลา</td></tr>`}
        </tbody>
      </table>
    </div>
    ${leaves.length > 5 ? `<div style="margin-bottom:18px"><button class="btn small" id="toggle_leaves">${showAllLeaves ? 'ย่อ' : `ดูทั้งหมด (${leaves.length} รายการ)`}</button></div>` : '<div style="margin-bottom:18px"></div>'}

    <div class="widget-head" style="margin-bottom:12px">
      <h2 style="font-size:1rem">ประวัติการนวด</h2>
      <div class="seg-toggle">
        <button data-group="daily" class="${grouping === 'daily' ? 'active' : ''}">รายวัน</button>
        <button data-group="half-month" class="${grouping === 'half-month' ? 'active' : ''}">รายครึ่งเดือน</button>
        <button data-group="monthly" class="${grouping === 'monthly' ? 'active' : ''}">รายเดือน</button>
        <button data-group="yearly" class="${grouping === 'yearly' ? 'active' : ''}">รายปี</button>
      </div>
    </div>
    ${groupsHtml}
  `;

  el.querySelectorAll('[data-sum-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sumPeriodType = btn.dataset.sumPeriod;
      sumSelectedLabel = null;
      render();
    });
  });
  document.getElementById('emp_sum_bucket')?.addEventListener('change', (e) => {
    sumSelectedLabel = e.target.value;
    render();
  });

  document.getElementById('toggle_advances')?.addEventListener('click', () => {
    showAllAdvances = !showAllAdvances;
    render();
  });
  document.getElementById('toggle_leaves')?.addEventListener('click', () => {
    showAllLeaves = !showAllLeaves;
    render();
  });

  el.querySelectorAll('[data-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      grouping = btn.dataset.group;
      expandedGroups = new Set();
      render();
    });
  });

  el.querySelectorAll('[data-toggle-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.toggleGroup);
      if (expandedGroups.has(i)) expandedGroups.delete(i);
      else expandedGroups.add(i);
      render();
    });
  });
}

export function initEmployeeApp() {
  initCloudSync(render);
}
