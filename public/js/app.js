import { initLogout } from './auth-guard.js';
import { initCloudSync } from './firestore-service.js';
import { authState } from './store.js';
import { initThemeToggle } from './theme.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderServices, initServiceModal } from './ui/services.js';
import { renderExpenses, initExpenseModal } from './ui/expenses.js';
import { renderEmployees, initEmployeeModal } from './ui/employees.js';
import { renderSessions, initSessionModal } from './ui/sessions.js';
import { renderAdvances, initAdvanceModal } from './ui/advances.js';
import { renderPayroll, initDeductModal } from './ui/payroll.js';
import { renderLeaves, initLeaveModal } from './ui/leaves.js';
import { renderStatement } from './ui/statement.js';
import { renderPackages, initPackageModal, initPackageTemplateModal } from './ui/packages.js';
import { renderDeductions, initDeductionsModal } from './ui/deductions.js';

const TAB_META = {
  dashboard: 'ภาพรวม',
  services: 'จัดการราคานวด',
  expenses: 'รายจ่าย',
  employees: 'พนักงาน',
  sessions: 'บันทึกการนวด',
  advances: 'เบิกเงินล่วงหน้า',
  payroll: 'เงินเดือน',
  leaves: 'การลา',
  statement: 'ใบสรุปรายได้',
  packages: 'แพ็กเกจ',
  deductions: 'หักเงินพนักงาน',
};

const TAB_GROUP = {
  dashboard: 'overview', services: 'overview', expenses: 'overview',
  employees: 'staff', sessions: 'staff', advances: 'staff', leaves: 'staff', payroll: 'staff', deductions: 'staff',
  statement: 'overview', packages: 'overview',
};

const RENDERERS = {
  dashboard: renderDashboard,
  services: renderServices,
  expenses: renderExpenses,
  employees: renderEmployees,
  sessions: renderSessions,
  advances: renderAdvances,
  payroll: renderPayroll,
  leaves: renderLeaves,
  statement: renderStatement,
  packages: renderPackages,
  deductions: renderDeductions,
};

// Rendering all 8 tabs synchronously on load (most of them invisible) is a
// long main-thread task that mobile CPU throttling punishes heavily. Instead,
// render a tab only once it's actually been viewed, and on every data change
// re-render just the tabs already viewed so they stay live.
const renderedTabs = new Set();

function renderTab(tab) {
  RENDERERS[tab]?.();
  renderedTabs.add(tab);
}

// onSnapshot ยิง re-render ทั้งแท็บได้ทุกเมื่อที่มีใคร (เครื่องอื่น/แท็บอื่น) เขียนข้อมูลเข้ามา
// ไม่ใช่แค่ตอนโหลดครั้งแรก ถ้ากำลังพิมพ์อยู่ในช่องค้นหา (ซึ่งอยู่ใน innerHTML ที่ถูกเขียนทับใหม่
// หมดทุกครั้ง) จะเสีย focus ไปเฉยๆ ระหว่างพิมพ์ — จำ element/cursor ที่โฟกัสอยู่ไว้ก่อน แล้วค่อย
// คืน focus ให้ element เดิม (ที่ถูกสร้างขึ้นใหม่) หลัง render เสร็จ
function renderVisitedTabs() {
  if (renderedTabs.size === 0) { renderTab('dashboard'); return; }
  const active = document.activeElement;
  const focusId = active?.tagName === 'INPUT' && active.id ? active.id : null;
  const cursor = focusId ? active.selectionStart : null;
  renderedTabs.forEach((tab) => RENDERERS[tab]());
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (cursor != null && typeof el.setSelectionRange === 'function') el.setSelectionRange(cursor, cursor);
    }
  }
}

function switchTab(tab) {
  document.querySelectorAll('#rail button[data-tab]').forEach((b) =>
    b.classList.toggle('active', b.getAttribute('data-tab') === tab));
  document.querySelectorAll('.wrap > section').forEach((s) =>
    s.classList.toggle('active', s.id === tab));
  document.getElementById('pageTitle').textContent = TAB_META[tab] || '';

  const activeGroup = TAB_GROUP[tab];
  document.querySelectorAll('.rail-submenu').forEach((sm) =>
    sm.classList.toggle('open', sm.dataset.submenu === activeGroup));
  document.querySelectorAll('.rail-group-head').forEach((head) =>
    head.classList.toggle('open', head.closest('.rail-group').dataset.group === activeGroup));

  if (!renderedTabs.has(tab)) renderTab(tab);
}
window.__switchTab = switchTab;

function initNav() {
  document.querySelectorAll('#rail button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });
  const fromHash = window.location.hash.replace('#', '');
  switchTab(TAB_META[fromHash] ? fromHash : 'dashboard');
  // Hash is a one-time instruction for which tab to land on (e.g. coming
  // back from employee.html) — clear it so a later page refresh defaults
  // back to the dashboard tab instead of re-opening this one.
  if (fromHash) history.replaceState(null, '', window.location.pathname);
}

export function initApp(user) {
  authState.email = user.email || null;
  document.getElementById('currentUser').textContent = user.email?.split('@')[0] || '';
  initNav();
  initThemeToggle(document.getElementById('themeToggle'));
  initLogout(document.getElementById('logoutBtn'));
  initServiceModal();
  initExpenseModal();
  initEmployeeModal();
  initSessionModal();
  initAdvanceModal();
  initLeaveModal();
  initDeductModal();
  initPackageModal();
  initPackageTemplateModal();
  initDeductionsModal();
  initCloudSync(renderVisitedTabs);
}
