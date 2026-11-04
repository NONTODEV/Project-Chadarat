import {
  state, availableHalfMonths, commissionForEmployeeInHalfMonth, guaranteedEarningsForEmployeeInHalfMonth,
  approvedAdvanceForEmployeeInMonth, deductionOverrideForMonth, outstandingBalanceBeforeMonth,
  outstandingBalanceAfterMonth, isPayrollPaid, isTherapist,
  dailyBreakdownForEmployeeInHalfMonth, sessionsForHalfMonth, advancesForEmployee, advanceDeductedAmounts, minDailyWage,
  otherDeductionsForEmployeeInHalfMonth, otherDeductionOverrideForMonth, deductionsForEmployeeInHalfMonth,
  isParttime, parttimeDailyPayFor, parttimeDailyPaidTotalInHalfMonth, parttimeDailyPaysForEmployeeInHalfMonth,
} from '../store.js';
import { payrollCrud, payrollDeductionsCrud, settingsCrud, parttimeDailyPaysCrud } from '../firestore-service.js';
import { esc, showToast, showConfirm, THB, fmtDate, halfMonthLabel, guardClick, uid } from '../utils.js';

// Period key format: "YYYY-MM-H1" (1st-15th, paid on the 16th) or
// "YYYY-MM-H2" (16th-end of month, paid on the 1st of the next month).
function defaultPeriod() {
  const d = new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${month}-${d.getDate() <= 15 ? 'H1' : 'H2'}`;
}

let currentPeriod = defaultPeriod();
let expandedEmployeeId = null;
let deductingRow = null;

function periodDisplay(period) {
  const month = period.slice(0, 7);
  const half = period.endsWith('H1') ? 1 : 2;
  const label = halfMonthLabel(month, half);
  const [y, m] = month.split('-').map(Number);
  const payDate = half === 1
    ? new Date(y, m - 1, 16)
    : new Date(y, m, 1); // 1st of the following month
  const payDateLabel = payDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${label} (จ่าย ${payDateLabel})`;
}

export function renderPayroll() {
  const el = document.getElementById('payroll');
  if (!el) return;

  const periods = availableHalfMonths();
  if (!periods.includes(currentPeriod)) currentPeriod = periods[0];

  // พนักงานที่ลาออกแล้ว (active===false) ปกติไม่ต้องโผล่ในหน้านี้อีก แต่ถ้ายังมีงวดสุดท้ายที่ยัง
  // ไม่ได้จ่าย หรือยังมียอดเบิกค้างอยู่ ต้องให้โผล่มาด้วย ไม่งั้นปิดงวดสุดท้ายให้คนที่ลาออกกลางงวด
  // ไม่ได้เลย (dropdown ที่อื่นกรองคนลาออกออกหมด หน้านี้เป็นที่เดียวที่ต้องยังจัดการเงินให้ได้)
  // พาร์ทไทม์เข้ารอบจ่ายครึ่งเดือนเหมือนพนักงานประจำแล้ว — บางวันจ่ายสดตอนเลิกงาน (กด "จ่ายสดแล้ว"
  // รายวันในแถวรายละเอียด) บางวันไม่รับ ปล่อยสะสมไว้ ยอดที่ยังไม่ได้รับทั้งงวดจะมาจ่ายรวมตรงนี้
  // แสดงเฉพาะพาร์ทไทม์ที่มีงานในงวดนี้ / จ่ายงวดนี้แล้ว / ยังมียอดเบิกค้าง — ไม่งั้นพาร์ทไทม์ที่ไม่ได้
  // มาเลยทั้งงวดจะโผล่เป็นแถว 0 บาทรกตาราง
  const periodSessionsAll = sessionsForHalfMonth(currentPeriod);
  const relevantEmployees = state.employees.filter((e) => {
    if (isParttime(e)) {
      return periodSessionsAll.some((s) => s.employeeId === e.id)
        || parttimeDailyPaidTotalInHalfMonth(e.id, currentPeriod) > 0
        || isPayrollPaid(e.id, currentPeriod)
        || outstandingBalanceBeforeMonth(e.id, '9999-99') > 0;
    }
    if (e.active !== false) return true;
    const hasCommissionThisPeriod = isTherapist(e) && commissionForEmployeeInHalfMonth(e.id, currentPeriod) > 0;
    return hasCommissionThisPeriod || outstandingBalanceBeforeMonth(e.id, '9999-99') > 0 || isPayrollPaid(e.id, currentPeriod);
  });
  const totals = {
    regular: { earned: 0, cashPaid: 0, net: 0, unpaid: 0, count: 0 },
    parttime: { earned: 0, cashPaid: 0, net: 0, unpaid: 0, count: 0 },
  };

  const rows = relevantEmployees.map((emp) => {
    const parttime = isParttime(emp);
    const therapist = isTherapist(emp);
    // พาร์ทไทม์คิดเหมือนพนักงานนวดทุกอย่าง (ค่าคอม + ประกันขั้นต่ำรายวัน) ต่างกันแค่บางวันจ่ายสด
    // ไปแล้ว ซึ่งถูกหักออกเป็น cashPaid ด้านล่าง ไม่ให้จ่ายซ้ำตอนสิ้นงวด
    const rawCommission = therapist ? commissionForEmployeeInHalfMonth(emp.id, currentPeriod) : 0;
    // emp.fixedSalary คือยอดที่จ่าย "ต่อรอบ" (ต่อครึ่งเดือน) อยู่แล้ว ไม่ใช่ยอดเต็มเดือน — ไม่ต้อง
    // หารสอง (เงินเดือนเต็มเดือน = fixedSalary x 2 รอบ)
    const base = therapist ? guaranteedEarningsForEmployeeInHalfMonth(emp.id, currentPeriod) : (Number(emp.fixedSalary) || 0);
    const guaranteeTopUp = therapist ? base - rawCommission : 0;
    const cashPaid = parttime ? parttimeDailyPaidTotalInHalfMonth(emp.id, currentPeriod) : 0;
    const balanceBefore = outstandingBalanceBeforeMonth(emp.id, currentPeriod);
    const override = deductionOverrideForMonth(emp.id, currentPeriod);
    const advance = approvedAdvanceForEmployeeInMonth(emp.id, currentPeriod);
    const balanceAfter = outstandingBalanceAfterMonth(emp.id, currentPeriod);
    const otherDeductionDefault = otherDeductionsForEmployeeInHalfMonth(emp.id, currentPeriod);
    const otherDeductionOverride = otherDeductionOverrideForMonth(emp.id, currentPeriod);
    const otherDeduction = otherDeductionOverride != null ? otherDeductionOverride : otherDeductionDefault;
    const paidRecord = state.payrollPayments.find((p) => p.id === `${currentPeriod}_${emp.id}`);
    const paid = !!paidRecord;
    // งวดที่จ่ายไปแล้ว ใช้ยอดที่บันทึก snapshot ไว้ตอนกดจ่ายจริง ไม่ใช่คำนวณสดใหม่ทุกครั้งที่เปิดหน้า
    // ไม่งั้นถ้ามีคนแก้ไขรายการนวดของงวดนั้นย้อนหลัง หรือเปลี่ยนค่าแรงขั้นต่ำซึ่งมีผลย้อนหลังทุกงวด
    // ตัวเลข "สุทธิ" ที่โชว์จะเปลี่ยนไปโดยไม่ตรงกับเงินที่จ่ายจริงไปแล้ว
    // พาร์ทไทม์: งวดที่กดจ่ายไปแล้วใช้ยอดจ่ายรายวันที่ snapshot ไว้ตอนปิดงวด เหมือนกับ netPay
    const shownCashPaid = paid && paidRecord.cashPaidDaily != null ? Number(paidRecord.cashPaidDaily) || 0 : cashPaid;
    const net = paid ? (Number(paidRecord.netPay) || 0) : (base - cashPaid - advance - otherDeduction);
    const bucket = parttime ? totals.parttime : totals.regular;
    bucket.count += 1;
    bucket.earned += base;
    bucket.cashPaid += shownCashPaid;
    bucket.net += net;
    if (!paid) bucket.unpaid += net;
    return {
      emp, parttime, therapist, base, rawCommission, guaranteeTopUp, cashPaid: shownCashPaid, balanceBefore, override, advance, balanceAfter,
      otherDeductionDefault, otherDeductionOverride, otherDeduction, net, paid,
    };
  });

  const totalNet = totals.regular.net + totals.parttime.net;
  const totalUnpaid = totals.regular.unpaid + totals.parttime.unpaid;

  // ใช้ sentinel อนาคตไกลๆ แทน currentPeriod ตรงนี้โดยเฉพาะ เพื่อเช็คว่า "ใครยังมีหนี้ค้างจริง
  // อยู่ตอนนี้" แบบไม่ขึ้นกับงวดที่เลือกดูอยู่ — เพราะถ้าเคยกดล้างไปแล้วในงวดนี้ แต่หน้าอื่น (เช่น
  // แดชบอร์ด) เทียบกับเดือนปฏิทินตรงๆ ยังเห็นว่าค้างอยู่ ปุ่มนี้ต้องยังกดซ้ำเพื่อล้างให้สนิทได้
  const anyOutstanding = state.employees.some((emp) => outstandingBalanceBeforeMonth(emp.id, '9999-99') > 0);

  el.innerHTML = `
    <div class="widget" style="padding:14px 18px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label style="font-size:.85rem;color:var(--text-dim)">ค่าแรงขั้นต่ำประกัน (บาท/วัน)</label>
        <input type="number" id="pay_minWage" class="price-input" aria-label="ค่าแรงขั้นต่ำประกัน (บาท/วัน)" style="width:90px" value="${minDailyWage()}" />
        <button class="btn small" id="pay_minWage_save">บันทึก</button>
        <span class="cell-sub">ใช้เมื่อค่าคอมวันนั้นไม่ถึง และไม่ได้มาสาย/ออกก่อนเวลา</span>
      </div>
    </div>
    <div class="widget-head" style="margin-bottom:10px">
      <select class="month-filter" id="pay_month" aria-label="เลือกงวดที่จ่ายเงินเดือน">
        ${periods.map((p) => `<option value="${p}" ${p === currentPeriod ? 'selected' : ''}>${esc(periodDisplay(p))}</option>`).join('')}
      </select>
      ${anyOutstanding ? `<button class="btn small ghost" id="pay_clear_all">ล้างยอดเบิกค้างทั้งหมด</button>` : ''}
    </div>
    <div class="summary-cards" style="margin-bottom:12px">
      <div class="summary-card"><span>ต้องจ่ายทั้งหมดงวดนี้</span><b>${THB(totalNet)}</b></div>
      <div class="summary-card"><span>ยังไม่ได้จ่าย</span><b style="color:${totalUnpaid > 0 ? 'var(--warn)' : 'var(--good)'}">${THB(totalUnpaid)}</b></div>
      <div class="summary-card"><span>พนักงานประจำ ต้องจ่าย (${totals.regular.count} คน)</span><b>${THB(totals.regular.net)}</b></div>
      <div class="summary-card"><span>พาร์ทไทม์ ได้ทั้งงวด (${totals.parttime.count} คน)</span><b>${THB(totals.parttime.earned)}</b></div>
      <div class="summary-card"><span>พาร์ทไทม์ จ่ายสดรายวันแล้ว</span><b style="color:var(--good)">${THB(totals.parttime.cashPaid)}</b></div>
      <div class="summary-card"><span>พาร์ทไทม์ ต้องจ่ายสิ้นงวด</span><b>${THB(totals.parttime.net)}</b></div>
    </div>
    ${tableHtml('พนักงานประจำ', rows.filter((r) => !r.parttime), 'ยังไม่มีพนักงานประจำในงวดนี้')}
    ${tableHtml('พาร์ทไทม์', rows.filter((r) => r.parttime), 'ไม่มีพาร์ทไทม์ที่มาทำงานในงวดนี้')}
  `;

  document.getElementById('pay_month').addEventListener('change', (e) => {
    currentPeriod = e.target.value;
    renderPayroll();
  });

  guardClick(document.getElementById('pay_minWage_save'), async () => {
    const value = Number(document.getElementById('pay_minWage').value);
    if (!value || value <= 0) { showToast('กรุณากรอกตัวเลขที่ถูกต้อง'); return; }
    await settingsCrud.save({ minDailyWage: value });
    showToast(`บันทึกค่าแรงขั้นต่ำเป็น ${THB(value)}/วัน แล้ว`);
  });

  document.getElementById('pay_clear_all')?.addEventListener('click', clearAllOutstanding);

  rows.forEach((row) => {
    const { emp } = row;
    el.querySelector(`[data-cancel-paid="${emp.id}"]`)?.addEventListener('click', () => cancelPaid(emp));
    el.querySelector(`[data-toggle-detail="${emp.id}"]`)?.addEventListener('click', () => {
      expandedEmployeeId = expandedEmployeeId === emp.id ? null : emp.id;
      renderPayroll();
    });
    el.querySelector(`[data-open-pay="${emp.id}"]`)?.addEventListener('click', () => openPayModal(row));
  });

  el.querySelectorAll('[data-day-pay]').forEach((btn) => {
    guardClick(btn, () => toggleDailyPay(btn.dataset.dayPay, btn.dataset.date, Number(btn.dataset.amount) || 0));
  });
}

// กด "จ่ายสดแล้ว" ของพาร์ทไทม์รายวัน — บันทึกยอดที่จ่ายจริงวันนั้น (ค่าคอม + ประกัน ณ ตอนกด) กดซ้ำ
// เพื่อยกเลิก (กรณีกดผิด หรือวันนั้นเปลี่ยนใจไม่รับ ให้ไปสะสมรวมจ่ายสิ้นงวดแทน)
async function toggleDailyPay(employeeId, date, amount) {
  const emp = state.employees.find((e) => e.id === employeeId);
  if (!emp) return;
  if (isPayrollPaid(employeeId, currentPeriod)) {
    showToast('งวดนี้กดจ่ายไปแล้ว ต้องยกเลิกการจ่ายงวดก่อนถึงจะแก้รายวันได้');
    return;
  }
  const id = `${date}_${employeeId}`;
  const existing = parttimeDailyPayFor(employeeId, date);
  if (existing) {
    const ok = await showConfirm(`ยกเลิก "จ่ายสดแล้ว" ของ ${emp.name} วันที่ ${fmtDate(date)} (${THB(Number(existing.amount) || 0)})? ยอดนี้จะกลับไปรวมจ่ายตอนสิ้นงวด`, true);
    if (!ok) return;
    await parttimeDailyPaysCrud.remove(id);
    showToast('ยกเลิกแล้ว ยอดวันนี้จะไปรวมจ่ายสิ้นงวด');
  } else {
    await parttimeDailyPaysCrud.save(id, {
      employeeId, employeeName: emp.name, date, amount, paidAt: new Date().toISOString(),
    });
    showToast(`บันทึกจ่ายสด ${THB(amount)} ให้ ${emp.name} แล้ว`);
  }
}

function tableHtml(title, rows, emptyText) {
  const parttime = title === 'พาร์ทไทม์';
  const cols = parttime ? 9 : 8;
  return `
    <div class="widget-head" style="margin:14px 0 8px"><h2 style="font-size:1rem">${esc(title)}</h2></div>
    <div class="table-wrap" style="margin-bottom:12px">
      <table>
        <thead><tr>
          <th>พนักงาน</th><th>ประเภท</th><th class="num">${parttime ? 'ได้ทั้งงวด' : 'ฐานเงิน'}</th>
          ${parttime ? '<th class="num">จ่ายสดรายวันแล้ว</th>' : ''}
          <th class="num">เบิกล่วงหน้า</th><th class="num">หักอื่นๆ</th><th class="num">สุทธิ</th><th>สถานะ</th><th>จัดการ</th>
        </tr></thead>
        <tbody>
          ${rows.length ? rows.map((r) => rowHtmlWithDetail(r, cols)).join('') : `<tr><td colspan="${cols}">${esc(emptyText)}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

// ใช้ครั้งเดียวตอนย้ายมาใช้งวดครึ่งเดือน กรณีหนี้เบิกล่วงหน้าที่ระบบยังนับค้างอยู่
// ถูกเคลียร์กันนอกระบบไปแล้วจริง — ตั้งยอดหักเท่ากับยอดค้างทั้งหมด ผูกกับ "งวดเสมือน"
// ที่เรียงก่อนทุกช่วงเวลาจริงเสมอ (sentinel ปี 0000) จึงมีผลกับทุกหน้า/ทุกงวดทันที
// ไม่ว่าจะเทียบกับงวดครึ่งเดือนที่หน้าเงินเดือน หรือเดือนปัจจุบันที่หน้าแดชบอร์ด —
// ใช้ "YYYY-MM" ของเดือนนี้ไม่ได้ เพราะหน้าแดชบอร์ดเทียบแบบ "น้อยกว่าเดือนนี้" (strict <)
// ถ้าตั้ง sentinel เป็นเดือนนี้พอดี จะไม่นับว่า "น้อยกว่า" ตัวเอง เลยยังโชว์ค้างอยู่เหมือนเดิม
async function clearAllOutstanding() {
  // ไม่กรองเฉพาะคนที่ยังทำงานอยู่ — คนที่ลาออกไปแล้วแต่ยังมียอดเบิกค้างในระบบ (เช่นเคลียร์กันนอก
  // ระบบไปแล้วตอนออกจากงาน) ก็ควรเคลียร์ให้หมดได้เหมือนกัน
  const toClear = state.employees
    .map((emp) => ({ emp, balance: outstandingBalanceBeforeMonth(emp.id, '9999-99') }))
    .filter((x) => x.balance > 0);
  if (!toClear.length) { showToast('ไม่มีใครมียอดเบิกค้างแล้ว'); return; }

  const ok = await showConfirm(
    `ล้างยอดเบิกค้างทั้งหมดให้เป็น 0 สำหรับ ${toClear.length} คน? ใช้เมื่อเคลียร์หนี้กันนอกระบบไปแล้ว (ประวัติการเบิกเดิมจะยังเก็บไว้ ไม่ถูกลบ)`,
    true,
  );
  if (!ok) return;

  // ใช้ id สุ่มใหม่ทุกครั้งที่กด (ไม่ใช่ doc id ตายตัวต่อพนักงานแบบเดิม) เพราะ totalDeductedExcludingMonth
  // รวมยอดจาก "ทุก doc" ที่ตรงเงื่อนไขอยู่แล้ว การเขียนทับ doc เดิมด้วยยอดคงเหลือปัจจุบันทำให้ยอดที่
  // เคยเคลียร์ไปรอบก่อนหายไป (เขียนทับ ไม่ได้บวกสะสม) กดเคลียร์ซ้ำสองครั้งหนี้เก่าจะโผล่กลับมา
  const clearPeriod = '0000-00'; // sorts before every real period/month key, everywhere
  for (const { emp, balance } of toClear) {
    await payrollDeductionsCrud.save(uid(), {
      employeeId: emp.id, employeeName: emp.name, month: clearPeriod, amount: balance,
    });
  }
  showToast(`ล้างยอดเบิกค้างให้ ${toClear.length} คนแล้ว`);
}

function rowHtmlWithDetail(row, cols) {
  const expanded = row.emp.id === expandedEmployeeId;
  return rowHtml(row, expanded) + (expanded ? detailRowHtml(row, cols) : '');
}

function rowHtml({ emp, parttime, therapist, base, rawCommission, guaranteeTopUp, cashPaid, balanceBefore, override, advance, balanceAfter, otherDeductionDefault, otherDeductionOverride, otherDeduction, net, paid }, expanded) {
  const roleLabel = parttime
    ? '<span class="pill warn">พาร์ทไทม์</span>'
    : therapist
    ? '<span class="pill neutral">พนักงานนวด</span>'
    : '<span class="pill warn">แม่บ้าน</span>';
  // Wrapped in a single <div> each — on mobile the stacked-table CSS makes
  // <td> a flex row, so multiple top-level nodes (text + several .cell-sub
  // divs) would get spread apart by justify-content instead of stacking
  // as one continuous block of text.
  const baseLabel = therapist
    ? `<div>${THB(base)}${guaranteeTopUp > 0 ? `<div class="cell-sub">ค่าคอมจริง ${THB(rawCommission)} + ประกัน ${THB(guaranteeTopUp)}</div>` : ''}</div>`
    : `<div>${THB(base)} <span class="cell-sub">(เงินเดือนตายตัว)</span></div>`;

  // เช็คที่ advance (ยอดหักจริง) ไม่ใช่ balanceBefore (ยอดหนี้ที่ระบบคำนวณได้) เพราะแอดมิน
  // อาจตั้งยอดหักเองไว้มากกว่า 0 ทั้งที่ระบบคำนวณยอดหนี้ได้ 0 (เช่น ยอดหนี้เดิมคลาดเคลื่อน) —
  // ถ้าเช็คที่ balanceBefore จะซ่อนยอดหักจริงที่กำลังใช้อยู่ไปเฉยๆ
  let advanceCell;
  if (advance <= 0 && balanceBefore <= 0) {
    advanceCell = '-';
  } else {
    advanceCell = `
      <div>
        -${THB(advance)}
        <div class="cell-sub">${override != null ? `ตั้งเองว่าหัก` : 'หักเต็มจำนวน'} · เบิกล่วงหน้ารวม ${THB(balanceBefore)}</div>
        ${balanceAfter > 0 ? `<div class="cell-sub">เหลือหนี้หลังหักงวดนี้ ${THB(balanceAfter)}</div>` : ''}
      </div>
    `;
  }

  return `
    <tr>
      <td data-label="พนักงาน" data-toggle-detail="${emp.id}" class="clickable">${expanded ? '▾' : '▸'} ${esc(emp.name)}</td>
      <td data-label="ประเภท">${roleLabel}</td>
      <td class="num" data-label="${parttime ? 'ได้ทั้งงวด' : 'ฐานเงิน'}">${baseLabel}</td>
      ${parttime ? `<td class="num" data-label="จ่ายสดรายวันแล้ว">${cashPaid > 0 ? `<div style="color:var(--good)">-${THB(cashPaid)}</div>` : '-'}</td>` : ''}
      <td class="num" data-label="เบิกล่วงหน้า">${advanceCell}</td>
      <td class="num" data-label="หักอื่นๆ">${otherDeduction > 0 ? `
        <div>
          -${THB(otherDeduction)}
          ${otherDeductionOverride != null && otherDeductionOverride !== otherDeductionDefault ? `<div class="cell-sub">ตั้งเองว่าหัก</div>` : ''}
        </div>
      ` : '-'}</td>
      <td class="num" data-label="สุทธิ"><b>${THB(net)}</b></td>
      <td data-label="สถานะ">${paid ? '<span class="pill good">จ่ายแล้ว</span>' : '<span class="pill warn">ยังไม่จ่าย</span>'}</td>
      <td data-label="จัดการ">
        ${paid
          ? `<button class="btn small" data-cancel-paid="${emp.id}">ยกเลิกการจ่าย</button>`
          : `<button class="btn small" data-open-pay="${emp.id}">จ่ายแล้ว</button>`}
      </td>
    </tr>
  `;
}

function advancePillHtml(a, deductedAmount) {
  const amount = Number(a.amount) || 0;
  const deducted = deductedAmount >= amount ? 'หักแล้ว' : deductedAmount > 0 ? `หักแล้ว ${THB(deductedAmount)}` : 'ยังไม่หัก';
  const pillClass = deductedAmount >= amount ? 'good' : deductedAmount > 0 ? 'warn' : 'neutral';
  return `<span class="pill ${pillClass}">${fmtDate(a.date)} · ${THB(amount)}${a.reason ? ' · ' + esc(a.reason) : ''} · ${deducted}</span>`;
}

function dailyPayControlHtml(emp, date, guaranteed, periodPaid) {
  const rec = parttimeDailyPayFor(emp.id, date);
  if (rec) {
    const amt = Number(rec.amount) || 0;
    const diff = guaranteed - amt;
    return `
      <span class="pill good">จ่ายสดแล้ว ${THB(amt)}</span>
      ${diff !== 0 ? `<span class="pill warn">${diff > 0 ? `ค้างเพิ่ม ${THB(diff)} รวมสิ้นงวด` : `จ่ายเกิน ${THB(-diff)} หักสิ้นงวด`}</span>` : ''}
      ${periodPaid ? '' : `<button class="btn small ghost" data-day-pay="${emp.id}" data-date="${date}">ยกเลิก</button>`}
    `;
  }
  return `
    <span class="pill neutral">สะสมจ่ายสิ้นงวด</span>
    ${periodPaid ? '' : `<button class="btn small" data-day-pay="${emp.id}" data-date="${date}" data-amount="${guaranteed}">จ่ายสดวันนี้แล้ว</button>`}
  `;
}

function detailRowHtml({ emp, parttime, therapist, paid }, cols = 8) {
  let body;
  if (therapist) {
    const days = dailyBreakdownForEmployeeInHalfMonth(emp.id, currentPeriod);
    const periodSessions = sessionsForHalfMonth(currentPeriod).filter((s) => s.employeeId === emp.id);

    const intro = parttime
      ? `<p class="cell-sub" style="margin-bottom:10px">พาร์ทไทม์: วันไหนจ่ายเงินสดตอนเลิกงานไปแล้วให้กด "จ่ายสดวันนี้แล้ว" — วันที่ไม่ได้กดจะสะสมไปจ่ายรวมตอนสิ้นงวดนี้</p>`
      : '';
    body = intro + (days.length ? days.map((d) => {
      const daySessions = periodSessions.filter((s) => s.date === d.date);
      const minWage = minDailyWage();
      const guaranteed = !d.hasIssue && d.commission < minWage ? minWage : d.commission;
      const topUp = guaranteed - d.commission;
      const flagPill = d.hasIssue
        ? '<span class="pill warn">มาสาย/ออกก่อน · ไม่ได้ค่าประกัน</span>'
        : topUp > 0 ? `<span class="pill good">ได้ค่าประกัน +${THB(topUp)}</span>` : '';
      return `
        <div style="padding:10px 0 10px 14px;border-left:2px solid var(--border);margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px">
            <b style="font-size:.85rem">${fmtDate(d.date)}</b>
            <span class="cell-sub">ค่าคอม ${THB(d.commission)} ${topUp > 0 ? `→ ${THB(guaranteed)}` : ''} ${flagPill}</span>
          </div>
          ${parttime ? `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px">${dailyPayControlHtml(emp, d.date, guaranteed, paid)}</div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${daySessions.map((s) => `<span class="pill neutral">${esc(s.serviceName)} (${s.duration} น.) · ${THB(s.commission)}</span>`).join('')}
          </div>
        </div>
      `;
    }).join('') : `<p class="cell-sub">ยังไม่มีการนวดในงวดนี้</p>`);

    // เงินสดที่จ่ายไปแล้วแต่วันนั้นไม่มีรายการนวดเหลืออยู่ (เช่นลบรายการนวดทีหลัง) ยังถูกหักจากงวดนี้
    // อยู่ เพราะเป็นเงินที่ออกจากร้านไปจริง — โชว์ไว้ให้เห็นว่ามาจากไหน จะได้ไม่งงว่ายอดหักมาจากอะไร
    if (parttime) {
      const dayDates = new Set(days.map((d) => d.date));
      const orphans = parttimeDailyPaysForEmployeeInHalfMonth(emp.id, currentPeriod).filter((p) => !dayDates.has(p.date));
      if (orphans.length) {
        body += `
          <div style="margin-top:8px">
            <b style="font-size:.85rem">จ่ายสดไปแล้วแต่ไม่มีรายการนวดวันนั้น</b>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center">
              ${orphans.map((p) => `<span class="pill warn">${fmtDate(p.date)} · ${THB(Number(p.amount) || 0)}</span>${paid ? '' : `<button class="btn small ghost" data-day-pay="${emp.id}" data-date="${p.date}">ยกเลิก</button>`}`).join('')}
            </div>
          </div>
        `;
      }
    }
  } else {
    body = `<p class="cell-sub">เงินเดือนตายตัว ไม่ผูกกับการนวด</p>`;
  }

  const approvedAdvances = advancesForEmployee(emp.id).filter((a) => a.status === 'approved');
  const deductedAmounts = advanceDeductedAmounts(emp.id);
  const advancesHtml = approvedAdvances.length ? `
    <div style="margin-top:12px">
      <b style="font-size:.85rem">ประวัติการเบิกทั้งหมด</b>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
        ${approvedAdvances.map((a) => advancePillHtml(a, deductedAmounts.get(a.id) || 0)).join('')}
      </div>
    </div>
  ` : '';

  const periodDeductions = deductionsForEmployeeInHalfMonth(emp.id, currentPeriod);
  const deductionsHtml = periodDeductions.length ? `
    <div style="margin-top:12px">
      <b style="font-size:.85rem">รายการหักเงินงวดนี้</b>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
        ${periodDeductions.map((d) => `<span class="pill bad">${fmtDate(d.date)} · ${THB(d.amount)}${d.reason ? ' · ' + esc(d.reason) : ''}</span>`).join('')}
      </div>
    </div>
  ` : '';

  return `
    <tr>
      <td colspan="${cols}" style="background:var(--surface-2);padding:16px 18px">
        <div class="drop-anim">
          ${body}
          ${advancesHtml}
          ${deductionsHtml}
        </div>
      </td>
    </tr>
  `;
}

function openPayModal(row) {
  deductingRow = row;
  const { emp, base, cashPaid, parttime, balanceBefore, advance, otherDeduction } = row;
  const approvedAdvances = advancesForEmployee(emp.id).filter((a) => a.status === 'approved');
  const deductedAmounts = advanceDeductedAmounts(emp.id);
  const periodDeductions = deductionsForEmployeeInHalfMonth(emp.id, currentPeriod);

  document.getElementById('deductModalTitle').textContent = `จ่ายเงินเดือน: ${emp.name}`;
  document.getElementById('deduct_earned').textContent = THB(base);
  document.getElementById('deduct_cashpaid_card').style.display = parttime ? '' : 'none';
  document.getElementById('deduct_cashpaid').textContent = THB(cashPaid || 0);
  document.getElementById('deduct_owed').textContent = THB(balanceBefore);
  document.getElementById('deduct_history').innerHTML = approvedAdvances.length
    ? approvedAdvances.map((a) => advancePillHtml(a, deductedAmounts.get(a.id) || 0)).join('')
    : `<span class="cell-sub">ยังไม่มีประวัติการเบิก</span>`;
  document.getElementById('deduct_amount').value = advance;

  document.getElementById('deduct_other_history').innerHTML = periodDeductions.length
    ? periodDeductions.map((d) => `<span class="pill bad">${fmtDate(d.date)} · ${THB(d.amount)}${d.reason ? ' · ' + esc(d.reason) : ''}</span>`).join('')
    : `<span class="cell-sub">ไม่มีรายการหักเงินงวดนี้</span>`;
  document.getElementById('deduct_other_amount').value = otherDeduction;

  updatePayModalNet();
  document.getElementById('deductModalBg').classList.add('open');
}

function updatePayModalNet() {
  if (!deductingRow) return;
  const advanceAmt = Number(document.getElementById('deduct_amount').value) || 0;
  const otherAmt = Number(document.getElementById('deduct_other_amount').value) || 0;
  const net = deductingRow.base - (deductingRow.cashPaid || 0) - advanceAmt - otherAmt;
  const netEl = document.getElementById('deduct_net');
  netEl.textContent = THB(net);
  netEl.style.color = net < 0 ? 'var(--bad)' : '';
}

function closeDeductModal() {
  document.getElementById('deductModalBg').classList.remove('open');
  deductingRow = null;
}

export function initDeductModal() {
  document.getElementById('deduct_cancel').addEventListener('click', closeDeductModal);
  document.getElementById('deductModalBg').addEventListener('click', (e) => {
    if (e.target.id === 'deductModalBg') closeDeductModal();
  });
  document.getElementById('deduct_amount').addEventListener('input', updatePayModalNet);
  document.getElementById('deduct_other_amount').addEventListener('input', updatePayModalNet);

  guardClick(document.getElementById('deduct_save'), async () => {
    if (!deductingRow) return;
    const { emp, base, parttime } = deductingRow;
    const cashPaid = deductingRow.cashPaid || 0;
    // ไม่ล็อกเพดานไว้ที่ยอดเบิกค้าง (balanceBefore) อีกต่อไป เพราะถ้าตัวเลขนั้นคลาดเคลื่อน
    // (เช่น มีรายการ "เคลียร์ยอด" เก่าตกค้างอยู่) ผู้ใช้จะพิมพ์แก้เองไม่ได้เลยเพราะถูกบังคับ
    // ปัดกลับเป็นค่าเดิมทุกครั้งที่กดยืนยัน — ให้ผู้ใช้ตัดสินใจเองแทนที่จะเชื่อเลขนี้เป๊ะๆ
    const advanceAmount = Math.max(0, Number(document.getElementById('deduct_amount').value) || 0);
    const otherAmount = Math.max(0, Number(document.getElementById('deduct_other_amount').value) || 0);
    const net = base - cashPaid - advanceAmount - otherAmount;

    if (net < 0) {
      const ok = await showConfirm(`สุทธิที่จะจ่ายติดลบ (${THB(net)}) ยืนยันว่าจะหักเท่านี้จริงหรือไม่?`, true);
      if (!ok) return;
    }

    await payrollDeductionsCrud.save(`${currentPeriod}_${emp.id}`, {
      employeeId: emp.id, employeeName: emp.name, month: currentPeriod,
      amount: advanceAmount, otherDeductionOverride: otherAmount,
    });
    await payrollCrud.save(`${currentPeriod}_${emp.id}`, {
      employeeId: emp.id, employeeName: emp.name,
      period: currentPeriod, month: currentPeriod.slice(0, 7),
      // grossCost = เงินสดจริงที่ร้านจ่ายออกทั้งงวด (netPay ที่จ่ายตอนนี้ + เบิกล่วงหน้าที่จ่ายไปก่อน
      // หน้าแล้วมาหักคืนตรงนี้) ใช้คำนวณต้นทุนแรงงานในใบสรุปรายได้ ไม่ให้ยอดเบิกหายไปจากบัญชี
      // พาร์ทไทม์: grossCost รวมเงินสดรายวันที่จ่ายไปแล้วด้วย (ต้นทุนจริงทั้งงวด) ส่วน cashPaidDaily เก็บ
      // snapshot ไว้ให้งวดที่ปิดแล้วแสดงยอดเดิมได้แม้มีคนไปแก้รายการรายวันทีหลัง
      netPay: net, grossCost: base - otherAmount, paidAt: new Date().toISOString(),
      ...(parttime ? { cashPaidDaily: cashPaid, role: 'parttime' } : {}),
    });
    closeDeductModal();
    renderPayroll();
    showToast(`บันทึกการจ่ายเงิน ${THB(net)} แล้ว`);
  });
}

const cancellingIds = new Set();
async function cancelPaid(emp) {
  if (cancellingIds.has(emp.id)) return;
  cancellingIds.add(emp.id);
  try {
    // ต้องลบ payrollDeductions ของงวดนี้ไปด้วย ไม่ใช่ลบแค่ payroll — ไม่งั้นระบบยังนับว่าหักเบิก/
    // หักเงินอื่นๆ ไปแล้วเท่าที่ตั้งไว้ตอนกดจ่าย ทั้งที่ยกเลิกการจ่ายไปแล้ว ยอดหนี้เบิกของพนักงาน
    // จะหายไปเท่ากับยอดที่เคยหักโดยไม่มีอะไรจ่ายจริง
    const ok = await showConfirm(
      `ยกเลิกการจ่ายเงินเดือนของ "${emp.name}" งวดนี้? ยอดเบิก/หักที่ตั้งไว้สำหรับงวดนี้จะถูกล้างกลับเป็นค่าเริ่มต้นด้วย (ยอดเบิกค้างจะกลับมาเหมือนยังไม่ได้จ่าย)`,
      true,
    );
    if (!ok) return;
    await payrollCrud.remove(`${currentPeriod}_${emp.id}`);
    await payrollDeductionsCrud.remove(`${currentPeriod}_${emp.id}`);
    renderPayroll();
    showToast('ยกเลิกการจ่ายแล้ว');
  } finally {
    cancellingIds.delete(emp.id);
  }
}
