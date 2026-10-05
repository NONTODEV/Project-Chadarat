import { state, durations } from '../store.js';
import { packagesCrud, packageTemplatesCrud } from '../firestore-service.js';
import { esc, showConfirm, showToast, uid, fmtDate, THB, todayISO, guardClick, matchesSearch, rerenderKeepingFocus } from '../utils.js';

let expandedPackages = new Set();
let editingId = null;
let editingTemplateId = null;
let searchQuery = '';

export function renderPackages() {
  const el = document.getElementById('packages');
  if (!el) return;

  const rows = [...state.packages]
    .sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''))
    .filter((p) => matchesSearch(searchQuery, p.customerName, p.customerPhone, p.serviceName));
  const templates = [...state.packageTemplates].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));

  el.innerHTML = `
    <div class="widget" style="padding:14px 18px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <label style="font-size:.85rem;color:var(--text-dim)">เทมเพลตแพ็กเกจ (ตั้งไว้เลือกเร็วๆ ตอนเพิ่มแพ็กเกจใหม่)</label>
        <button class="btn small" id="pkgTpl_add">+ เพิ่มเทมเพลต</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${templates.length ? templates.map((t) => `
          <span class="pill neutral">${esc(t.name)} · ${esc(t.serviceName)} ${t.duration} น. · ${t.purchasedSessions}+${t.bonusSessions} ครั้ง · ${THB(t.price)}
            <button class="icon-btn" data-edit-template="${t.id}" aria-label="แก้ไขเทมเพลต ${esc(t.name)}" style="padding:0 0 0 4px">✎</button>
          </span>
        `).join('') : `<span class="cell-sub">ยังไม่มีเทมเพลต</span>`}
      </div>
    </div>

    <div class="widget-head" style="margin-bottom:10px">
      <input type="search" class="search-input" id="pkg_search" placeholder="ค้นหาชื่อ/เบอร์โทร/บริการ..." value="${esc(searchQuery)}" aria-label="ค้นหาแพ็กเกจ" />
    </div>

    ${rows.length ? rows.map(packageCardHtml).join('') : `<p class="cell-sub">${searchQuery ? 'ไม่พบแพ็กเกจที่ค้นหา' : 'ยังไม่มีแพ็กเกจ'}</p>`}
    <div style="margin-top:12px"><button class="btn primary" id="pkg_add">+ เพิ่มแพ็กเกจ</button></div>
  `;

  document.getElementById('pkg_add').addEventListener('click', () => openModal());
  document.getElementById('pkgTpl_add').addEventListener('click', () => openTemplateModal());
  document.getElementById('pkg_search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    rerenderKeepingFocus('pkg_search', renderPackages);
  });

  el.querySelectorAll('[data-edit-template]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tpl = state.packageTemplates.find((t) => t.id === btn.dataset.editTemplate);
      if (tpl) openTemplateModal(tpl);
    });
  });

  el.querySelectorAll('[data-toggle-package]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.togglePackage;
      if (expandedPackages.has(id)) expandedPackages.delete(id);
      else expandedPackages.add(id);
      renderPackages();
    });
  });

  rows.forEach((pkg) => {
    el.querySelector(`[data-edit="${pkg.id}"]`)?.addEventListener('click', () => openModal(pkg));
    el.querySelector(`[data-delete="${pkg.id}"]`)?.addEventListener('click', () => removePackage(pkg));
  });
}

// จำนวนครั้งที่ใช้ไปอิงจากรายการนวดที่ผูก packageId นี้ไว้ตรงๆ (ตอนบันทึกการนวดเลือกใช้
// แพ็กเกจนี้เมื่อไหร่ก็นับที่นั่นเลย) ไม่ต้องมากดติ๊ก/เพิ่มวันที่แยกซ้ำอีกรอบในหน้านี้
function usageSessionsFor(pkg) {
  return state.sessions
    .filter((s) => s.packageId === pkg.id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function packageCardHtml(pkg) {
  const open = expandedPackages.has(pkg.id);
  const total = (Number(pkg.purchasedSessions) || 0) + (Number(pkg.bonusSessions) || 0);
  const usageSessions = usageSessionsFor(pkg);
  const used = usageSessions.length;
  const remaining = Math.max(0, total - used);
  const statusPill = remaining <= 0 ? '<span class="pill bad">หมดแพ็กเกจแล้ว</span>' : '<span class="pill good">ยังใช้ได้</span>';
  const durationLabel = pkg.duration ? ` ${pkg.duration} น.` : '';

  return `
    <div class="widget" style="padding-bottom:${open ? '8px' : '0'}">
      <button class="widget-head" data-toggle-package="${pkg.id}" style="width:100%;border:none;background:none;cursor:pointer;text-align:left;padding:14px 0">
        <h2>${open ? '▾' : '▸'} ${esc(pkg.customerName)}</h2>
        <span class="cell-sub">${esc(pkg.serviceName || 'ทุกบริการ')}${durationLabel} · ใช้ไปแล้ว ${used}/${total} ครั้ง · ซื้อ ${fmtDate(pkg.purchaseDate)} ${statusPill}</span>
      </button>
      ${open ? `
        <div class="drop-anim" style="padding-bottom:12px">
          <div class="summary-cards" style="margin-bottom:12px">
            <div class="summary-card"><span>เบอร์โทร</span><b style="font-size:1rem">${esc(pkg.customerPhone || '-')}</b></div>
            <div class="summary-card"><span>ที่ซื้อ</span><b style="font-size:1rem">${pkg.purchasedSessions || 0} ครั้ง + แถม ${pkg.bonusSessions || 0}</b></div>
            <div class="summary-card"><span>ราคา</span><b style="font-size:1rem">${pkg.price != null ? THB(pkg.price) : '-'}</b></div>
            <div class="summary-card"><span>คงเหลือ</span><b style="font-size:1rem;color:${remaining <= 0 ? 'var(--bad)' : 'var(--good)'}">${remaining} ครั้ง</b></div>
          </div>
          <div style="margin-bottom:10px">
            <b style="font-size:.85rem">ประวัติการมาใช้บริการ (อิงจากบันทึกการนวดที่เลือกแพ็กเกจนี้)</b>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
              ${usageSessions.length ? usageSessions.map((s) => `
                <span class="pill neutral">${fmtDate(s.date)} · ${esc(s.serviceName)} · ${esc(s.employeeName)}</span>
              `).join('') : '<span class="cell-sub">ยังไม่มีการใช้งาน — ไปเลือกแพ็กเกจนี้ตอนบันทึกการนวดได้เลย</span>'}
            </div>
          </div>
          <div>
            <button class="btn small" data-edit="${pkg.id}">แก้ไข</button>
            <button class="btn small danger" data-delete="${pkg.id}">ลบแพ็กเกจ</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

async function removePackage(pkg) {
  const ok = await showConfirm(`ลบแพ็กเกจของ "${pkg.customerName}"?`, true);
  if (!ok) return;
  await packagesCrud.remove(pkg.id);
  showToast('ลบแล้ว');
}

function fillServiceAndDuration(selectId, durationSelectId, serviceId, duration) {
  const svcSel = document.getElementById(selectId);
  svcSel.innerHTML = `<option value="">ทุกบริการ</option>` +
    state.services.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  svcSel.value = serviceId || '';

  const durSel = document.getElementById(durationSelectId);
  durSel.innerHTML = durations().map((d) => `<option value="${d}">${d} นาที</option>`).join('');
  if (duration != null) durSel.value = duration;
}

function openModal(pkg) {
  editingId = pkg ? pkg.id : null;
  document.getElementById('pkgModalTitle').textContent = pkg ? 'แก้ไขแพ็กเกจ' : 'เพิ่มแพ็กเกจใหม่';

  const tplSel = document.getElementById('pkg_template');
  tplSel.innerHTML = `<option value="">-- ไม่ใช้เทมเพลต --</option>` +
    state.packageTemplates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  tplSel.value = '';

  fillServiceAndDuration('pkg_service', 'pkg_duration', pkg?.serviceId, pkg?.duration);

  document.getElementById('pkg_customerName').value = pkg?.customerName || '';
  document.getElementById('pkg_customerPhone').value = pkg?.customerPhone || '';
  document.getElementById('pkg_purchased').value = pkg?.purchasedSessions ?? 10;
  document.getElementById('pkg_bonus').value = pkg?.bonusSessions ?? 1;
  document.getElementById('pkg_price').value = pkg?.price ?? '';
  document.getElementById('pkg_purchaseDate').value = pkg?.purchaseDate || todayISO();
  document.getElementById('pkg_delete').style.display = pkg ? 'inline-block' : 'none';

  document.getElementById('pkgModalBg').classList.add('open');
}

function closeModal() {
  document.getElementById('pkgModalBg').classList.remove('open');
  editingId = null;
}

export function initPackageModal() {
  document.getElementById('pkg_cancel').addEventListener('click', closeModal);
  document.getElementById('pkgModalBg').addEventListener('click', (e) => {
    if (e.target.id === 'pkgModalBg') closeModal();
  });

  document.getElementById('pkg_template').addEventListener('change', (e) => {
    const tpl = state.packageTemplates.find((t) => t.id === e.target.value);
    if (!tpl) return;
    document.getElementById('pkg_service').value = tpl.serviceId || '';
    document.getElementById('pkg_duration').value = tpl.duration;
    document.getElementById('pkg_purchased').value = tpl.purchasedSessions;
    document.getElementById('pkg_bonus').value = tpl.bonusSessions;
    document.getElementById('pkg_price').value = tpl.price;
  });

  guardClick(document.getElementById('pkg_delete'), async () => {
    if (!editingId) return;
    const ok = await showConfirm('ลบแพ็กเกจนี้?', true);
    if (!ok) return;
    await packagesCrud.remove(editingId);
    closeModal();
    showToast('ลบแล้ว');
  });

  guardClick(document.getElementById('pkg_save'), async () => {
    const customerName = document.getElementById('pkg_customerName').value.trim();
    const purchaseDate = document.getElementById('pkg_purchaseDate').value;
    if (!customerName || !purchaseDate) { showToast('กรุณากรอกข้อมูลให้ครบ'); return; }

    const serviceId = document.getElementById('pkg_service').value;
    const service = state.services.find((s) => s.id === serviceId);
    const priceRaw = document.getElementById('pkg_price').value;
    const purchasedSessions = Math.max(0, Number(document.getElementById('pkg_purchased').value) || 0);
    const bonusSessions = Math.max(0, Number(document.getElementById('pkg_bonus').value) || 0);
    const price = priceRaw === '' ? null : Math.max(0, Number(priceRaw) || 0);

    if (editingId) {
      const existingPkg = state.packages.find((p) => p.id === editingId);
      const used = existingPkg ? usageSessionsFor(existingPkg).length : 0;
      if (purchasedSessions + bonusSessions < used) {
        showToast(`แพ็กเกจนี้ถูกใช้ไปแล้ว ${used} ครั้ง ลดจำนวนครั้งรวมให้ต่ำกว่านี้ไม่ได้`);
        return;
      }
    }

    const id = editingId || uid();
    await packagesCrud.save(id, {
      customerName,
      customerPhone: document.getElementById('pkg_customerPhone').value.trim(),
      serviceId: serviceId || null,
      serviceName: service ? service.name : 'ทุกบริการ',
      duration: Number(document.getElementById('pkg_duration').value) || null,
      purchasedSessions,
      bonusSessions,
      price,
      purchaseDate,
    });
    closeModal();
    showToast(editingId ? 'แก้ไขแพ็กเกจแล้ว' : 'เพิ่มแพ็กเกจแล้ว');
  });
}

function openTemplateModal(tpl) {
  editingTemplateId = tpl ? tpl.id : null;
  document.getElementById('pkgTplModalTitle').textContent = tpl ? 'แก้ไขเทมเพลตแพ็กเกจ' : 'เพิ่มเทมเพลตแพ็กเกจ';

  fillServiceAndDuration('pkgTpl_service', 'pkgTpl_duration', tpl?.serviceId, tpl?.duration);

  document.getElementById('pkgTpl_name').value = tpl?.name || '';
  document.getElementById('pkgTpl_purchased').value = tpl?.purchasedSessions ?? 10;
  document.getElementById('pkgTpl_bonus').value = tpl?.bonusSessions ?? 1;
  document.getElementById('pkgTpl_price').value = tpl?.price ?? '';
  document.getElementById('pkgTpl_delete').style.display = tpl ? 'inline-block' : 'none';

  document.getElementById('pkgTplModalBg').classList.add('open');
}

function closeTemplateModal() {
  document.getElementById('pkgTplModalBg').classList.remove('open');
  editingTemplateId = null;
}

export function initPackageTemplateModal() {
  document.getElementById('pkgTpl_cancel').addEventListener('click', closeTemplateModal);
  document.getElementById('pkgTplModalBg').addEventListener('click', (e) => {
    if (e.target.id === 'pkgTplModalBg') closeTemplateModal();
  });

  guardClick(document.getElementById('pkgTpl_delete'), async () => {
    if (!editingTemplateId) return;
    const ok = await showConfirm('ลบเทมเพลตนี้?', true);
    if (!ok) return;
    await packageTemplatesCrud.remove(editingTemplateId);
    closeTemplateModal();
    showToast('ลบแล้ว');
  });

  guardClick(document.getElementById('pkgTpl_save'), async () => {
    const name = document.getElementById('pkgTpl_name').value.trim();
    const price = document.getElementById('pkgTpl_price').value;
    if (!name || price === '') { showToast('กรุณากรอกข้อมูลให้ครบ'); return; }

    const serviceId = document.getElementById('pkgTpl_service').value;
    const service = state.services.find((s) => s.id === serviceId);

    const id = editingTemplateId || uid();
    await packageTemplatesCrud.save(id, {
      name,
      serviceId: serviceId || null,
      serviceName: service ? service.name : 'ทุกบริการ',
      duration: Number(document.getElementById('pkgTpl_duration').value) || null,
      purchasedSessions: Math.max(0, Number(document.getElementById('pkgTpl_purchased').value) || 0),
      bonusSessions: Math.max(0, Number(document.getElementById('pkgTpl_bonus').value) || 0),
      price: Math.max(0, Number(price) || 0),
    });
    closeTemplateModal();
    showToast(editingTemplateId ? 'แก้ไขเทมเพลตแล้ว' : 'เพิ่มเทมเพลตแล้ว');
  });
}
