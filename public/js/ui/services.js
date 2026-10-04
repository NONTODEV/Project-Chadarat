import { state, durations } from '../store.js';
import { servicesCrud, settingsCrud } from '../firestore-service.js';
import { esc, showConfirm, showToast, uid, THB } from '../utils.js';
import { SEED_SERVICES } from '../data/seed-services.js';

let editingId = null;

export function renderServices() {
  const el = document.getElementById('services');
  if (!el) return;

  const rows = [...state.services].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const durationList = durations();

  el.innerHTML = `
    <div class="widget" style="padding:14px 18px">
      <label style="font-size:.85rem;color:var(--text-dim);display:block;margin-bottom:8px">ระยะเวลาที่มีให้เลือก (นาที)</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        ${durationList.map((d) => `
          <span class="pill neutral">${d} น. <button class="icon-btn" data-remove-duration="${d}" aria-label="ลบระยะเวลา ${d} นาที" style="padding:0 0 0 4px;font-size:.8rem;vertical-align:middle">✕</button></span>
        `).join('')}
        <input type="number" id="new_duration" class="price-input" aria-label="เพิ่มระยะเวลาใหม่ (นาที)" style="width:70px" placeholder="เช่น 45" />
        <button class="btn small" id="add_duration">+ เพิ่มระยะเวลา</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>บริการ</th><th>ราคาลูกค้า</th><th>จัดการ</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((svc) => rowHtml(svc, durationList)).join('') : `<tr><td colspan="3">ยังไม่มีบริการ</td></tr>`}
        </tbody>
      </table>
    </div>
    <div style="margin-top:12px">
      <button class="btn primary" id="svc_add">+ เพิ่มบริการ</button>
      <button class="btn small" id="svc_seed">นำเข้าข้อมูลเริ่มต้น</button>
    </div>
  `;

  rows.forEach((svc) => {
    el.querySelector(`[data-edit="${svc.id}"]`).addEventListener('click', () => openModal(svc));
    el.querySelector(`[data-delete="${svc.id}"]`).addEventListener('click', () => removeService(svc));
  });

  el.querySelector('#svc_add').addEventListener('click', () => openModal(null));

  el.querySelector('#svc_seed').addEventListener('click', async () => {
    const ok = await showConfirm('นำเข้าข้อมูลเริ่มต้น 14 รายการ? รายการที่มี id ซ้ำจะถูกเขียนทับ');
    if (!ok) return;
    for (const service of SEED_SERVICES) {
      const { id, ...data } = service;
      await servicesCrud.save(id, data);
    }
    showToast('นำเข้าข้อมูลเริ่มต้นสำเร็จ');
  });

  el.querySelector('#add_duration').addEventListener('click', async () => {
    const input = document.getElementById('new_duration');
    const value = Math.round(Number(input.value));
    if (!value || value <= 0) { showToast('กรุณากรอกจำนวนนาทีที่ถูกต้อง'); return; }
    if (durationList.includes(value)) { showToast('มีระยะเวลานี้อยู่แล้ว'); return; }
    await settingsCrud.save({ durations: [...durationList, value] });
    showToast(`เพิ่มระยะเวลา ${value} นาทีแล้ว`);
  });

  el.querySelectorAll('[data-remove-duration]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = Number(btn.dataset.removeDuration);
      const ok = await showConfirm(`ลบระยะเวลา ${value} นาทีออกจากตัวเลือก?`, true);
      if (!ok) return;
      await settingsCrud.save({ durations: durationList.filter((d) => d !== value) });
      showToast('ลบแล้ว');
    });
  });
}

function rowHtml(svc, durationList) {
  const pills = durationList
    .filter((d) => svc.prices?.[d]?.customer != null)
    .map((d) => `<span class="pill neutral">${d} น. · ${THB(svc.prices[d].customer)}</span>`)
    .join(' ');
  return `
    <tr>
      <td data-label="บริการ"><b>${esc(svc.name)}</b></td>
      <td data-label="ราคาลูกค้า"><div style="display:flex;flex-wrap:wrap;gap:6px">${pills || '<span class="cell-sub">ยังไม่ตั้งราคา</span>'}</div></td>
      <td data-label="จัดการ">
        <button class="btn small" data-edit="${svc.id}">แก้ไขราคา</button>
        <button class="btn small danger" data-delete="${svc.id}">ลบ</button>
      </td>
    </tr>
  `;
}

async function removeService(svc) {
  const ok = await showConfirm(`ลบบริการ "${svc.name}"?`, true);
  if (!ok) return;
  await servicesCrud.remove(svc.id);
  showToast('ลบแล้ว');
}

function openModal(svc) {
  editingId = svc ? svc.id : null;
  document.getElementById('svcModalTitle').textContent = svc ? `แก้ไขราคา: ${svc.name}` : 'เพิ่มบริการใหม่';
  document.getElementById('svc_name_input').value = svc?.name || '';
  document.getElementById('svc_delete').style.display = svc ? 'inline-block' : 'none';

  const grid = document.getElementById('svc_price_grid');
  grid.innerHTML = durations().map((d) => `
    <tr>
      <td data-label="ระยะเวลา">${d} นาที</td>
      <td class="num" data-label="ราคาลูกค้า"><input type="number" class="price-input" data-type="customer" data-d="${d}" aria-label="ราคาลูกค้า ${d} นาที" value="${svc?.prices?.[d]?.customer ?? ''}" placeholder="-"></td>
      <td class="num" data-label="ค่าคอมหมอ"><input type="number" class="price-input" data-type="therapist" data-d="${d}" aria-label="ค่าคอมหมอ ${d} นาที" value="${svc?.prices?.[d]?.therapist ?? ''}" placeholder="-"></td>
    </tr>
  `).join('');

  document.getElementById('svcModalBg').classList.add('open');
}

function closeModal() {
  document.getElementById('svcModalBg').classList.remove('open');
  editingId = null;
}

export function initServiceModal() {
  document.getElementById('svc_cancel').addEventListener('click', closeModal);
  document.getElementById('svcModalBg').addEventListener('click', (e) => {
    if (e.target.id === 'svcModalBg') closeModal();
  });

  document.getElementById('svc_delete').addEventListener('click', async () => {
    const svc = state.services.find((s) => s.id === editingId);
    closeModal();
    if (svc) await removeService(svc);
  });

  document.getElementById('svc_save').addEventListener('click', async () => {
    const name = document.getElementById('svc_name_input').value.trim();
    if (!name) { showToast('กรุณากรอกชื่อบริการ'); return; }

    const prices = {};
    durations().forEach((d) => {
      const customerEl = document.querySelector(`#svc_price_grid input[data-type="customer"][data-d="${d}"]`);
      const therapistEl = document.querySelector(`#svc_price_grid input[data-type="therapist"][data-d="${d}"]`);
      prices[d] = {
        customer: customerEl.value === '' ? null : Number(customerEl.value),
        therapist: therapistEl.value === '' ? null : Number(therapistEl.value),
      };
    });

    const existing = state.services.find((s) => s.id === editingId);
    const id = editingId || uid();
    await servicesCrud.save(id, { name, order: existing?.order ?? 999, prices });
    closeModal();
    showToast('บันทึกแล้ว');
  });
}
