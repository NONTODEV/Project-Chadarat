export function THB(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString('th-TH', { maximumFractionDigits: 2 }) + ' ฿';
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ใช้เช็กว่ารายการหนึ่งๆ ตรงกับคำค้นหาไหม โดยเทียบกับหลายฟิลด์พร้อมกัน (ชื่อพนักงาน, เหตุผล,
// ชื่อลูกค้า ฯลฯ) ไม่สนตัวพิมพ์เล็ก/ใหญ่ — query ว่างถือว่าตรงทุกรายการ
export function matchesSearch(query, ...fields) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => String(f || '').toLowerCase().includes(q));
}

// re-render ทั้ง section เขียน innerHTML ใหม่หมดทุกครั้ง ซึ่งสร้าง <input> ค้นหาขึ้นมาใหม่ด้วย —
// ถ้าไม่ทำแบบนี้ พิมพ์คำค้นหาทีละตัวอักษรจะเสีย focus ไปทุกครั้งที่กดคีย์ (ต้องคลิกกลับเข้าไปใหม่)
export function rerenderKeepingFocus(inputId, render) {
  const prev = document.getElementById(inputId);
  const cursor = prev ? prev.selectionStart : null;
  render();
  const next = document.getElementById(inputId);
  if (next && cursor != null) {
    next.focus();
    next.setSelectionRange(cursor, cursor);
  }
}

// ป้องกันดับเบิลคลิกปุ่มบันทึก (ซึ่งจะสร้างเอกสารซ้ำเพราะ uid() สุ่มใหม่ทุกครั้ง) โดยปิดปุ่ม
// ไว้ระหว่างที่ handler แบบ async ยังทำงานไม่จบ แล้วเปิดกลับคืนเมื่อเสร็จ (ไม่ว่าสำเร็จหรือ error)
export function guardClick(btn, handler) {
  btn.addEventListener('click', async (e) => {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await handler(e);
    } finally {
      btn.disabled = false;
    }
  });
}

function toLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function monthKey(iso) {
  return (iso || '').slice(0, 7); // YYYY-MM
}

export function halfMonthLabel(monthStr, half) {
  const [y, m] = monthStr.split('-').map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
  const lastDay = new Date(y, m, 0).getDate();
  const range = half === 1 ? '1-15' : `16-${lastDay}`;
  return `${range} ${monthLabel}`;
}

export function groupSessionsByPeriod(sessions, grouping) {
  const groups = new Map();
  for (const s of sessions) {
    let key, label;
    if (grouping === 'daily') {
      key = s.date; label = fmtDate(s.date);
    } else if (grouping === 'half-month') {
      const month = monthKey(s.date);
      const half = Number((s.date || '').slice(8, 10)) <= 15 ? 1 : 2;
      key = `${month}-H${half}`;
      label = halfMonthLabel(month, half);
    } else if (grouping === 'yearly') {
      key = (s.date || '').slice(0, 4);
      label = `ปี ${key}`;
    } else {
      key = monthKey(s.date); label = key;
    }
    if (!groups.has(key)) groups.set(key, { label, sessions: [], revenue: 0, commission: 0 });
    const g = groups.get(key);
    g.sessions.push(s);
    g.revenue += Number(s.customerPrice) || 0;
    g.commission += Number(s.commission) || 0;
  }
  return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([, g]) => g);
}

// Generic version of groupSessionsByPeriod for any date-stamped records
// (advances, expenses, leaves, ...) — just buckets items, no domain sums.
export function groupByPeriod(items, grouping, dateField = 'date') {
  const groups = new Map();
  for (const item of items) {
    const dateValue = item[dateField];
    let key, label;
    if (grouping === 'daily') {
      key = dateValue; label = fmtDate(dateValue);
    } else if (grouping === 'half-month') {
      const month = monthKey(dateValue);
      const half = Number((dateValue || '').slice(8, 10)) <= 15 ? 1 : 2;
      key = `${month}-H${half}`;
      label = halfMonthLabel(month, half);
    } else if (grouping === 'yearly') {
      key = (dateValue || '').slice(0, 4);
      label = `ปี ${key}`;
    } else {
      key = monthKey(dateValue); label = key;
    }
    if (!groups.has(key)) groups.set(key, { label, items: [] });
    groups.get(key).items.push(item);
  }
  return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([, g]) => g);
}

export function todayISO() {
  return toLocalISODate(new Date());
}

const AVATAR_COLORS = ['#3b82f6', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777'];
export function colorForId(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function avatarHtml(name, id, cls = '') {
  const initial = esc(String(name || '?').trim()[0] || '?');
  return `<span class="avatar ${cls}" style="background:${colorForId(id)}">${initial}</span>`;
}

export function showConfirm(message, danger = false) {
  return new Promise((resolve) => {
    const bg = document.getElementById('confirmModalBg');
    document.getElementById('confirmMessage').textContent = message;
    const yesBtn = document.getElementById('confirmYes');
    yesBtn.className = 'btn ' + (danger ? 'danger' : 'primary');
    bg.classList.add('open');

    function cleanup(result) {
      bg.classList.remove('open');
      yesBtn.removeEventListener('click', onYes);
      document.getElementById('confirmNo').removeEventListener('click', onNo);
      bg.removeEventListener('click', onBg);
      resolve(result);
    }
    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }
    function onBg(e) { if (e.target === bg) cleanup(false); }

    yesBtn.addEventListener('click', onYes);
    document.getElementById('confirmNo').addEventListener('click', onNo);
    bg.addEventListener('click', onBg);
  });
}

export function showToast(message) {
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 2600);
}
