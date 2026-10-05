import { state } from '../store.js';
import { advancesCrud } from '../firestore-service.js';
import { esc, showConfirm, showToast, uid, fmtDate, THB, todayISO, groupByPeriod, guardClick, matchesSearch, rerenderKeepingFocus } from '../utils.js';

let periodType = 'monthly'; // daily | half-month | monthly | yearly
let selectedLabel = null; // label of the chosen bucket within periodType; null = most recent
let expandedEmployees = new Set();
let editingId = null;
let searchQuery = '';

export function renderAdvances() {
  const el = document.getElementById('advances');
  if (!el) return;

  const allGroups = groupByPeriod(state.advances, periodType);
  if (!selectedLabel || !allGroups.some((g) => g.label === selectedLabel)) {
    selectedLabel = allGroups[0]?.label || null;
  }
  const current = allGroups.find((g) => g.label === selectedLabel);
  const rows = (current ? [...current.items].sort((a, b) => (b.date || '').localeCompare(a.date || '')) : [])
    .filter((a) => matchesSearch(searchQuery, a.employeeName, a.reason));
  const total = rows.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

  const byEmployee = groupByEmployee(rows);

  el.innerHTML = `
    <div class="widget-head" style="margin-bottom:10px">
      <div class="seg-toggle">
        <button data-period="daily" class="${periodType === 'daily' ? 'active' : ''}">รายวัน</button>
        <button data-period="half-month" class="${periodType === 'half-month' ? 'active' : ''}">รายครึ่งเดือน</button>
        <button data-period="monthly" class="${periodType === 'monthly' ? 'active' : ''}">รายเดือน</button>
        <button data-period="yearly" class="${periodType === 'yearly' ? 'active' : ''}">รายปี</button>
      </div>
      <select class="month-filter" id="adv_bucket" aria-label="เลือกช่วงเวลาเบิกเงินล่วงหน้า">
        ${allGroups.map((g) => `<option value="${esc(g.label)}" ${g.label === selectedLabel ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}
      </select>
      <input type="search" class="search-input" id="adv_search" placeholder="ค้นหาพนักงาน/เหตุผล..." value="${esc(searchQuery)}" aria-label="ค้นหาเบิกล่วงหน้า" />
      <span style="color:var(--text-dim);font-size:.85rem">รวม ${rows.length} รายการ · เบิกไปทั้งหมด ${THB(total)}</span>
    </div>

    ${byEmployee.length ? byEmployee.map(employeeGroupHtml).join('') : `<p class="cell-sub">${searchQuery ? 'ไม่พบรายการที่ค้นหา' : 'ไม่มีรายการในช่วงนี้'}</p>`}

    <div style="margin-top:12px"><button class="btn primary" id="adv_add">+ เบิกเงินล่วงหน้า</button></div>
  `;

  el.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      periodType = btn.dataset.period;
      selectedLabel = null;
      renderAdvances();
    });
  });
  document.getElementById('adv_bucket')?.addEventListener('change', (e) => {
    selectedLabel = e.target.value;
    renderAdvances();
  });
  document.getElementById('adv_search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    rerenderKeepingFocus('adv_search', renderAdvances);
  });
  document.getElementById('adv_add').addEventListener('click', () => openModal());

  el.querySelectorAll('[data-toggle-employee]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleEmployee;
      if (expandedEmployees.has(id)) expandedEmployees.delete(id);
      else expandedEmployees.add(id);
      renderAdvances();
    });
  });

  rows.forEach((a) => {
    el.querySelector(`[data-approve="${a.id}"]`)?.addEventListener('click', () => setStatus(a, 'approved'));
    el.querySelector(`[data-reject="${a.id}"]`)?.addEventListener('click', () => setStatus(a, 'rejected'));
    el.querySelector(`[data-edit="${a.id}"]`)?.addEventListener('click', () => openModal(a));
    el.querySelector(`[data-delete="${a.id}"]`)?.addEventListener('click', () => removeAdvance(a));
  });
}

function groupByEmployee(advances) {
  const map = new Map();
  for (const a of advances) {
    if (!map.has(a.employeeId)) {
      map.set(a.employeeId, { employeeId: a.employeeId, employeeName: a.employeeName, items: [], total: 0 });
    }
    const g = map.get(a.employeeId);
    g.items.push(a);
    g.total += Number(a.amount) || 0;
  }
  return Array.from(map.values()).sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || '', 'th'));
}

function employeeGroupHtml(g) {
  const open = expandedEmployees.has(g.employeeId);
  return `
    <div class="widget" style="padding-bottom:${open ? '8px' : '0'}">
      <button class="widget-head" data-toggle-employee="${g.employeeId}" style="width:100%;border:none;background:none;cursor:pointer;text-align:left;padding:14px 0">
        <h2>${open ? '▾' : '▸'} ${esc(g.employeeName)}</h2>
        <span class="cell-sub">${g.items.length} รายการ · รวมเบิก ${THB(g.total)}</span>
      </button>
      ${open ? `
        <div class="drop-anim table-wrap flat" style="margin-bottom:12px">
          <table>
            <thead><tr><th>วันที่</th><th class="num">จำนวนเงิน</th><th>เหตุผล</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
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

function rowHtml(a) {
  const actions = a.status === 'pending'
    ? `<button class="btn small" data-approve="${a.id}">อนุมัติ</button>
       <button class="btn small danger" data-reject="${a.id}">ปฏิเสธ</button>
       <button class="btn small" data-edit="${a.id}">แก้ไข</button>`
    : `<button class="btn small" data-edit="${a.id}">แก้ไข</button>
       <button class="btn small danger" data-delete="${a.id}">ลบ</button>`;
  return `
    <tr>
      <td data-label="วันที่">${fmtDate(a.date)}</td>
      <td class="num" data-label="จำนวนเงิน">${THB(a.amount)}</td>
      <td data-label="เหตุผล">${esc(a.reason || '-')}</td>
      <td data-label="สถานะ">${statusPill(a.status)}</td>
      <td data-label="จัดการ">${actions}</td>
    </tr>
  `;
}

async function setStatus(a, status) {
  await advancesCrud.save(a.id, { ...stripId(a), status });
  showToast(status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธรายการแล้ว');
}

async function removeAdvance(a) {
  const ok = await showConfirm(`ลบรายการเบิกของ "${a.employeeName}"?`, true);
  if (!ok) return;
  await advancesCrud.remove(a.id);
  showToast('ลบแล้ว');
}

function stripId(a) {
  const { id, ...rest } = a;
  return rest;
}

function openModal(advance) {
  editingId = advance ? advance.id : null;
  document.getElementById('advModalTitle').textContent = advance ? 'แก้ไขเบิกเงินล่วงหน้า' : 'เบิกเงินล่วงหน้า';

  const empSel = document.getElementById('adv_employee');
  empSel.innerHTML = state.employees.filter((e) => e.active !== false || e.id === advance?.employeeId)
    .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');

  if (advance) {
    empSel.value = advance.employeeId;
    document.getElementById('adv_date').value = advance.date;
    document.getElementById('adv_amount').value = advance.amount;
    document.getElementById('adv_reason').value = advance.reason || '';
  } else {
    document.getElementById('adv_date').value = todayISO();
    document.getElementById('adv_amount').value = '';
    document.getElementById('adv_reason').value = '';
  }
  document.getElementById('adv_delete').style.display = advance ? 'inline-block' : 'none';
  document.getElementById('advModalBg').classList.add('open');
}

function closeModal() {
  document.getElementById('advModalBg').classList.remove('open');
  editingId = null;
}

export function initAdvanceModal() {
  document.getElementById('adv_cancel').addEventListener('click', closeModal);
  document.getElementById('advModalBg').addEventListener('click', (e) => {
    if (e.target.id === 'advModalBg') closeModal();
  });

  guardClick(document.getElementById('adv_delete'), async () => {
    if (!editingId) return;
    const advance = state.advances.find((a) => a.id === editingId);
    const ok = await showConfirm(`ลบรายการเบิกของ "${advance?.employeeName || ''}"?`, true);
    if (!ok) return;
    await advancesCrud.remove(editingId);
    closeModal();
    showToast('ลบแล้ว');
  });

  guardClick(document.getElementById('adv_save'), async () => {
    const employeeId = document.getElementById('adv_employee').value;
    const employee = state.employees.find((e) => e.id === employeeId);
    const amount = Number(document.getElementById('adv_amount').value);
    const date = document.getElementById('adv_date').value;
    if (!employee || !date) { showToast('กรุณากรอกข้อมูลให้ครบ'); return; }
    if (!(amount > 0)) { showToast('จำนวนเงินต้องมากกว่า 0'); return; }

    const existing = editingId ? state.advances.find((a) => a.id === editingId) : null;
    await advancesCrud.save(editingId || uid(), {
      employeeId, employeeName: employee.name,
      amount, date,
      reason: document.getElementById('adv_reason').value.trim(),
      status: existing ? existing.status : 'approved',
    });
    closeModal();
    showToast(editingId ? 'แก้ไขรายการเบิกแล้ว' : 'บันทึกเบิกล่วงหน้าแล้ว');
  });
}
