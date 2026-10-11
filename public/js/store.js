import { MIN_DAILY_WAGE, DURATIONS } from './constants.js';

export const state = {
  services: [],
  employees: [],
  sessions: [],
  advances: [],
  payrollPayments: [],
  payrollDeductions: [],
  leaves: [],
  expenses: [],
  packages: [],
  packageTemplates: [],
  deductions: [],
  settings: { minDailyWage: MIN_DAILY_WAGE, durations: DURATIONS },
};

export function minDailyWage() {
  return Number(state.settings.minDailyWage) || MIN_DAILY_WAGE;
}

export function durations() {
  const list = Array.isArray(state.settings.durations) && state.settings.durations.length
    ? state.settings.durations
    : DURATIONS;
  return [...list].map(Number).sort((a, b) => a - b);
}

export const authState = { email: null };

export function employeeById(id) {
  return state.employees.find((e) => e.id === id);
}

export function isTherapist(emp) {
  return emp.role !== 'housekeeper';
}

export function serviceById(id) {
  return state.services.find((s) => s.id === id);
}

export function sessionsForMonth(month) {
  return state.sessions.filter((s) => (s.date || '').slice(0, 7) === month);
}

export function sessionsForDay(date) {
  return state.sessions.filter((s) => s.date === date);
}

export function sessionsForYear(year) {
  return state.sessions.filter((s) => (s.date || '').slice(0, 4) === year);
}

export function advancesForMonth(month) {
  return state.advances.filter((a) => (a.date || '').slice(0, 7) === month);
}

export function advancesForDay(date) {
  return state.advances.filter((a) => a.date === date);
}

export function advancesForYear(year) {
  return state.advances.filter((a) => (a.date || '').slice(0, 4) === year);
}

export function expensesForDay(date) {
  return state.expenses.filter((e) => e.date === date);
}

export function expensesForMonth(month) {
  return state.expenses.filter((e) => (e.date || '').slice(0, 7) === month);
}

export function packagesForDay(date) {
  return state.packages.filter((p) => p.purchaseDate === date);
}

export function packagesForMonth(month) {
  return state.packages.filter((p) => (p.purchaseDate || '').slice(0, 7) === month);
}

export function packagesForYear(year) {
  return state.packages.filter((p) => (p.purchaseDate || '').slice(0, 4) === year);
}

export function expensesForYear(year) {
  return state.expenses.filter((e) => (e.date || '').slice(0, 4) === year);
}

export function commissionForEmployeeInMonth(employeeId, month) {
  return sessionsForMonth(month)
    .filter((s) => s.employeeId === employeeId)
    .reduce((sum, s) => sum + (Number(s.commission) || 0), 0);
}

function dailyBreakdown(sessions) {
  const byDate = new Map();
  for (const s of sessions) {
    if (!byDate.has(s.date)) byDate.set(s.date, { date: s.date, commission: 0, hasIssue: false });
    const d = byDate.get(s.date);
    d.commission += Number(s.commission) || 0;
    if (s.late || s.leftEarly) d.hasIssue = true;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function dailyBreakdownForEmployeeInMonth(employeeId, month) {
  return dailyBreakdown(sessionsForMonth(month).filter((s) => s.employeeId === employeeId));
}

// Generic version of the minimum-wage top-up rule: given any list of a
// therapist's sessions (a day, a half-month, a whole year — any range),
// bucket them by day and apply the per-day guarantee. Lets callers scope
// "guaranteed earnings" to whatever period they're displaying, not just
// a calendar month.
export function guaranteedEarningsForSessions(sessions) {
  const minWage = minDailyWage();
  return dailyBreakdown(sessions).reduce((sum, d) => {
    const guaranteed = !d.hasIssue && d.commission < minWage ? minWage : d.commission;
    return sum + guaranteed;
  }, 0);
}

export function guaranteedEarningsForEmployeeInMonth(employeeId, month) {
  return guaranteedEarningsForSessions(sessionsForMonth(month).filter((s) => s.employeeId === employeeId));
}

// เหมือน guaranteedEarningsForSessions แต่รับ sessions ของหลายพนักงานปนกันได้ (จัดกลุ่มตาม
// employeeId ก่อน แล้วค่อยแบ่งเป็นรายวันในแต่ละคน) ไม่งั้นค่าคอมของคนละคนในวันเดียวกันจะถูกนับ
// รวมเป็นก้อนเดียว ทำให้เพดานค่าแรงขั้นต่ำต่อวัน-ต่อคนเพี้ยน ใช้ตอนสรุปต้นทุนรวมทั้งร้าน
export function guaranteedEarningsForMixedSessions(sessions) {
  const byEmployee = new Map();
  for (const s of sessions) {
    if (!byEmployee.has(s.employeeId)) byEmployee.set(s.employeeId, []);
    byEmployee.get(s.employeeId).push(s);
  }
  let total = 0;
  for (const empSessions of byEmployee.values()) total += guaranteedEarningsForSessions(empSessions);
  return total;
}

// Half-month pay periods: key format "YYYY-MM-H1" (1st-15th) or "YYYY-MM-H2"
// (16th-end of month). Deliberately sorts correctly as a plain string against
// both other half-month keys and legacy plain "YYYY-MM" month keys (a prefix
// always sorts before a longer string that starts with it), so the existing
// month-keyed ledger functions (outstandingBalanceBeforeMonth etc.) work
// unchanged when a half-month key is passed in as the "month" parameter.
function isDateInHalfMonthPeriod(dateStr, period) {
  if (!dateStr || !period) return false;
  if (dateStr.slice(0, 7) !== period.slice(0, 7)) return false;
  const day = Number(dateStr.slice(8, 10));
  return period.endsWith('H1') ? day <= 15 : day > 15;
}

export function sessionsForHalfMonth(period) {
  return state.sessions.filter((s) => isDateInHalfMonthPeriod(s.date, period));
}

export function advancesForHalfMonth(period) {
  return state.advances.filter((a) => isDateInHalfMonthPeriod(a.date, period));
}

export function expensesForHalfMonth(period) {
  return state.expenses.filter((e) => isDateInHalfMonthPeriod(e.date, period));
}

export function packagesForHalfMonth(period) {
  return state.packages.filter((p) => isDateInHalfMonthPeriod(p.purchaseDate, period));
}

export function deductionsForEmployee(employeeId) {
  return state.deductions
    .filter((d) => d.employeeId === employeeId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// หักเงินเคสต่างๆ (ค่าปรับ/ค่าเสียหาย ฯลฯ) ต่างจากเบิกล่วงหน้า เพราะเป็นเงินที่ไม่เคยให้
// พนักงานไปก่อนเลย ไม่ใช่การจ่ายคืนเงินที่เบิกไปแล้ว — หักออกจากเงินเดือนงวดนั้นตรงๆ
export function deductionsForEmployeeInHalfMonth(employeeId, period) {
  return state.deductions.filter((d) => d.employeeId === employeeId && isDateInHalfMonthPeriod(d.date, period));
}

export function otherDeductionsForEmployeeInHalfMonth(employeeId, period) {
  return deductionsForEmployeeInHalfMonth(employeeId, period)
    .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
}

export function commissionForEmployeeInHalfMonth(employeeId, period) {
  return sessionsForHalfMonth(period)
    .filter((s) => s.employeeId === employeeId)
    .reduce((sum, s) => sum + (Number(s.commission) || 0), 0);
}

export function dailyBreakdownForEmployeeInHalfMonth(employeeId, period) {
  return dailyBreakdown(sessionsForHalfMonth(period).filter((s) => s.employeeId === employeeId));
}

export function guaranteedEarningsForEmployeeInHalfMonth(employeeId, period) {
  return guaranteedEarningsForSessions(sessionsForHalfMonth(period).filter((s) => s.employeeId === employeeId));
}

export function availableHalfMonths() {
  const periods = [];
  availableMonths().forEach((m) => { periods.push(`${m}-H2`); periods.push(`${m}-H1`); });
  return periods;
}

export function allMonthsForEmployee(employeeId) {
  const set = new Set();
  state.sessions.forEach((s) => { if (s.employeeId === employeeId && s.date) set.add(s.date.slice(0, 7)); });
  return Array.from(set);
}

export function guaranteedEarningsTotalForEmployee(employeeId) {
  return allMonthsForEmployee(employeeId)
    .reduce((sum, m) => sum + guaranteedEarningsForEmployeeInMonth(employeeId, m), 0);
}

// All advances share one running balance per employee: everything approved
// is owed, and each month's payroll deducts a chosen amount from it (full
// balance by default, or a smaller amount the admin picks on the Payroll
// page). Nothing is scheduled in advance — the admin decides month to month.
export function totalApprovedAdvanceEver(employeeId) {
  return state.advances
    .filter((a) => a.employeeId === employeeId && a.status === 'approved')
    .reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
}

// วันสุดท้ายของงวด ใช้กันไม่ให้เบิกที่ลงวันที่ "ในอนาคต" เทียบกับงวดที่กำลังดู ถูกนับว่าเป็นหนี้
// ไปแล้ว (เช่น เบิกวันที่ 20 มิ.ย. ไม่ควรถูกหักในงวด 1-15 พ.ค. ที่ผ่านไปก่อนเบิกจะเกิดขึ้นจริง)
function periodEndDate(month) {
  if (month === '9999-99') return '9999-12-31'; // sentinel: "ไม่จำกัดอนาคต" ใช้ตอนขอยอดค้างจริงปัจจุบัน
  if (month === '0000-00') return '0000-01-01'; // sentinel: ใช้เป็น label ของรายการ "เคลียร์ยอด" เท่านั้น ไม่ใช้เทียบวันที่
  const base = month.slice(0, 7);
  const [y, m] = base.split('-').map(Number);
  if (month.endsWith('-H1')) return `${base}-15`;
  const lastDay = new Date(y, m, 0).getDate(); // รองรับทั้ง "YYYY-MM-H2" และ "YYYY-MM" รุ่นเก่า
  return `${base}-${String(lastDay).padStart(2, '0')}`;
}

function totalApprovedAdvanceUpToMonth(employeeId, month) {
  const endDate = periodEndDate(month);
  return state.advances
    .filter((a) => a.employeeId === employeeId && a.status === 'approved' && (a.date || '') <= endDate)
    .reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
}

// ไม่ใช้ "เดือนก่อนหน้า" (d.month < month) แบบเดิมแล้ว เพราะถ้าแอดมินจ่ายงวดไม่เรียงลำดับ (เช่น
// จ่าย H2 ก่อน แล้วย้อนมาจ่าย H1) งวด H1 จะมองไม่เห็นยอดที่ถูกหักไปแล้วในงวด H2 (เพราะ H2 "มาหลัง"
// H1 ตามชื่องวด) ทำให้หักเบิกซ้ำสองรอบ เปลี่ยนเป็น "ทุกงวดอื่นที่ไม่ใช่งวดนี้" แทน ซึ่งถูกต้องไม่ว่า
// จะจ่ายตามลำดับเวลาจริงหรือไม่
function totalDeductedExcludingMonth(employeeId, month) {
  return state.payrollDeductions
    .filter((d) => d.employeeId === employeeId && d.month !== month)
    .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
}

export function outstandingBalanceBeforeMonth(employeeId, month) {
  return Math.max(0, totalApprovedAdvanceUpToMonth(employeeId, month) - totalDeductedExcludingMonth(employeeId, month));
}

export function deductionOverrideForMonth(employeeId, month) {
  const rec = state.payrollDeductions.find((d) => d.employeeId === employeeId && d.month === month);
  return rec ? Number(rec.amount) || 0 : null;
}

export function approvedAdvanceForEmployeeInMonth(employeeId, month) {
  const balanceBefore = outstandingBalanceBeforeMonth(employeeId, month);
  const override = deductionOverrideForMonth(employeeId, month);
  if (override == null) return balanceBefore; // default: deduct everything still owed
  // ไม่ล็อกเพดานไว้ที่ balanceBefore อีกต่อไป — ถ้าแอดมินตั้งยอดหักเองไว้แล้ว ให้เชื่อตัวเลขนั้น
  // แม้ยอดหนี้ที่ระบบคำนวณได้จะดูคลาดเคลื่อน (เช่น มีรายการ "เคลียร์ยอด" เก่าตกค้างอยู่)
  return Math.max(0, override);
}

// เก็บไว้ในเอกสารเดียวกับ advance override (คนละ field) เพื่อให้ "หักเท่าไรงวดนี้" ของทั้ง
// เบิกล่วงหน้าและหักเงินเคสอื่นๆ ปรับได้จากหน้าเงินเดือนที่เดียวกันตอนกดจ่ายเงิน
export function otherDeductionOverrideForMonth(employeeId, month) {
  const rec = state.payrollDeductions.find((d) => d.employeeId === employeeId && d.month === month);
  return rec && rec.otherDeductionOverride != null ? Number(rec.otherDeductionOverride) : null;
}

export function outstandingBalanceAfterMonth(employeeId, month) {
  return Math.max(0, outstandingBalanceBeforeMonth(employeeId, month) - approvedAdvanceForEmployeeInMonth(employeeId, month));
}

export function advancesForEmployee(employeeId) {
  return state.advances
    .filter((a) => a.employeeId === employeeId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export function approvedAdvanceTotalForEmployee(employeeId) {
  return state.advances
    .filter((a) => a.employeeId === employeeId && a.status === 'approved')
    .reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
}

export function isPayrollPaid(employeeId, month) {
  return state.payrollPayments.some((p) => p.id === `${month}_${employeeId}`);
}

export function leavesForEmployee(employeeId) {
  return state.leaves
    .filter((l) => l.employeeId === employeeId)
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
}

export function leavesOnDate(dateISO) {
  return state.leaves.filter((l) => l.status !== 'rejected' && l.startDate <= dateISO && l.endDate >= dateISO);
}

export function upcomingLeaves(todayISO) {
  return state.leaves
    .filter((l) => l.status !== 'rejected' && l.startDate > todayISO)
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}

export function countLeaveDays(leave) {
  const start = new Date(leave.startDate);
  const end = new Date(leave.endDate);
  return Math.round((end - start) / 86400000) + 1;
}

function localDateParts() {
  const d = new Date();
  return { year: String(d.getFullYear()), month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
}

export function availableMonths() {
  const set = new Set();
  state.sessions.forEach((s) => s.date && set.add(s.date.slice(0, 7)));
  state.advances.forEach((a) => a.date && set.add(a.date.slice(0, 7)));
  state.leaves.forEach((l) => l.startDate && set.add(l.startDate.slice(0, 7)));
  state.expenses.forEach((e) => e.date && set.add(e.date.slice(0, 7)));
  state.packages.forEach((p) => p.purchaseDate && set.add(p.purchaseDate.slice(0, 7)));
  state.deductions.forEach((d) => d.date && set.add(d.date.slice(0, 7)));
  set.add(localDateParts().month);
  return Array.from(set).sort().reverse();
}

export function revenueForMonth(month) {
  const sessionRevenue = sessionsForMonth(month).reduce((sum, s) => sum + (Number(s.customerPrice) || 0) - (Number(s.discount) || 0), 0);
  const packageRevenue = packagesForMonth(month).reduce((sum, p) => sum + (Number(p.price) || 0), 0);
  return sessionRevenue + packageRevenue;
}

export function expenseTotalForMonth(month) {
  return expensesForMonth(month).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

// ต้นทุนพนักงานแบบ "เกิดขึ้นจริงในเดือนนั้น" (accrual) — ใช้สูตรเดียวกับที่หน้าภาพรวมคิด (ค่าคอม
// ของ session ในเดือนนั้น รวมเงินประกันขั้นต่ำที่ร้านเติมให้จริง + เงินเดือนแม่บ้าน) ไม่ใช่แค่ยอด
// ที่กดจ่ายจริงผ่านหน้าเงินเดือน เพราะถ้าใช้ยอดจ่ายจริงอย่างเดียว งวดที่ยังไม่กดจ่ายจะไม่ถูกนับเป็น
// ต้นทุนเลย ทำให้ใบสรุปรายได้กับหน้าภาพรวมแสดงตัวเลขไม่ตรงกัน พนักงานพาร์ทไทม์ไม่มีงวดจ่ายแยกของ
// ตัวเอง (จ่ายสดรายวัน) แต่ค่าคอมของเขาก็อยู่ใน session เหมือนพนักงานประจำ จึงถูกรวมมาด้วยโดยอัตโนมัติ
// ค่าคอมของ session คงที่ตลอดกาลอยู่แล้ว (บันทึกค่าไว้ ณ ตอนนวดจริง ไม่เปลี่ยนตามราคาปัจจุบัน) แต่
// เงินเดือนแม่บ้านไม่มีอะไรแบบนั้นผูกไว้ — ถ้าใช้เงินเดือนปัจจุบันของพนักงานที่ยังทำงานอยู่ตอนนี้มา
// คิดย้อนหลังทุกเดือน เดือนเก่าๆ จะเพี้ยนทันทีที่แม่บ้านลาออกหรือปรับเงินเดือน (ตัวเลขในใบสรุปที่
// เคยถูกต้องจะเปลี่ยนไปเองโดยไม่มีใครแก้อะไร) จึงต้องเช็กก่อนว่างวดนั้นๆ ของแม่บ้านคนนั้น "จ่ายจริง
// แล้วหรือยัง" ถ้าจ่ายแล้วใช้ยอดที่บันทึก snapshot ไว้ตอนจ่าย (แม่นยำ ไม่เปลี่ยนตามปัจจุบัน) ถ้ายัง
// ไม่จ่าย (เช่นงวดปัจจุบัน) ค่อย fallback มาประมาณจากเงินเดือนตายตัวปัจจุบันไปก่อน
export function laborCostForMonth(month) {
  const commission = guaranteedEarningsForMixedSessions(sessionsForMonth(month));
  const housekeepers = state.employees.filter((e) => e.role === 'housekeeper');
  const housekeeperCost = housekeepers.reduce((sum, e) => {
    return ['H1', 'H2'].reduce((roundSum, half) => {
      const paidRecord = state.payrollPayments.find((p) => p.id === `${month}-${half}_${e.id}`);
      const roundCost = paidRecord ? (Number(paidRecord.grossCost ?? paidRecord.netPay) || 0) : (Number(e.fixedSalary) || 0);
      return roundSum + roundCost;
    }, sum);
  }, 0);
  return commission + housekeeperCost;
}

export function availableYears() {
  const set = new Set();
  state.sessions.forEach((s) => s.date && set.add(s.date.slice(0, 4)));
  state.advances.forEach((a) => a.date && set.add(a.date.slice(0, 4)));
  state.leaves.forEach((l) => l.startDate && set.add(l.startDate.slice(0, 4)));
  state.expenses.forEach((e) => e.date && set.add(e.date.slice(0, 4)));
  state.packages.forEach((p) => p.purchaseDate && set.add(p.purchaseDate.slice(0, 4)));
  state.deductions.forEach((d) => d.date && set.add(d.date.slice(0, 4)));
  set.add(localDateParts().year);
  return Array.from(set).sort().reverse();
}
