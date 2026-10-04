import { state, outstandingBalanceBeforeMonth } from '../store.js';
import { employeesCrud } from '../firestore-service.js';
import { esc, showConfirm, showToast, uid, fmtDate, avatarHtml, guardClick, todayISO } from '../utils.js';

let editingId = null;

export function renderEmployees() {
  const el = document.getElementById('employees');
  if (!el) return;

  const rows = [...state.employees].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>พนักงาน</th><th>ประเภท</th><th>เบอร์โทร</th><th>เริ่มงาน</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
        <tbody id="emp_body">
          ${rows.length ? rows.map(rowHtml).join('') : `<tr><td colspan="6">ยังไม่มีพนักงาน</td></tr>`}
        </tbody>
      </table>
    </div>
    <div style="margin-top:12px">
      <button class="btn primary" id="emp_add">+ เพิ่มพนักงาน</button>
    </div>
  `;

  rows.forEach((emp) => {
    el.querySelector(`[data-edit="${emp.id}"]`).addEventListener('click', () => openModal(emp));
    el.querySelector(`[data-delete="${emp.id}"]`).addEventListener('click', () => removeEmployee(emp));
  });

  el.querySelector('#emp_add').addEventListener('click', () => openModal(null));
}

function rowHtml(emp) {
  const statusPill = emp.active === false
    ? `<span class="pill neutral">ไม่ได้ทำ</span>`
    : `<span class="pill good">ทำงานอยู่</span>`;
  const rolePill = emp.role === 'housekeeper'
    ? `<span class="pill warn">แม่บ้าน</span>`
    : emp.role === 'parttime'
    ? `<span class="pill warn">พาร์ทไทม์</span>`
    : `<span class="pill neutral">พนักงานนวด</span>`;
  return `
    <tr>
      <td data-label="พนักงาน">
        <a href="/employee.html?id=${encodeURIComponent(emp.id)}" style="display:flex;align-items:center;gap:8px;color:inherit;text-decoration:none">
          ${avatarHtml(emp.name, emp.id)} <b>${esc(emp.name)}</b>
        </a>
      </td>
      <td data-label="ประเภท">${rolePill}</td>
      <td data-label="เบอร์โทร">${esc(emp.phone || '-')}</td>
      <td data-label="เริ่มงาน">${fmtDate(emp.startDate)}</td>
      <td data-label="สถานะ">${statusPill}</td>
      <td data-label="จัดการ">
        <button class="btn small" data-edit="${emp.id}">แก้ไข</button>
        <button class="btn small danger" data-delete="${emp.id}">ลบ</button>
      </td>
    </tr>
  `;
}

function openModal(emp) {
  editingId = emp ? emp.id : null;
  document.getElementById('empModalTitle').textContent = emp ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน';
  document.getElementById('emp_name').value = emp?.name || '';
  document.getElementById('emp_phone').value = emp?.phone || '';
  document.getElementById('emp_startDate').value = emp?.startDate || todayISO();
  document.getElementById('emp_role').value = emp?.role === 'housekeeper' || emp?.role === 'parttime' ? emp.role : 'therapist';
  document.getElementById('emp_fixedSalary').value = emp?.fixedSalary ?? '';
  document.getElementById('emp_active').checked = emp?.active !== false;
  document.getElementById('emp_delete').style.display = emp ? 'inline-block' : 'none';
  toggleFixedSalaryField();
  document.getElementById('empModalBg').classList.add('open');
}

function toggleFixedSalaryField() {
  const isHousekeeper = document.getElementById('emp_role').value === 'housekeeper';
  document.getElementById('emp_fixedSalary_field').style.display = isHousekeeper ? 'block' : 'none';
}

function closeModal() {
  document.getElementById('empModalBg').classList.remove('open');
  editingId = null;
}

async function removeEmployee(emp) {
  const owed = outstandingBalanceBeforeMonth(emp.id, '9999-99');
  const message = owed > 0
    ? `พนักงาน "${emp.name}" ยังมียอดเบิกล่วงหน้าค้างอยู่ ${owed.toLocaleString('th-TH')} บาท — ลบแล้วจะจัดการยอดนี้จากหน้าเงินเดือนไม่ได้อีก (แนะนำให้ปิด "ยังทำงานอยู่" แทนการลบ) ยืนยันจะลบเลยหรือไม่?`
    : `ลบพนักงาน "${emp.name}"? ประวัติการนวดจะยังอยู่`;
  const ok = await showConfirm(message, true);
  if (!ok) return;
  await employeesCrud.remove(emp.id);
  showToast('ลบแล้ว');
}

export function initEmployeeModal() {
  document.getElementById('emp_cancel').addEventListener('click', closeModal);
  document.getElementById('empModalBg').addEventListener('click', (e) => {
    if (e.target.id === 'empModalBg') closeModal();
  });
  document.getElementById('emp_role').addEventListener('change', toggleFixedSalaryField);

  guardClick(document.getElementById('emp_delete'), async () => {
    const emp = state.employees.find((e) => e.id === editingId);
    closeModal();
    if (emp) await removeEmployee(emp);
  });

  guardClick(document.getElementById('emp_save'), async () => {
    const name = document.getElementById('emp_name').value.trim();
    if (!name) { showToast('กรุณากรอกชื่อพนักงาน'); return; }
    const role = document.getElementById('emp_role').value;
    const fixedSalaryRaw = document.getElementById('emp_fixedSalary').value;
    const id = editingId || uid();
    await employeesCrud.save(id, {
      name,
      phone: document.getElementById('emp_phone').value.trim(),
      startDate: document.getElementById('emp_startDate').value,
      role,
      fixedSalary: role === 'housekeeper' && fixedSalaryRaw !== '' ? Number(fixedSalaryRaw) : null,
      active: document.getElementById('emp_active').checked,
    });
    closeModal();
    showToast('บันทึกแล้ว');
  });
}
