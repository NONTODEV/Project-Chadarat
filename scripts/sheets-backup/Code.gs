// สำรองข้อมูล Firestore ของ "ชฎารัตน์ นวดเพื่อสุขภาพ" ลง Google Sheet นี้ทุกวันตี 1
// วิธีติดตั้ง: ดูไฟล์ README.md ในโฟลเดอร์เดียวกัน

var FIRESTORE_PROJECT_ID = 'project-chadarat';
var BACKUP_FOLDER_NAME = 'ชฎารัตน์ - ประวัติการสำรองข้อมูลรายวัน';

// ฟังก์ชันหลักที่ trigger เรียกทุกวันตี 1: อัปเดตแท็บในชีตนี้ให้เป็นข้อมูลล่าสุด
// แล้วก๊อปปี้ทั้งไฟล์เก็บเป็นสำเนาประจำวันแยกไว้ต่างหาก (เก็บประวัติแต่ละวัน)
function dailyBackupAndArchive() {
  backupFirestoreToSheet();
  archiveDailySnapshot();
}

function backupFirestoreToSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var services = fetchCollection('services');
  var serviceRows = [];
  services.forEach(function (s) {
    var prices = s.prices || {};
    Object.keys(prices).forEach(function (duration) {
      var p = prices[duration] || {};
      serviceRows.push([
        s.id, s.name || '', Number(duration),
        p.customer != null ? p.customer : '',
        p.therapist != null ? p.therapist : '',
      ]);
    });
  });
  writeSheet(ss, 'บริการ', ['รหัสบริการ', 'ชื่อบริการ', 'ระยะเวลา(นาที)', 'ราคาลูกค้า', 'ค่าคอมหมอ'], serviceRows);

  var employees = fetchCollection('employees');
  employees.sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'th'); });
  writeSheet(ss, 'พนักงาน',
    ['รหัสพนักงาน', 'ชื่อ', 'เบอร์โทร', 'วันที่เริ่มงาน', 'ประเภท', 'เงินเดือนตายตัว', 'ยังทำงานอยู่'],
    employees.map(function (e) {
      return [e.id, e.name || '', e.phone || '', e.startDate || '', e.role || 'therapist',
        e.fixedSalary != null ? e.fixedSalary : '', e.active !== false];
    }));

  var sessions = fetchCollection('sessions');
  sessions.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  writeSheet(ss, 'บันทึกการนวด',
    ['รหัส', 'วันที่', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'รหัสบริการ', 'ชื่อบริการ', 'ระยะเวลา(นาที)', 'ราคาลูกค้า', 'ค่าคอม', 'มาสาย', 'ออกก่อนเวลา'],
    sessions.map(function (s) {
      return [s.id, s.date || '', s.employeeId || '', s.employeeName || '', s.serviceId || '',
        s.serviceName || '', s.duration || '', s.customerPrice || 0, s.commission || 0, !!s.late, !!s.leftEarly];
    }));
  writeDailySummarySheet(ss, buildDailySummaryRows(sessions));

  var advances = fetchCollection('advances');
  advances.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  writeSheet(ss, 'เบิกเงินล่วงหน้า',
    ['รหัส', 'วันที่', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'จำนวนเงิน', 'เหตุผล', 'สถานะ'],
    advances.map(function (a) {
      return [a.id, a.date || '', a.employeeId || '', a.employeeName || '', a.amount || 0, a.reason || '', a.status || ''];
    }));

  var leaves = fetchCollection('leaves');
  leaves.sort(function (a, b) { return (b.startDate || '').localeCompare(a.startDate || ''); });
  writeSheet(ss, 'การลา',
    ['รหัส', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'วันที่เริ่มลา', 'วันที่สิ้นสุด', 'เหตุผล', 'สถานะ'],
    leaves.map(function (l) {
      return [l.id, l.employeeId || '', l.employeeName || '', l.startDate || '', l.endDate || '', l.reason || '', l.status || ''];
    }));

  var expenses = fetchCollection('expenses');
  expenses.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  writeSheet(ss, 'รายจ่าย',
    ['รหัส', 'วันที่', 'รายการ', 'จำนวนเงิน', 'หมายเหตุ'],
    expenses.map(function (e) {
      return [e.id, e.date || '', e.title || '', e.amount || 0, e.note || ''];
    }));

  var payroll = fetchCollection('payroll');
  payroll.sort(function (a, b) { return (b.month || '').localeCompare(a.month || ''); });
  writeSheet(ss, 'เงินเดือนที่จ่ายแล้ว',
    ['รหัส', 'เดือน', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'ยอดจ่ายสุทธิ', 'วันที่จ่าย'],
    payroll.map(function (p) {
      return [p.id, p.month || '', p.employeeId || '', p.employeeName || '', p.netPay || 0, p.paidAt || ''];
    }));

  var deductions = fetchCollection('payrollDeductions');
  deductions.sort(function (a, b) { return (b.month || '').localeCompare(a.month || ''); });
  writeSheet(ss, 'ยอดหักเบิกล่วงหน้า',
    ['รหัส', 'เดือน', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'ยอดหัก'],
    deductions.map(function (d) {
      return [d.id, d.month || '', d.employeeId || '', d.employeeName || '', d.amount || 0];
    }));

  var settingsDocs = fetchCollection('settings');
  var general = settingsDocs.filter(function (s) { return s.id === 'general'; })[0] || {};
  writeSheet(ss, 'ตั้งค่า',
    ['ค่าแรงขั้นต่ำประกัน/วัน', 'ระยะเวลาที่เปิดให้เลือก (นาที)'],
    [[general.minDailyWage || '', (general.durations || []).join(', ')]]);

  var infoSheet = ss.getSheetByName('ข้อมูลการสำรอง');
  if (!infoSheet) infoSheet = ss.insertSheet('ข้อมูลการสำรอง');
  infoSheet.clearContents();
  infoSheet.getRange(1, 1, 1, 2).setValues([['สำรองข้อมูลล่าสุดเมื่อ', new Date()]]);
}

// รันครั้งเดียวเพื่อตั้งเวลาให้ dailyBackupAndArchive ทำงานทุกวันตี 1
function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyBackupAndArchive' || t.getHandlerFunction() === 'backupFirestoreToSheet') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('dailyBackupAndArchive')
    .timeBased()
    .atHour(1)
    .everyDays(1)
    .create();
}

// เก็บสำเนาทั้งไฟล์ของ "วันนี้" ไว้ในโฟลเดอร์ประวัติ — ไม่ต้องมีตัวซ่อมอัตโนมัติ เพราะแต่ละวัน
// export ข้อมูลฉบับเต็มใหม่ทั้งหมดเสมอ (ไม่ใช่การต่อท้ายทีละแถว) ดังนั้นถ้ามีการแก้ไขข้อมูล
// ย้อนหลังใน Firestore ก่อนเวลาตี 1 ของวันนั้นๆ สำเนาของวันนั้นจะถูกต้องตามจริงโดยอัตโนมัติ —
// สำเนาของวันเก่าที่ archive ไปแล้วจะไม่ถูกแก้ย้อนหลัง (ตามธรรมชาติของการเก็บประวัติ ณ จุดเวลานั้น)
function archiveDailySnapshot(dateStr) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folder = getOrCreateBackupFolder();
  var label = dateStr || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  var name = 'สำรองข้อมูล ' + label;

  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) { existing.next().setTrashed(true); }

  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
}

function getOrCreateBackupFolder() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('BACKUP_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) { /* ถูกลบไปแล้ว สร้างใหม่ */ }
  }
  var folder = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  return folder;
}

// ใช้กรณีต้องการ "ซ่อม" สำเนาของวันเก่าด้วยมือ เช่น แก้ไขข้อมูลย้อนหลังใน Firestore
// ของเมื่อ 3 วันก่อนแล้วอยากให้ไฟล์สำรองของวันนั้นถูกต้องตามข้อมูลที่แก้ใหม่ —
// แก้ค่า TARGET_DATE ด้านล่างเป็นวันที่ต้องการ (รูปแบบ yyyy-MM-dd) แล้วกด Run ตรงฟังก์ชันนี้
function repairSnapshotForDate() {
  var TARGET_DATE = '2026-10-01'; // แก้เป็นวันที่ต้องการซ่อม
  backupFirestoreToSheet();
  archiveDailySnapshot(TARGET_DATE);
}

function fetchCollection(collectionName) {
  var base = 'https://firestore.googleapis.com/v1/projects/' + FIRESTORE_PROJECT_ID
    + '/databases/(default)/documents/' + collectionName;
  var token = ScriptApp.getOAuthToken();
  var docs = [];
  var pageToken = '';
  do {
    var url = base + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    var code = resp.getResponseCode();
    if (code !== 200) {
      throw new Error('Firestore API error (' + collectionName + '): ' + code + ' ' + resp.getContentText());
    }
    var json = JSON.parse(resp.getContentText());
    docs = docs.concat((json.documents || []).map(fsDocToObject));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function fsDocToObject(doc) {
  var id = doc.name.split('/').pop();
  var fields = doc.fields || {};
  var obj = { id: id };
  Object.keys(fields).forEach(function (k) { obj[k] = fsValueToJs(fields[k]); });
  return obj;
}

function fsValueToJs(value) {
  if (value == null) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('mapValue' in value) {
    var obj = {};
    var fields = (value.mapValue && value.mapValue.fields) || {};
    Object.keys(fields).forEach(function (k) { obj[k] = fsValueToJs(fields[k]); });
    return obj;
  }
  if ('arrayValue' in value) {
    var arr = (value.arrayValue && value.arrayValue.values) || [];
    return arr.map(fsValueToJs);
  }
  return null;
}

// รวมยอดบันทึกการนวดเป็นแถวเดียวต่อวัน สำหรับแท็บ "สรุปรายวัน"
function buildDailySummaryRows(sessions) {
  var byDate = {};
  sessions.forEach(function (s) {
    var date = s.date || '';
    if (!date) return;
    if (!byDate[date]) byDate[date] = { revenue: 0, commission: 0, count: 0 };
    byDate[date].revenue += Number(s.customerPrice) || 0;
    byDate[date].commission += Number(s.commission) || 0;
    byDate[date].count += 1;
  });
  var dates = Object.keys(byDate).sort(function (a, b) { return b.localeCompare(a); });
  return dates.map(function (d) {
    var m = byDate[d];
    return [d, m.revenue, m.commission, m.revenue - m.commission, m.count];
  });
}

// เขียนแท็บ "สรุปรายวัน" ให้อ่านง่าย: หัวตารางมีสี, เส้นกรอบ, สีแถวสลับ, ปัดหลักพัน
// และปักให้เป็นแท็บแรกเสมอ (รายละเอียดเต็มยังอยู่ในแท็บ "บันทึกการนวด" ตามปกติ)
function writeDailySummarySheet(ss, rows) {
  var sheetName = 'สรุปรายวัน';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  removeFilterIfAny(sheet);
  sheet.clearContents();
  sheet.clearFormats();

  var headers = ['วันที่', 'รายรับ (บาท)', 'ค่าคอม (บาท)', 'กำไร (บาท)', 'จำนวนสลิป'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#4a86e8')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  if (rows.length > 0) {
    var dataRange = sheet.getRange(2, 1, rows.length, headers.length);
    dataRange.setValues(rows);
    sheet.getRange(2, 2, rows.length, 3).setNumberFormat('#,##0');
    dataRange.setBorder(true, true, true, true, true, true, '#cccccc', SpreadsheetApp.BorderStyle.SOLID);
    for (var i = 0; i < rows.length; i++) {
      if (i % 2 === 1) sheet.getRange(i + 2, 1, 1, headers.length).setBackground('#f3f6fc');
    }
  }
  sheet.autoResizeColumns(1, headers.length);
  sheet.setColumnWidth(1, 110);
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(1);
}

function writeSheet(ss, sheetName, headers, rows) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  removeFilterIfAny(sheet);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

// Sheets API ปฏิเสธการตั้งค่าบางอย่าง (เช่น setNumberFormat) บนคอลัมน์ที่มีตัวกรอง (Filter)
// ติดอยู่ ถ้ามีใครเผลอกดสร้างตัวกรองไว้บนแท็บที่สคริปต์นี้เขียนทับทุกวัน สคริปต์จะ throw error
// ทุกรอบตั้งแต่นั้น (trigger รันแล้วล้มเหลวเงียบๆ ไม่มีใครรู้จนกว่าจะสังเกตว่ายอดสำรองค้าง) —
// ลบตัวกรองออกให้อัตโนมัติก่อนเขียนทุกครั้งกันพลาด ไม่กระทบข้อมูล เพราะแท็บเหล่านี้ถูกเขียนทับ
// ใหม่ทั้งหมดทุกวันอยู่แล้ว ไม่มีใครตั้งใจพึ่งพาตัวกรองที่ตั้งไว้ข้ามวัน
function removeFilterIfAny(sheet) {
  var filter = sheet.getFilter();
  if (filter) filter.remove();
}
