import { state, isTherapist, durations } from '../store.js';
import { sessionsCrud } from '../firestore-service.js';
import { esc, showConfirm, showToast, uid, fmtDate, THB, todayISO, groupSessionsByPeriod, guardClick } from '../utils.js';

// จำนวนครั้งที่เหลือของแพ็กเกจ นับจากรายการนวดที่ผูก packageId นี้ไว้จริง (ไม่ใช่ตัวเลขแยก
// ที่ต้องคอยอัปเดตเอง) — เลือกแพ็กเกจตอนบันทึกการนวดเมื่อไหร่ก็ถูกนับที่นี่โดยอัตโนมัติ
function packageRemaining(pkg) {
  const total = (Number(pkg.purchasedSessions) || 0) + (Number(pkg.bonusSessions) || 0);
  const used = state.sessions.filter((s) => s.packageId === pkg.id).length;
  return total - used;
}

let periodType = 'monthly'; // daily | half-month | monthly | yearly
let selectedLabel = null; // label of the chosen bucket within periodType; null = most recent
let expandedEmployees = new Set();
let editingId = null;
let editingVisitId = null; // preserved so editing one item of a multi-item visit keeps it grouped
let itemCount = 1; // number of service rows currently shown in the "บันทึกการนวด" modal

export function renderSessions() {
  const el = document.getElementById('sessions');
  if (!el) return;

  const allGroups = groupSessionsByPeriod(state.sessions, periodType);
  if (!selectedLabel || !allGroups.some((g) => g.label === selectedLabel)) {
    selectedLabel = allGroups[0]?.label || null;
  }
  const current = allGroups.find((g) => g.label === selectedLabel);
  const rows = current ? [...current.sessions].sort((a, b) => (b.date || '').localeCompare(a.date || '')) : [];

  const byEmployee = groupByEmployee(rows);

  el.innerHTML = `
    <div class="widget-head" style="margin-bottom:10px">
      <div class="seg-toggle">
        <button data-period="daily" class="${periodType === 'daily' ? 'active' : ''}">รายวัน</button>
        <button data-period="half-month" class="${periodType === 'half-month' ? 'active' : ''}">รายครึ่งเดือน</button>
        <button data-period="monthly" class="${periodType === 'monthly' ? 'active' : ''}">รายเดือน</button>
        <button data-period="yearly" class="${periodType === 'yearly' ? 'active' : ''}">รายปี</button>
      </div>
      <select class="month-filter" id="ses_bucket" aria-label="เลือกช่วงเวลาการนวด">
        ${allGroups.map((g) => `<option value="${esc(g.label)}" ${g.label === selectedLabel ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}
      </select>
    </div>

    ${byEmployee.length ? byEmployee.map(employeeGroupHtml).join('') : `<p class="cell-sub">ไม่มีรายการในช่วงนี้</p>`}

    <div style="margin-top:12px"><button class="btn primary" id="ses_add">+ บันทึกการนวด</button></div>
  `;

  el.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      periodType = btn.dataset.period;
      selectedLabel = null;
      renderSessions();
    });
  });
  document.getElementById('ses_bucket')?.addEventListener('change', (e) => {
    selectedLabel = e.target.value;
    renderSessions();
  });
  document.getElementById('ses_add').addEventListener('click', () => openModal());

  el.querySelectorAll('[data-toggle-employee]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleEmployee;
      if (expandedEmployees.has(id)) expandedEmployees.delete(id);
      else expandedEmployees.add(id);
      renderSessions();
    });
  });

  rows.forEach((s) => {
    el.querySelector(`[data-edit="${s.id}"]`)?.addEventListener('click', () => openModal(s));
    el.querySelector(`[data-delete="${s.id}"]`)?.addEventListener('click', () => removeSession(s));
  });
}

function groupByEmployee(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (!map.has(s.employeeId)) {
      map.set(s.employeeId, { employeeId: s.employeeId, employeeName: s.employeeName, sessions: [] });
    }
    map.get(s.employeeId).sessions.push(s);
  }
  return Array.from(map.values()).sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || '', 'th'));
}

function employeeGroupHtml(g) {
  const open = expandedEmployees.has(g.employeeId);
  const visits = groupByVisit(g.sessions);
  return `
    <div class="widget" style="padding-bottom:${open ? '8px' : '0'}">
      <button class="widget-head" data-toggle-employee="${g.employeeId}" style="width:100%;border:none;background:none;cursor:pointer;text-align:left;padding:14px 0">
        <h2>${open ? '▾' : '▸'} ${esc(g.employeeName)}</h2>
      </button>
      ${open ? `
        <div class="drop-anim table-wrap flat" style="margin-bottom:12px">
          <table>
            <thead><tr><th>วันที่</th><th>บริการ</th><th>จัดการ</th></tr></thead>
            <tbody>
              ${visits.map(visitRowHtml).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

// มานวดครั้งเดียวแต่ทำหลายบริการ จะถูกบันทึกเป็นหลาย session แยกกันแต่แชร์ visitId
// เดียวกัน (ของเก่าที่ไม่มี visitId ใช้ id ตัวเองแทน = กลุ่มละ 1 รายการ) กลุ่มรวมกันเพื่อ
// แสดงเป็นแถวเดียว แต่แก้ไข/ลบยังทำแยกทีละรายการเหมือนเดิม
function groupByVisit(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = s.visitId || s.id;
    if (!map.has(key)) map.set(key, { date: s.date, items: [] });
    map.get(key).items.push(s);
  }
  return Array.from(map.values());
}

function visitRowHtml(visit) {
  const multi = visit.items.length > 1;
  return `
    <tr>
      <td data-label="วันที่">${fmtDate(visit.date)}</td>
      <td data-label="บริการ">
        <div>
          ${multi ? `<span class="pill neutral" style="margin-bottom:4px">${visit.items.length} รายการ</span>` : ''}
          ${visit.items.map((s) => {
            const flags = [
              s.late ? '<span class="pill warn">มาสาย</span>' : '',
              s.leftEarly ? '<span class="pill warn">ออกก่อน</span>' : '',
            ].join(' ');
            if (s.attendanceOnly) return `<div><span class="pill good">มาทำงาน ไม่มีลูกค้า (ได้ค่าประกัน)</span> ${flags}</div>`;
            const pkgPill = s.packageId ? `<span class="pill warn">แพ็กเกจ: ${esc(s.packageCustomerName || '')}</span>` : '';
            const ownerPill = s.isOwner ? `<span class="pill neutral">เจ้าของร้านนวดเอง</span>` : '';
            return `<div>${esc(s.serviceName)} (${s.duration} นาที) ${pkgPill}${ownerPill} ${flags}</div>`;
          }).join('')}
        </div>
      </td>
      <td data-label="จัดการ">
        <div>
          ${visit.items.map((s) => `
            <div style="margin-bottom:4px">
              <button class="btn small" data-edit="${s.id}">แก้ไข</button>
              <button class="btn small danger" data-delete="${s.id}">ลบ</button>
            </div>
          `).join('')}
        </div>
      </td>
    </tr>
  `;
}

async function removeSession(s) {
  const ok = await showConfirm(`ลบรายการนวดของ "${s.employeeName}" วันที่ ${fmtDate(s.date)}?`, true);
  if (!ok) return;
  await sessionsCrud.remove(s.id);
  showToast('ลบแล้ว');
}

function itemRowHtml(i) {
  return `
    <div class="field" data-row="${i}" style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <label style="margin:0">รายการที่ ${i + 1}</label>
        ${i > 0 ? `<button type="button" class="btn small danger" data-remove-item="${i}">ลบรายการนี้</button>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="ses_item_service" style="flex:1 1 140px" aria-label="บริการ รายการที่ ${i + 1}"></select>
        <select class="ses_item_duration" style="flex:1 1 100px" aria-label="ระยะเวลา รายการที่ ${i + 1}"></select>
      </div>
      <div class="ses_item_pkg_wrap" style="margin-top:8px">
        <select class="ses_item_package" aria-label="ใช้แพ็กเกจ รายการที่ ${i + 1}"></select>
        <div class="cell-sub" style="margin-top:4px">ถ้าลูกค้าใช้แพ็กเกจที่ซื้อไว้ ลูกค้าไม่ต้องจ่ายเพิ่ม แต่หมอยังได้ค่าคอมตามปกติ (ร้านได้เงินจากตอนขายแพ็กเกจแล้ว)</div>
      </div>
      <div style="margin-top:8px">
        <label style="display:flex;align-items:flex-start;gap:6px;font-size:.85rem">
          <input type="checkbox" class="ses_item_owner" style="width:auto;margin-top:2px" />
          <span>เจ้าของร้านนวดเอง (ไม่คิดเงิน แต่หมอยังได้ค่าคอมตามปกติ)</span>
        </label>
      </div>
      <p class="ses_item_preview cell-sub" style="margin:6px 0 0"></p>
    </div>
  `;
}

function readItemsFromDom() {
  const container = document.getElementById('ses_items');
  return Array.from({ length: itemCount }).map((_, i) => ({
    serviceId: container.querySelector(`[data-row="${i}"] .ses_item_service`).value,
    duration: Number(container.querySelector(`[data-row="${i}"] .ses_item_duration`).value),
    packageId: container.querySelector(`[data-row="${i}"] .ses_item_package`)?.value || null,
    isOwner: !!container.querySelector(`[data-row="${i}"] .ses_item_owner`)?.checked,
  }));
}

function updateItemPreview(i) {
  const container = document.getElementById('ses_items');
  const svcSel = container.querySelector(`[data-row="${i}"] .ses_item_service`);
  const durSel = container.querySelector(`[data-row="${i}"] .ses_item_duration`);
  const pkgSel = container.querySelector(`[data-row="${i}"] .ses_item_package`);
  const ownerChk = container.querySelector(`[data-row="${i}"] .ses_item_owner`);
  const svc = state.services.find((s) => s.id === svcSel.value);
  const p = svc?.prices?.[durSel.value] || {};
  const noCharge = !!pkgSel?.value || ownerChk?.checked;
  const reason = pkgSel?.value ? 'ใช้แพ็กเกจ' : 'เจ้าของร้านนวดเอง';
  container.querySelector(`[data-row="${i}"] .ses_item_preview`).textContent = noCharge
    ? `ราคาลูกค้า: 0.00 ฿ (${reason})  ·  ค่าคอม: ${p.therapist != null ? THB(p.therapist) : '-'}`
    : `ราคาลูกค้า: ${p.customer != null ? THB(p.customer) : '-'}  ·  ค่าคอม: ${p.therapist != null ? THB(p.therapist) : '-'}`;
}

// แสดงแพ็กเกจที่ยังเหลือ "ทุกใบ" ไม่กรองตามบริการ/ระยะเวลาที่เลือกไว้อยู่ตอนนี้ — เพราะ
// แถวใหม่จะมีบริการ/ระยะเวลา default (ตัวแรกในลิสต์) ไว้ก่อนเสมอ ถ้ากรองไว้ก่อนจะทำให้
// แพ็กเกจส่วนใหญ่หายไปจนกว่าจะเดาบริการ/ระยะเวลาที่ตรงถูก เลือกแพ็กเกจก่อน แล้วให้ระบบ
// ปรับบริการ/ระยะเวลาให้ตรงกับแพ็กเกจนั้นให้เองทีหลังแทน (ดู pkgSel change listener ด้านล่าง)
function populatePackageOptions(i, selectedPackageId) {
  const container = document.getElementById('ses_items');
  const pkgSel = container.querySelector(`[data-row="${i}"] .ses_item_package`);
  if (!pkgSel) return;
  const eligible = state.packages.filter((pkg) => packageRemaining(pkg) > 0 || pkg.id === selectedPackageId);
  pkgSel.innerHTML = `<option value="">ไม่ใช้แพ็กเกจ (ลูกค้าจ่ายปกติ)</option>` +
    eligible.map((pkg) => `<option value="${pkg.id}">${esc(pkg.customerName)} · ${esc(pkg.serviceName || 'ทุกบริการ')}${pkg.duration ? ` ${pkg.duration} น.` : ''} · เหลือ ${packageRemaining(pkg)} ครั้ง</option>`).join('');
  pkgSel.value = selectedPackageId || '';
}

function renderItemRows(initial) {
  const container = document.getElementById('ses_items');
  container.innerHTML = Array.from({ length: itemCount }).map((_, i) => itemRowHtml(i)).join('');

  for (let i = 0; i < itemCount; i++) {
    const svcSel = container.querySelector(`[data-row="${i}"] .ses_item_service`);
    const durSel = container.querySelector(`[data-row="${i}"] .ses_item_duration`);
    svcSel.innerHTML = state.services.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    durSel.innerHTML = durations().map((d) => `<option value="${d}">${d} นาที</option>`).join('');
    if (initial?.[i]) {
      svcSel.value = initial[i].serviceId;
      durSel.value = initial[i].duration;
    }
    const ownerChk = container.querySelector(`[data-row="${i}"] .ses_item_owner`);
    ownerChk.checked = !!initial?.[i]?.isOwner;
    populatePackageOptions(i, initial?.[i]?.packageId);
    const pkgSel = container.querySelector(`[data-row="${i}"] .ses_item_package`);
    svcSel.addEventListener('change', () => updateItemPreview(i));
    durSel.addEventListener('change', () => updateItemPreview(i));
    pkgSel.addEventListener('change', () => {
      // เลือกแพ็กเกจแล้วปรับบริการ/ระยะเวลาให้ตรงกับที่ขายแพ็กเกจนั้นไว้ให้อัตโนมัติ
      const pkg = state.packages.find((p) => p.id === pkgSel.value);
      if (pkg?.serviceId) svcSel.value = pkg.serviceId;
      if (pkg?.duration) durSel.value = pkg.duration;
      updateItemPreview(i);
    });
    ownerChk.addEventListener('change', () => updateItemPreview(i));
    updateItemPreview(i);
  }

  container.querySelectorAll('[data-remove-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.removeItem);
      const current = readItemsFromDom();
      current.splice(idx, 1);
      itemCount = current.length;
      renderItemRows(current);
    });
  });
}

function openModal(session) {
  editingId = session ? session.id : null;
  editingVisitId = session ? (session.visitId || null) : null;
  document.getElementById('sesModalTitle').textContent = session ? 'แก้ไขการนวด' : 'บันทึกการนวด';
  document.getElementById('ses_add_item').style.display = session ? 'none' : 'inline-block';

  const empSel = document.getElementById('ses_employee');
  empSel.innerHTML = state.employees.filter(e => (e.active !== false && isTherapist(e)) || e.id === session?.employeeId)
    .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');

  itemCount = 1;
  const noCustomer = document.getElementById('ses_no_customer');
  if (session) {
    empSel.value = session.employeeId;
    document.getElementById('ses_date').value = session.date;
    document.getElementById('ses_late').checked = !!session.late;
    document.getElementById('ses_leftEarly').checked = !!session.leftEarly;
    noCustomer.checked = !!session.attendanceOnly;
    renderItemRows([{ serviceId: session.serviceId, duration: session.duration, packageId: session.packageId || null, isOwner: !!session.isOwner }]);
  } else {
    document.getElementById('ses_date').value = todayISO();
    document.getElementById('ses_late').checked = false;
    document.getElementById('ses_leftEarly').checked = false;
    noCustomer.checked = false;
    renderItemRows();
  }
  toggleItemsSectionVisibility();

  document.getElementById('sesModalBg').classList.add('open');
}

function toggleItemsSectionVisibility() {
  const checked = document.getElementById('ses_no_customer').checked;
  document.getElementById('ses_items_section').style.display = checked ? 'none' : '';
}

function closeModal() {
  document.getElementById('sesModalBg').classList.remove('open');
  editingId = null;
  editingVisitId = null;
}

export function initSessionModal() {
  document.getElementById('ses_cancel').addEventListener('click', closeModal);
  document.getElementById('sesModalBg').addEventListener('click', (e) => {
    if (e.target.id === 'sesModalBg') closeModal();
  });
  document.getElementById('ses_no_customer').addEventListener('change', toggleItemsSectionVisibility);

  document.getElementById('ses_add_item').addEventListener('click', () => {
    const current = readItemsFromDom();
    current.push({ serviceId: state.services[0]?.id, duration: durations()[0] });
    itemCount = current.length;
    renderItemRows(current);
  });

  guardClick(document.getElementById('ses_save'), async () => {
    const employeeId = document.getElementById('ses_employee').value;
    const date = document.getElementById('ses_date').value;
    const employee = state.employees.find((e) => e.id === employeeId);
    if (!employee || !date) { showToast('กรุณากรอกข้อมูลให้ครบ'); return; }

    const late = document.getElementById('ses_late').checked;
    const leftEarly = document.getElementById('ses_leftEarly').checked;
    const noCustomer = document.getElementById('ses_no_customer').checked;

    if (noCustomer) {
      const payload = {
        employeeId, employeeName: employee.name,
        serviceId: null, serviceName: 'ไม่มีลูกค้า (ได้ค่าประกันขั้นต่ำ)',
        duration: 0, date,
        customerPrice: 0, commission: 0,
        late, leftEarly, attendanceOnly: true,
        ...(editingId && editingVisitId ? { visitId: editingVisitId } : {}),
      };
      await sessionsCrud.save(editingId || uid(), payload);
      closeModal();
      showToast(editingId ? 'แก้ไขแล้ว' : 'บันทึกวันมาทำงานไม่มีลูกค้าแล้ว');
      return;
    }

    const items = readItemsFromDom();
    if (!items.length || items.some((it) => !it.serviceId)) {
      showToast('กรุณาเลือกบริการให้ครบทุกรายการ');
      return;
    }

    // บริการ/ระยะเวลาที่ยังไม่ได้ตั้งราคาไว้ (prices[d] เป็น undefined) จะได้ customerPrice/
    // commission เป็น 0 แบบเงียบๆ ถ้าไม่เช็กก่อน — หมอนวดจะไม่ได้ค่าคอมโดยไม่มีอะไรเตือนเลย
    for (const it of items) {
      const service = state.services.find((s) => s.id === it.serviceId);
      const p = service?.prices?.[it.duration] || {};
      const noCharge = !!it.packageId || it.isOwner;
      if (p.therapist == null || (!noCharge && p.customer == null)) {
        showToast(`บริการ "${service?.name || ''}" ยังไม่ได้ตั้งราคาสำหรับ ${it.duration} นาที กรุณาไปตั้งราคาที่หน้า "ราคานวด" ก่อน`);
        return;
      }
    }

    // แถวหลายรายการในการนวดครั้งเดียวกัน อาจเลือกแพ็กเกจเดียวกันซ้ำกันโดยไม่รู้ตัว (แต่ละแถว
    // เห็นแพ็กเกจนี้เหลือพอตอนเลือก เพราะยังไม่มีแถวไหนบันทึกจริงลง state.sessions) เช็กรวมกัน
    // ทุกแถวก่อนบันทึกจริง เพื่อไม่ให้ใช้แพ็กเกจเกินจำนวนที่เหลือจริง
    if (!editingId) {
      const requestedPerPackage = new Map();
      for (const it of items) {
        if (!it.packageId) continue;
        requestedPerPackage.set(it.packageId, (requestedPerPackage.get(it.packageId) || 0) + 1);
      }
      for (const [packageId, requested] of requestedPerPackage) {
        const pkg = state.packages.find((p) => p.id === packageId);
        if (pkg && requested > packageRemaining(pkg)) {
          showToast(`แพ็กเกจของ "${pkg.customerName}" เหลือ ${packageRemaining(pkg)} ครั้ง แต่เลือกใช้ ${requested} รายการในครั้งนี้`);
          return;
        }
      }
    }

    if (editingId) {
      const it = items[0];
      const service = state.services.find((s) => s.id === it.serviceId);
      const p = service.prices?.[it.duration] || {};
      const pkg = it.packageId ? state.packages.find((pk) => pk.id === it.packageId) : null;
      await sessionsCrud.save(editingId, {
        employeeId, employeeName: employee.name,
        serviceId: it.serviceId, serviceName: service.name,
        duration: Number(it.duration), date,
        customerPrice: (pkg || it.isOwner) ? 0 : (p.customer ?? 0), commission: p.therapist ?? 0,
        late, leftEarly,
        packageId: pkg ? pkg.id : null, packageCustomerName: pkg ? pkg.customerName : null,
        isOwner: !!it.isOwner,
        ...(editingVisitId ? { visitId: editingVisitId } : {}),
      });
      closeModal();
      showToast('แก้ไขรายการนวดแล้ว');
      return;
    }

    const visitId = uid();
    for (const it of items) {
      const service = state.services.find((s) => s.id === it.serviceId);
      const p = service.prices?.[it.duration] || {};
      const pkg = it.packageId ? state.packages.find((pk) => pk.id === it.packageId) : null;
      await sessionsCrud.save(uid(), {
        employeeId, employeeName: employee.name,
        serviceId: it.serviceId, serviceName: service.name,
        duration: Number(it.duration), date,
        customerPrice: (pkg || it.isOwner) ? 0 : (p.customer ?? 0), commission: p.therapist ?? 0,
        late, leftEarly,
        packageId: pkg ? pkg.id : null, packageCustomerName: pkg ? pkg.customerName : null,
        isOwner: !!it.isOwner,
        visitId,
      });
    }
    closeModal();
    showToast(items.length > 1 ? `บันทึกการนวด ${items.length} รายการแล้ว` : 'บันทึกการนวดแล้ว');
  });
}
