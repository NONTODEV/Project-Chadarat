import { db } from './firebase-db.js';
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, orderBy, query
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { state } from './store.js';

const COLLECTIONS = {
  services: { stateKey: 'services', order: 'order' },
  employees: { stateKey: 'employees', order: 'name' },
  sessions: { stateKey: 'sessions', order: 'date' },
  advances: { stateKey: 'advances', order: 'date' },
  payroll: { stateKey: 'payrollPayments', order: 'paidAt' },
  payrollDeductions: { stateKey: 'payrollDeductions', order: 'month' },
  leaves: { stateKey: 'leaves', order: 'startDate' },
  expenses: { stateKey: 'expenses', order: 'date' },
  packages: { stateKey: 'packages', order: 'purchaseDate' },
  packageTemplates: { stateKey: 'packageTemplates', order: 'name' },
  deductions: { stateKey: 'deductions', order: 'date' },
};

const loaded = { services: false, employees: false, sessions: false, advances: false, payroll: false, payrollDeductions: false, leaves: false, expenses: false, packages: false, packageTemplates: false, deductions: false, settings: false };
let onReadyCb = null;

export function initCloudSync(onReady) {
  onReadyCb = onReady;
  Object.entries(COLLECTIONS).forEach(([name, cfg]) => {
    const q = query(collection(db, name), orderBy(cfg.order));
    onSnapshot(q, (snap) => {
      state[cfg.stateKey] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      loaded[name] = true;
      if (Object.values(loaded).every(Boolean) && onReadyCb) onReadyCb();
    }, (err) => console.warn(`onSnapshot(${name}) failed`, err));
  });

  onSnapshot(doc(db, 'settings', 'general'), (snap) => {
    if (snap.exists()) Object.assign(state.settings, snap.data());
    loaded.settings = true;
    if (Object.values(loaded).every(Boolean) && onReadyCb) onReadyCb();
  }, (err) => console.warn('onSnapshot(settings) failed', err));
}

function makeCrud(collectionName) {
  return {
    save: async (id, data) => setDoc(doc(db, collectionName, id), data),
    remove: async (id) => deleteDoc(doc(db, collectionName, id)),
  };
}

export const servicesCrud = makeCrud('services');
export const employeesCrud = makeCrud('employees');
export const sessionsCrud = makeCrud('sessions');
export const advancesCrud = makeCrud('advances');
export const payrollCrud = makeCrud('payroll');
export const payrollDeductionsCrud = makeCrud('payrollDeductions');
export const leavesCrud = makeCrud('leaves');
export const expensesCrud = makeCrud('expenses');
export const packagesCrud = makeCrud('packages');
export const packageTemplatesCrud = makeCrud('packageTemplates');
export const deductionsCrud = makeCrud('deductions');

export const settingsCrud = {
  save: async (data) => setDoc(doc(db, 'settings', 'general'), data, { merge: true }),
};
