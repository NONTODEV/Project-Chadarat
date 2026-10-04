import {
  revenueForMonth, paidPayrollForMonth, expenseTotalForMonth,
  availableMonths, availableYears,
} from '../store.js';
import { THB, esc } from '../utils.js';

let periodType = 'monthly'; // monthly | half-year | yearly
let selectedMonth = null;
let selectedYear = null;
let selectedHalf = 'h1'; // h1 = ม.ค.-มิ.ย., h2 = ก.ค.-ธ.ค.

function monthLabel(m) {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

function monthsInYearHalf(year, half) {
  const start = half === 'h1' ? 1 : 7;
  const end = half === 'h1' ? 6 : 12;
  const months = [];
  for (let m = start; m <= end; m++) months.push(`${year}-${String(m).padStart(2, '0')}`);
  return months;
}

function monthsInYear(year) {
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(`${year}-${String(m).padStart(2, '0')}`);
  return months;
}

function buildStatement(months) {
  let revenue = 0, payroll = 0, expense = 0;
  const rows = months.map((m) => {
    const rev = revenueForMonth(m);
    const pay = paidPayrollForMonth(m);
    const exp = expenseTotalForMonth(m);
    revenue += rev; payroll += pay; expense += exp;
    return { month: m, revenue: rev, payroll: pay, expense: exp, net: rev - pay - exp };
  });
  return { rows, totals: { revenue, payroll, expense, net: revenue - payroll - expense } };
}

function periodTitle(months) {
  if (months.length === 1) return monthLabel(months[0]);
  return `${monthLabel(months[0])} - ${monthLabel(months[months.length - 1])}`;
}

export function renderStatement() {
  const el = document.getElementById('statement');
  if (!el) return;

  const months = availableMonths();
  const years = availableYears();
  if (!selectedMonth || !months.includes(selectedMonth)) selectedMonth = months[0];
  if (!selectedYear || !years.includes(selectedYear)) selectedYear = years[0];

  let targetMonths;
  if (periodType === 'half-year') targetMonths = monthsInYearHalf(selectedYear, selectedHalf);
  else if (periodType === 'yearly') targetMonths = monthsInYear(selectedYear);
  else targetMonths = [selectedMonth];

  const { rows, totals } = buildStatement(targetMonths);
  const avgNet = totals.net / targetMonths.length;
  const generatedAt = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

  el.innerHTML = `
    <div class="widget-head" style="margin-bottom:10px">
      <div class="seg-toggle">
        <button data-stmt-period="monthly" class="${periodType === 'monthly' ? 'active' : ''}">รายเดือน</button>
        <button data-stmt-period="half-year" class="${periodType === 'half-year' ? 'active' : ''}">ราย 6 เดือน</button>
        <button data-stmt-period="yearly" class="${periodType === 'yearly' ? 'active' : ''}">รายปี</button>
      </div>
      ${periodType === 'monthly' ? `
        <select class="month-filter" id="stmt_month" aria-label="เลือกเดือน">
          ${months.map((m) => `<option value="${m}" ${m === selectedMonth ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}
        </select>
      ` : ''}
      ${periodType === 'half-year' ? `
        <select class="month-filter" id="stmt_year" aria-label="เลือกปี">
          ${years.map((y) => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>ปี ${y}</option>`).join('')}
        </select>
        <select class="month-filter" id="stmt_half" aria-label="เลือกครึ่งปี">
          <option value="h1" ${selectedHalf === 'h1' ? 'selected' : ''}>ม.ค. - มิ.ย.</option>
          <option value="h2" ${selectedHalf === 'h2' ? 'selected' : ''}>ก.ค. - ธ.ค.</option>
        </select>
      ` : ''}
      ${periodType === 'yearly' ? `
        <select class="month-filter" id="stmt_year_only" aria-label="เลือกปี">
          ${years.map((y) => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>ปี ${y}</option>`).join('')}
        </select>
      ` : ''}
      <button class="btn primary" id="stmt_print">ดาวน์โหลด PDF</button>
    </div>

    <div id="stmt_print_area" class="widget">
      <div style="text-align:center;margin-bottom:18px">
        <h2 style="margin:0 0 4px">ชฎารัตน์ นวดเพื่อสุขภาพ อุบลราชธานี</h2>
        <div class="cell-sub">Chadarat Thaimassage Ubonratchathani</div>
        <div class="cell-sub">สรุปรายได้-รายจ่ายกิจการ</div>
        <div class="cell-sub">ช่วง ${esc(periodTitle(targetMonths))}</div>
      </div>

      <div class="summary-cards" style="margin-bottom:16px">
        <div class="summary-card"><span>รายได้รวม</span><b>${THB(totals.revenue)}</b></div>
        <div class="summary-card"><span>ต้นทุนพนักงานรวม</span><b>${THB(totals.payroll)}</b></div>
        <div class="summary-card"><span>รายจ่ายอื่นๆ รวม</span><b>${THB(totals.expense)}</b></div>
        <div class="summary-card"><span>กำไรสุทธิรวม</span><b style="color:${totals.net < 0 ? 'var(--bad)' : 'var(--good)'}">${THB(totals.net)}</b></div>
        ${targetMonths.length > 1 ? `<div class="summary-card"><span>กำไรเฉลี่ย/เดือน</span><b>${THB(avgNet)}</b></div>` : ''}
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>เดือน</th><th class="num">รายได้</th><th class="num">ต้นทุนพนักงาน</th><th class="num">รายจ่ายอื่นๆ</th><th class="num">กำไรสุทธิ</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td data-label="เดือน">${esc(monthLabel(r.month))}</td>
                <td class="num" data-label="รายได้">${THB(r.revenue)}</td>
                <td class="num" data-label="ต้นทุนพนักงาน">${THB(r.payroll)}</td>
                <td class="num" data-label="รายจ่ายอื่นๆ">${THB(r.expense)}</td>
                <td class="num" data-label="กำไรสุทธิ" style="color:${r.net < 0 ? 'var(--bad)' : 'var(--good)'}">${THB(r.net)}</td>
              </tr>
            `).join('')}
            <tr style="font-weight:700">
              <td data-label="รวม">รวม</td>
              <td class="num" data-label="รายได้">${THB(totals.revenue)}</td>
              <td class="num" data-label="ต้นทุนพนักงาน">${THB(totals.payroll)}</td>
              <td class="num" data-label="รายจ่ายอื่นๆ">${THB(totals.expense)}</td>
              <td class="num" data-label="กำไรสุทธิ">${THB(totals.net)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="margin-top:28px;font-size:.8rem;color:var(--text-dim)">
        จัดทำจากข้อมูลภายในระบบจัดการร้าน ณ วันที่ ${generatedAt}
      </div>

      <div style="margin-top:50px;display:flex;justify-content:flex-end">
        <div style="text-align:center;font-size:.85rem">
          <div>ลงชื่อ ....................................................</div>
          <div style="margin-top:6px">( .................................................... )</div>
          <div style="margin-top:6px">เจ้าของกิจการ</div>
        </div>
      </div>
    </div>
  `;

  el.querySelectorAll('[data-stmt-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      periodType = btn.dataset.stmtPeriod;
      renderStatement();
    });
  });
  document.getElementById('stmt_month')?.addEventListener('change', (e) => {
    selectedMonth = e.target.value;
    renderStatement();
  });
  document.getElementById('stmt_year')?.addEventListener('change', (e) => {
    selectedYear = e.target.value;
    renderStatement();
  });
  document.getElementById('stmt_half')?.addEventListener('change', (e) => {
    selectedHalf = e.target.value;
    renderStatement();
  });
  document.getElementById('stmt_year_only')?.addEventListener('change', (e) => {
    selectedYear = e.target.value;
    renderStatement();
  });
  document.getElementById('stmt_print').addEventListener('click', () => {
    // Chrome's print header/footer shows document.title — swap it to the
    // shop name for the print only, so "แดชบอร์ด - ..." doesn't appear on the PDF.
    const originalTitle = document.title;
    document.title = 'ชฎารัตน์ นวดเพื่อสุขภาพ อุบลราชธานี';
    window.addEventListener('afterprint', function restoreTitle() {
      document.title = originalTitle;
      window.removeEventListener('afterprint', restoreTitle);
    });
    window.print();
  });
}
