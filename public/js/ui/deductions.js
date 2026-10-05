import { state } from '../store.js';
import { deductionsCrud } from '../firestore-service.js';
import { esc, showConfirm, showToast, uid, fmtDate, THB, todayISO, groupByPeriod, guardClick, matchesSearch, rerenderKeepingFocus } from '../utils.js';

let periodType = 'monthly'; // daily | half-month | monthly | yearly
let selectedLabel = null; // label of the chosen bucket within periodType; null = most recent
let expandedEmployees = new Set();
let editingId = null;
let searchQuery = '';

export function renderDeductions() {
  const el = document.getElementById('deductions');
  if (!el) return;

  const allGroups = groupByPeriod(state.deductions, periodType);
  if (!selectedLabel || !allGroups.some((g) => g.label === selectedLabel)) {
    selectedLabel = allGroups[0]?.label || null;
  }
  const current = allGroups.find((g) => g.label === selectedLabel);
  const rows = (current ? [...current.items].sort((a, b) => (b.date || '').localeCompare(a.date || '')) : [])
    .filter((d) => matchesSearch(searchQuery, d.employeeName, d.reason));
  const total = rows.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

  const byEmployee = groupByEmployee(rows);

  el.innerHTML = `
    <div class="widget-head" style="margin-bottom:10px">
      <div class="seg-toggle">
        <button data-period="daily" class="${periodType === 'daily' ? 'active' : ''}">รายวัน</button>
        <button data-period="half-month" class="${periodType === 'half-month' ? 'active' : ''}">รายครึ่งเดือน</button>
        <button data-period="monthly" class="${periodType === 'monthly' ? 'active' : ''}">รายเดือน</button>
        <button data-period="yearly" class="${periodType === 'yearly' ? 'active' : ''}">รายปี</button>
      </div>
      <select class="month-filter" id="ded_bucket" aria-label="เลือกช่วงเวลาหักเงิน">
        ${allGroups.map((g) => `<option value="${esc(g.label)}" ${g.label === selectedLabel ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}
      </select>
      <input type="search" class="search-input" id="ded_search" placeholder="ค้นหาพนักงาน/เหตุผล..." value="${esc(searchQuery)}" aria-label="ค้นหาหักเงิน" />
      <span style="color:var(--text-dim);font-size:.85rem">รวม ${rows.length} รายการ · หักไปทั้งหมด ${THB(total)}</span>
    </div>

    ${byEmployee.length ? byEmployee.map(employeeGroupHtml).join('') : `<p class="cell-sub">${searchQuery ? 'ไม่พบรายการที่ค้นหา' : 'ไม่มีรายการในช่วงนี้'}</p>`}

    <div style="margin-top:12px"><button class="btn primary" id="ded_add">+ หักเงินพนักงาน</button></div>
  `;

  el.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      periodType = btn.dataset.period;
      selectedLabel = null;
      renderDeductions();
    });
  });
  document.getElementById('ded_bucket')?.addEventListener('change', (e) => {
    selectedLabel = e.target.value;
    renderDeductions();
  });
  document.getElementById('ded_search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    rerenderKeepingFocus('ded_search', renderDeductions);
  });
  document.getElementById('ded_add').addEventListener('click', () => openModal());

  el.querySelectorAll('[data-toggle-employee]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleEmployee;
      if (expandedEmployees.has(id)) expandedEmployees.delete(id);
      else expandedEmployees.add(id);
      renderDeductions();
    });
  });

  rows.forEach((d) => {
    el.querySelector(`[data-edit="${d.id}"]`)?.addEventListener('click', () => openModal(d));
    el.querySelector(`[data-delete="${d.id}"]`)?.addEventListener('click', () => removeDeduction(d));
  });
}

function groupByEmployee(deductions) {
  const map = new Map();
  for (const d of deductions) {
    if (!map.has(d.employeeId)) {
      map.set(d.employeeId, { employeeId: d.employeeId, employeeName: d.employeeName, items: [], total: 0 });
    }
    const g = map.get(d.employeeId);
    g.items.push(d);
    g.total += Number(d.amount) || 0;
  }
  return Array.from(map.values()).sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || '', 'th'));
}

function employeeGroupHtml(g) {
  const open = expandedEmployees.has(g.employeeId);
  return `
    <div class="widget" style="padding-bottom:${open ? '8px' : '0'}">
      <button class="widget-head" data-toggle-employee="${g.employeeId}" style="width:100%;border:none;background:none;cursor:pointer;text-align:left;padding:14px 0">
        <h2>${open ? '▾' : '▸'} ${esc(g.employeeName)}</h2>
        <span class="cell-sub">${g.items.length} รายการ · รวมหัก ${THB(g.total)}</span>
      </button>
      ${open ? `
        <div class="drop-anim table-wrap flat" style="margin-bottom:12px">
          <table>
            <thead><tr><th>วันที่</th><th class="num">จำนวนเงิน</th><th>เหตุผล</th><th>จัดการ</th></tr></thead>
            <tbody>
              ${g.items.map(rowHtml).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

function rowHtml(d) {
  return `
    <tr>
      <td data-label="วันที่">${fmtDate(d.date)}</td>
      <td class="num" data-label="จำนวนเงิน">${THB(d.amount)}</td>
      <td data-label="เหตุผล">${esc(d.reason || '-')}</td>
      <td data-label="จัดการ">
        <button class="btn small" data-edit="${d.id}">แก้ไข</button>
        <button class="btn small danger" data-delete="${d.id}">ลบ</button>
      </td>
    </tr>
  `;
}

async function removeDeduction(d) {
  const ok = await showConfirm(`ลบรายการหักเงินของ "${d.employeeName}"?`, true);
  if (!ok) return;
  await deductionsCrud.remove(d.id);
  showToast('ลบแล้ว');
}

function openModal(deduction) {
  editingId = deduction ? deduction.id : null;
  document.getElementById('dedModalTitle').textContent = deduction ? 'แก้ไขรายการหักเงิน' : 'หักเงินพนักงาน';

  const empSel = document.getElementById('ded_employee');
  empSel.innerHTML = state.employees.filter((e) => e.active !== false || e.id === deduction?.employeeId)
    .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');

  if (deduction) {
    empSel.value = deduction.employeeId;
    document.getElementById('ded_date').value = deduction.date;
    document.getElementById('ded_amount').value = deduction.amount;
    document.getElementById('ded_reason').value = deduction.reason || '';
  } else {
    document.getElementById('ded_date').value = todayISO();
    document.getElementById('ded_amount').value = '';
    document.getElementById('ded_reason').value = '';
  }
  document.getElementById('ded_delete').style.display = deduction ? 'inline-block' : 'none';

  document.getElementById('dedModalBg').classList.add('open');
}

function closeModal() {
  document.getElementById('dedModalBg').classList.remove('open');
  editingId = null;
}

export function initDeductionsModal() {
  document.getElementById('ded_cancel').addEventListener('click', closeModal);
  document.getElementById('dedModalBg').addEventListener('click', (e) => {
    if (e.target.id === 'dedModalBg') closeModal();
  });

  guardClick(document.getElementById('ded_delete'), async () => {
    if (!editingId) return;
    const ok = await showConfirm('ลบรายการหักเงินนี้?', true);
    if (!ok) return;
    await deductionsCrud.remove(editingId);
    closeModal();
    showToast('ลบแล้ว');
  });

  guardClick(document.getElementById('ded_save'), async () => {
    const employeeId = document.getElementById('ded_employee').value;
    const employee = state.employees.find((e) => e.id === employeeId);
    const amount = Number(document.getElementById('ded_amount').value);
    const date = document.getElementById('ded_date').value;
    if (!employee || !date) { showToast('กรุณากรอกข้อมูลให้ครบ'); return; }
    if (!(amount > 0)) { showToast('จำนวนเงินต้องมากกว่า 0'); return; }

    await deductionsCrud.save(editingId || uid(), {
      employeeId, employeeName: employee.name,
      amount, date,
      reason: document.getElementById('ded_reason').value.trim(),
    });
    closeModal();
    showToast(editingId ? 'แก้ไขรายการหักเงินแล้ว' : 'บันทึกการหักเงินแล้ว');
  });
}
