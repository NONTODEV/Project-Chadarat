import { state } from '../store.js';
import { expensesCrud } from '../firestore-service.js';
import { esc, showConfirm, showToast, uid, fmtDate, THB, todayISO, groupByPeriod, guardClick } from '../utils.js';

let periodType = 'monthly'; // daily | half-month | monthly | yearly
let selectedLabel = null; // label of the chosen bucket within periodType; null = most recent
let expandedDays = new Set();
let editingId = null;

export function renderExpenses() {
  const el = document.getElementById('expenses');
  if (!el) return;

  const allGroups = groupByPeriod(state.expenses, periodType);
  if (!selectedLabel || !allGroups.some((g) => g.label === selectedLabel)) {
    selectedLabel = allGroups[0]?.label || null;
  }
  const current = allGroups.find((g) => g.label === selectedLabel);
  const rows = current ? current.items : [];
  const total = rows.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const byDay = groupByPeriod(rows, 'daily').sort((a, b) => b.label.localeCompare(a.label));

  el.innerHTML = `
    <div class="widget-head" style="margin-bottom:10px">
      <div class="seg-toggle">
        <button data-period="daily" class="${periodType === 'daily' ? 'active' : ''}">รายวัน</button>
        <button data-period="half-month" class="${periodType === 'half-month' ? 'active' : ''}">รายครึ่งเดือน</button>
        <button data-period="monthly" class="${periodType === 'monthly' ? 'active' : ''}">รายเดือน</button>
        <button data-period="yearly" class="${periodType === 'yearly' ? 'active' : ''}">รายปี</button>
      </div>
      <select class="month-filter" id="exp_bucket" aria-label="เลือกช่วงเวลารายจ่าย">
        ${allGroups.map((g) => `<option value="${esc(g.label)}" ${g.label === selectedLabel ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}
      </select>
      <span style="color:var(--text-dim);font-size:.85rem">รวม ${rows.length} รายการ · ${THB(total)}</span>
    </div>

    ${byDay.length ? byDay.map(dayGroupHtml).join('') : `<p class="cell-sub">ไม่มีรายจ่ายในช่วงนี้</p>`}

    <div style="margin-top:12px"><button class="btn primary" id="exp_add">+ เพิ่มรายจ่าย</button></div>
  `;

  el.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      periodType = btn.dataset.period;
      selectedLabel = null;
      renderExpenses();
    });
  });
  document.getElementById('exp_bucket')?.addEventListener('change', (e) => {
    selectedLabel = e.target.value;
    renderExpenses();
  });
  document.getElementById('exp_add').addEventListener('click', () => openModal());

  el.querySelectorAll('[data-toggle-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.toggleDay;
      if (expandedDays.has(key)) expandedDays.delete(key);
      else expandedDays.add(key);
      renderExpenses();
    });
  });

  rows.forEach((e) => {
    el.querySelector(`[data-edit="${e.id}"]`)?.addEventListener('click', () => openModal(e));
    el.querySelector(`[data-delete="${e.id}"]`)?.addEventListener('click', () => removeExpense(e));
  });
}

function dayGroupHtml(g) {
  const open = expandedDays.has(g.label);
  const dayTotal = g.items.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  return `
    <div class="widget" style="padding-bottom:${open ? '8px' : '0'}">
      <button class="widget-head" data-toggle-day="${esc(g.label)}" style="width:100%;border:none;background:none;cursor:pointer;text-align:left;padding:14px 0">
        <h2>${open ? '▾' : '▸'} ${esc(g.label)}</h2>
        <span class="cell-sub">${g.items.length} รายการ · ${THB(dayTotal)}</span>
      </button>
      ${open ? `
        <div class="drop-anim table-wrap flat" style="margin-bottom:12px">
          <table>
            <thead><tr><th>รายการ</th><th class="num">จำนวนเงิน</th><th>หมายเหตุ</th><th>จัดการ</th></tr></thead>
            <tbody>
              ${g.items.map(rowHtml).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

function rowHtml(e) {
  return `
    <tr>
      <td data-label="รายการ">${esc(e.title)}</td>
      <td class="num" data-label="จำนวนเงิน">${THB(e.amount)}</td>
      <td data-label="หมายเหตุ">${esc(e.note || '-')}</td>
      <td data-label="จัดการ">
        <button class="btn small" data-edit="${e.id}">แก้ไข</button>
        <button class="btn small danger" data-delete="${e.id}">ลบ</button>
      </td>
    </tr>
  `;
}

async function removeExpense(e) {
  const ok = await showConfirm(`ลบรายจ่าย "${e.title}"?`, true);
  if (!ok) return;
  await expensesCrud.remove(e.id);
  showToast('ลบแล้ว');
}

function openModal(expense) {
  editingId = expense ? expense.id : null;
  document.getElementById('expModalTitle').textContent = expense ? 'แก้ไขรายจ่าย' : 'เพิ่มรายจ่าย';
  document.getElementById('exp_title').value = expense?.title || '';
  document.getElementById('exp_amount').value = expense?.amount || '';
  document.getElementById('exp_date').value = expense?.date || todayISO();
  document.getElementById('exp_note').value = expense?.note || '';
  document.getElementById('exp_delete').style.display = expense ? 'inline-block' : 'none';
  document.getElementById('expModalBg').classList.add('open');
}

function closeModal() {
  document.getElementById('expModalBg').classList.remove('open');
  editingId = null;
}

export function initExpenseModal() {
  document.getElementById('exp_cancel').addEventListener('click', closeModal);
  document.getElementById('expModalBg').addEventListener('click', (e) => {
    if (e.target.id === 'expModalBg') closeModal();
  });

  guardClick(document.getElementById('exp_delete'), async () => {
    const expense = state.expenses.find((e) => e.id === editingId);
    closeModal();
    if (expense) await removeExpense(expense);
  });

  guardClick(document.getElementById('exp_save'), async () => {
    const title = document.getElementById('exp_title').value.trim();
    const amount = Number(document.getElementById('exp_amount').value);
    const date = document.getElementById('exp_date').value;
    if (!title || !date) { showToast('กรุณากรอกข้อมูลให้ครบ'); return; }
    if (!(amount > 0)) { showToast('จำนวนเงินต้องมากกว่า 0'); return; }

    const id = editingId || uid();
    await expensesCrud.save(id, {
      title, amount, date,
      note: document.getElementById('exp_note').value.trim(),
    });
    closeModal();
    showToast('บันทึกรายจ่ายแล้ว');
  });
}
