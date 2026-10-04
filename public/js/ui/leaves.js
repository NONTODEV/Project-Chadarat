import { state, countLeaveDays } from '../store.js';
import { leavesCrud } from '../firestore-service.js';
import { esc, showConfirm, showToast, uid, fmtDate, todayISO, groupByPeriod, guardClick } from '../utils.js';

let periodType = 'monthly'; // daily | half-month | monthly | yearly
let selectedLabel = null; // label of the chosen bucket within periodType; null = most recent
let expandedEmployees = new Set();
let editingId = null;

export function renderLeaves() {
  const el = document.getElementById('leaves');
  if (!el) return;

  const allGroups = groupByPeriod(state.leaves, periodType, 'startDate');
  if (!selectedLabel || !allGroups.some((g) => g.label === selectedLabel)) {
    selectedLabel = allGroups[0]?.label || null;
  }
  const current = allGroups.find((g) => g.label === selectedLabel);
  const rows = current ? [...current.items].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')) : [];
  const totalDays = rows.reduce((sum, l) => sum + countLeaveDays(l), 0);

  const byEmployee = groupByEmployee(rows);

  el.innerHTML = `
    <div class="widget-head" style="margin-bottom:10px">
      <div class="seg-toggle">
        <button data-period="daily" class="${periodType === 'daily' ? 'active' : ''}">รายวัน</button>
        <button data-period="half-month" class="${periodType === 'half-month' ? 'active' : ''}">รายครึ่งเดือน</button>
        <button data-period="monthly" class="${periodType === 'monthly' ? 'active' : ''}">รายเดือน</button>
        <button data-period="yearly" class="${periodType === 'yearly' ? 'active' : ''}">รายปี</button>
      </div>
      <select class="month-filter" id="lv_bucket" aria-label="เลือกช่วงเวลาการลา">
        ${allGroups.map((g) => `<option value="${esc(g.label)}" ${g.label === selectedLabel ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}
      </select>
      <span style="color:var(--text-dim);font-size:.85rem">รวม ${rows.length} รายการ · ${totalDays} วัน</span>
    </div>

    ${byEmployee.length ? byEmployee.map(employeeGroupHtml).join('') : `<p class="cell-sub">ไม่มีการลาในช่วงนี้</p>`}

    <div style="margin-top:12px"><button class="btn primary" id="lv_add">+ แจ้งลา</button></div>
  `;

  el.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      periodType = btn.dataset.period;
      selectedLabel = null;
      renderLeaves();
    });
  });
  document.getElementById('lv_bucket')?.addEventListener('change', (e) => {
    selectedLabel = e.target.value;
    renderLeaves();
  });
  document.getElementById('lv_add').addEventListener('click', () => openModal());

  el.querySelectorAll('[data-toggle-employee]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleEmployee;
      if (expandedEmployees.has(id)) expandedEmployees.delete(id);
      else expandedEmployees.add(id);
      renderLeaves();
    });
  });

  rows.forEach((l) => {
    el.querySelector(`[data-approve="${l.id}"]`)?.addEventListener('click', () => setStatus(l, 'approved'));
    el.querySelector(`[data-reject="${l.id}"]`)?.addEventListener('click', () => setStatus(l, 'rejected'));
    el.querySelector(`[data-edit="${l.id}"]`)?.addEventListener('click', () => openModal(l));
    el.querySelector(`[data-delete="${l.id}"]`)?.addEventListener('click', () => removeLeave(l));
  });
}

function groupByEmployee(leaves) {
  const map = new Map();
  for (const l of leaves) {
    if (!map.has(l.employeeId)) {
      map.set(l.employeeId, { employeeId: l.employeeId, employeeName: l.employeeName, items: [], totalDays: 0 });
    }
    const g = map.get(l.employeeId);
    g.items.push(l);
    g.totalDays += countLeaveDays(l);
  }
  return Array.from(map.values()).sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || '', 'th'));
}

function employeeGroupHtml(g) {
  const open = expandedEmployees.has(g.employeeId);
  return `
    <div class="widget" style="padding-bottom:${open ? '8px' : '0'}">
      <button class="widget-head" data-toggle-employee="${g.employeeId}" style="width:100%;border:none;background:none;cursor:pointer;text-align:left;padding:14px 0">
        <h2>${open ? '▾' : '▸'} ${esc(g.employeeName)}</h2>
        <span class="cell-sub">${g.items.length} รายการ · รวม ${g.totalDays} วัน</span>
      </button>
      ${open ? `
        <div class="drop-anim table-wrap flat" style="margin-bottom:12px">
          <table>
            <thead><tr><th>วันที่ลา</th><th class="num">จำนวนวัน</th><th>เหตุผล</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
            <tbody>
              ${g.items.map(rowHtml).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

function statusPill(status) {
  if (status === 'approved') return `<span class="pill good">อนุมัติแล้ว</span>`;
  if (status === 'rejected') return `<span class="pill bad">ปฏิเสธ</span>`;
  return `<span class="pill warn">รออนุมัติ</span>`;
}

function rowHtml(l) {
  const dateRange = l.startDate === l.endDate ? fmtDate(l.startDate) : `${fmtDate(l.startDate)} - ${fmtDate(l.endDate)}`;
  const statusActions = l.status === 'pending'
    ? `<button class="btn small" data-approve="${l.id}">อนุมัติ</button>
       <button class="btn small danger" data-reject="${l.id}">ปฏิเสธ</button>`
    : '';
  const actions = `
    ${statusActions}
    <button class="btn small" data-edit="${l.id}">แก้ไข</button>
    <button class="btn small danger" data-delete="${l.id}">ลบ</button>
  `;
  return `
    <tr>
      <td data-label="วันที่ลา">${dateRange}</td>
      <td class="num" data-label="จำนวนวัน">${countLeaveDays(l)} วัน</td>
      <td data-label="เหตุผล">${esc(l.reason || '-')}</td>
      <td data-label="สถานะ">${statusPill(l.status)}</td>
      <td data-label="จัดการ">${actions}</td>
    </tr>
  `;
}

async function setStatus(l, status) {
  const { id, ...rest } = l;
  await leavesCrud.save(id, { ...rest, status });
  showToast(status === 'approved' ? 'อนุมัติการลาแล้ว' : 'ปฏิเสธการลาแล้ว');
}

async function removeLeave(l) {
  const ok = await showConfirm(`ลบรายการลาของ "${l.employeeName}"?`, true);
  if (!ok) return;
  await leavesCrud.remove(l.id);
  showToast('ลบแล้ว');
}

function openModal(leave) {
  editingId = leave ? leave.id : null;
  document.getElementById('lvModalTitle').textContent = leave ? 'แก้ไขการลา' : 'แจ้งลา';

  const empSel = document.getElementById('lv_employee');
  empSel.innerHTML = state.employees.filter((e) => e.active !== false || e.id === leave?.employeeId)
    .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');

  if (leave) {
    empSel.value = leave.employeeId;
    document.getElementById('lv_startDate').value = leave.startDate;
    document.getElementById('lv_endDate').value = leave.endDate;
    document.getElementById('lv_reason').value = leave.reason || '';
  } else {
    document.getElementById('lv_startDate').value = todayISO();
    document.getElementById('lv_endDate').value = todayISO();
    document.getElementById('lv_reason').value = '';
  }

  document.getElementById('lvModalBg').classList.add('open');
}

function closeModal() {
  document.getElementById('lvModalBg').classList.remove('open');
  editingId = null;
}

export function initLeaveModal() {
  document.getElementById('lv_cancel').addEventListener('click', closeModal);
  document.getElementById('lvModalBg').addEventListener('click', (e) => {
    if (e.target.id === 'lvModalBg') closeModal();
  });
  document.getElementById('lv_startDate').addEventListener('change', (e) => {
    const endInput = document.getElementById('lv_endDate');
    if (endInput.value < e.target.value) endInput.value = e.target.value;
  });

  guardClick(document.getElementById('lv_save'), async () => {
    const employeeId = document.getElementById('lv_employee').value;
    const employee = state.employees.find((e) => e.id === employeeId);
    const startDate = document.getElementById('lv_startDate').value;
    const endDate = document.getElementById('lv_endDate').value;
    if (!employee || !startDate || !endDate) { showToast('กรุณากรอกข้อมูลให้ครบ'); return; }
    if (endDate < startDate) { showToast('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มลา'); return; }

    const overlapping = state.leaves.some((l) => l.id !== editingId && l.employeeId === employeeId
      && l.status !== 'rejected' && l.startDate <= endDate && l.endDate >= startDate);
    if (overlapping) {
      const ok = await showConfirm(`${employee.name} มีรายการลาช่วงที่ทับกับช่วงนี้อยู่แล้ว ต้องการบันทึกซ้อนกันหรือไม่?`, true);
      if (!ok) return;
    }

    const hasSessionOnLeaveDay = state.sessions.some((s) => s.employeeId === employeeId
      && s.date >= startDate && s.date <= endDate);
    if (hasSessionOnLeaveDay) {
      const ok = await showConfirm(`${employee.name} มีบันทึกการนวดอยู่แล้วในช่วงวันที่ลานี้ ต้องการบันทึกการลาต่อหรือไม่?`, true);
      if (!ok) return;
    }

    const existing = state.leaves.find((l) => l.id === editingId);
    await leavesCrud.save(editingId || uid(), {
      employeeId, employeeName: employee.name,
      startDate, endDate,
      reason: document.getElementById('lv_reason').value.trim(),
      status: existing ? existing.status : 'pending',
    });
    closeModal();
    showToast(editingId ? 'แก้ไขการลาแล้ว' : 'บันทึกการแจ้งลาแล้ว');
  });
}
