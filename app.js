(function () {
  "use strict";

  var state = {
    products: null, // { sheetName, headers, rows }
    contactsFiles: [], // array of { sheetName, headers, rows }, one per uploaded 단체 연락처 파일
    mapping: {},
    filtered: [],
    storedContactsDb: null, // { updatedAt, count, map } loaded from localStorage
    useStoredContacts: false,
  };

  var FIELD_GUESSES = {
    name: ["고객명", "성명", "이름"],
    phone: ["연락처", "휴대폰", "휴대전화", "전화번호", "핸드폰", "hp", "phone", "mobile"],
    date: ["만기예정일", "만기일", "재예치일", "만기", "maturity", "date"],
    type: ["상품유형", "제도유형", "유형", "구분", "type"],
    product: ["상품명", "펀드명", "product"],
  };

  var TEMPLATE_STORAGE_KEY = "dcirp_sms_template_v1";
  var MAPPING_STORAGE_KEY_PRODUCTS = "dcirp_sms_mapping_products_v1";
  var MAPPING_STORAGE_KEY_CONTACTS = "dcirp_sms_mapping_contacts_v1";
  var CONTACTS_DB_KEY = "dcirp_contacts_db_v1";

  var DEFAULT_TEMPLATE =
    "[삼성생명] {이름} 고객님, 가입하신 {상품유형} {상품명} 상품이 {만기일} 만기 예정입니다. " +
    "재예치/이전 관련 상담 원하시면 담당 RM에게 연락 부탁드립니다. 감사합니다.";

  var el = {};
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    el.fileInputProducts = document.getElementById("fileInputProducts");
    el.fileNameDisplayProducts = document.getElementById("fileNameDisplayProducts");
    el.fileInputContacts = document.getElementById("fileInputContacts");
    el.fileNameDisplayContacts = document.getElementById("fileNameDisplayContacts");
    el.proceedToMapping = document.getElementById("proceedToMapping");
    el.contactsDbInfo = document.getElementById("contactsDbInfo");
    el.contactsDbStatus = document.getElementById("contactsDbStatus");
    el.useStoredContactsBtn = document.getElementById("useStoredContacts");
    el.clearContactsDbBtn = document.getElementById("clearContactsDb");
    el.manageContactsDbBtn = document.getElementById("manageContactsDb");
    el.contactsDbManager = document.getElementById("contactsDbManager");
    el.contactsDbSearch = document.getElementById("contactsDbSearch");
    el.contactsDbList = document.getElementById("contactsDbList");
    el.newContactName = document.getElementById("newContactName");
    el.newContactAux = document.getElementById("newContactAux");
    el.newContactPhone = document.getElementById("newContactPhone");
    el.addContactEntryBtn = document.getElementById("addContactEntry");

    el.stepMapping = document.getElementById("step-mapping");
    el.stepFilter = document.getElementById("step-filter");
    el.stepTemplate = document.getElementById("step-template");
    el.stepSend = document.getElementById("step-send");

    el.mappingProductsPhone = document.getElementById("mappingProductsPhone");
    el.mappingContacts = document.getElementById("mappingContacts");

    el.mapName = document.getElementById("mapName");
    el.mapAuxProducts = document.getElementById("mapAuxProducts");
    el.mapType = document.getElementById("mapType");
    el.mapProduct = document.getElementById("mapProduct");
    el.mapDate = document.getElementById("mapDate");
    el.mapPhone = document.getElementById("mapPhone");
    el.mapPhone2 = document.getElementById("mapPhone2");

    el.mapNameContacts = document.getElementById("mapNameContacts");
    el.mapAuxContacts = document.getElementById("mapAuxContacts");
    el.mapPhoneContacts = document.getElementById("mapPhoneContacts");
    el.mapPhone2Contacts = document.getElementById("mapPhone2Contacts");

    el.applyMapping = document.getElementById("applyMapping");
    el.targetMonth = document.getElementById("targetMonth");
    el.applyFilter = document.getElementById("applyFilter");
    el.filterResultHint = document.getElementById("filterResultHint");
    el.templateInput = document.getElementById("templateInput");
    el.applyTemplate = document.getElementById("applyTemplate");
    el.customerList = document.getElementById("customerList");

    el.templateInput.value = localStorage.getItem(TEMPLATE_STORAGE_KEY) || DEFAULT_TEMPLATE;

    var now = new Date();
    el.targetMonth.value = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

    el.fileInputProducts.addEventListener("change", handleProductsFile);
    el.fileInputContacts.addEventListener("change", handleContactsFile);
    el.proceedToMapping.addEventListener("click", handleProceedToMapping);
    el.applyMapping.addEventListener("click", handleApplyMapping);
    el.applyFilter.addEventListener("click", handleApplyFilter);
    el.applyTemplate.addEventListener("click", handleApplyTemplate);

    el.useStoredContactsBtn.addEventListener("click", function () {
      state.useStoredContacts = true;
      state.contactsFiles = [];
      el.fileNameDisplayContacts.textContent = "저장된 연락처 DB를 사용합니다 (새로 올리면 취소됩니다).";
      updateProceedButton();
    });

    el.clearContactsDbBtn.addEventListener("click", function () {
      if (!confirm("저장된 연락처 DB를 삭제할까요? 이 동작은 되돌릴 수 없습니다.")) return;
      clearContactsDb();
      state.storedContactsDb = null;
      state.useStoredContacts = false;
      el.contactsDbManager.classList.add("hidden");
      refreshContactsDbUI();
    });

    el.manageContactsDbBtn.addEventListener("click", function () {
      el.contactsDbManager.classList.toggle("hidden");
      if (!el.contactsDbManager.classList.contains("hidden")) {
        el.contactsDbSearch.value = "";
        renderContactsDbList("");
      }
    });

    el.contactsDbSearch.addEventListener("input", function () {
      renderContactsDbList(el.contactsDbSearch.value);
    });

    el.addContactEntryBtn.addEventListener("click", function () {
      var name = el.newContactName.value.trim();
      var phone = buildPhoneNumber(el.newContactPhone.value, "");
      if (!name || !phone) {
        alert("이름과 연락처를 입력해주세요.");
        return;
      }
      var db = state.storedContactsDb || { updatedAt: new Date().toISOString(), count: 0, map: {} };
      var key = buildMatchKey(name, el.newContactAux.value);
      db.map[key] = phone;
      state.storedContactsDb = saveContactsDb(db.map);
      el.newContactName.value = "";
      el.newContactAux.value = "";
      el.newContactPhone.value = "";
      refreshContactsDbUI();
      el.contactsDbManager.classList.remove("hidden");
      renderContactsDbList(el.contactsDbSearch.value);
    });

    refreshContactsDbUI();
  }

  function renderContactsDbList(query) {
    var db = state.storedContactsDb;
    el.contactsDbList.innerHTML = "";
    if (!db) return;

    var q = query.trim();
    if (!q) {
      el.contactsDbList.innerHTML = '<p class="hint">이름을 검색하면 목록이 나타납니다. (전체 ' + db.count + '건)</p>';
      return;
    }

    var keys = Object.keys(db.map).filter(function (key) {
      return key.split("|")[0].indexOf(q) !== -1;
    });

    if (!keys.length) {
      el.contactsDbList.innerHTML = '<p class="hint">일치하는 연락처가 없습니다.</p>';
      return;
    }

    keys.slice(0, 50).forEach(function (key) {
      var parts = key.split("|");
      var name = parts[0];
      var aux = parts[1] || "";

      var row = document.createElement("div");
      row.className = "db-row";

      var label = document.createElement("span");
      label.className = "db-row-name";
      label.textContent = name + (aux ? " (" + aux + ")" : "");
      row.appendChild(label);

      var phoneInput = document.createElement("input");
      phoneInput.type = "text";
      phoneInput.className = "db-row-phone";
      phoneInput.value = formatPhoneDisplay(db.map[key]);
      phoneInput.addEventListener("change", function () {
        var newPhone = buildPhoneNumber(phoneInput.value, "");
        if (!newPhone) {
          alert("올바른 연락처를 입력해주세요.");
          phoneInput.value = formatPhoneDisplay(db.map[key]);
          return;
        }
        db.map[key] = newPhone;
        state.storedContactsDb = saveContactsDb(db.map);
        refreshContactsDbUI();
      });
      row.appendChild(phoneInput);

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn small danger";
      delBtn.textContent = "삭제";
      delBtn.addEventListener("click", function () {
        delete db.map[key];
        state.storedContactsDb = saveContactsDb(db.map);
        refreshContactsDbUI();
        el.contactsDbManager.classList.remove("hidden");
        renderContactsDbList(el.contactsDbSearch.value);
      });
      row.appendChild(delBtn);

      el.contactsDbList.appendChild(row);
    });

    if (keys.length > 50) {
      var more = document.createElement("p");
      more.className = "hint";
      more.textContent = (keys.length - 50) + "건 더 있습니다. 검색어를 더 구체적으로 입력해주세요.";
      el.contactsDbList.appendChild(more);
    }
  }

  function loadContactsDb() {
    try {
      var raw = localStorage.getItem(CONTACTS_DB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveContactsDb(map) {
    var db = { updatedAt: new Date().toISOString(), count: Object.keys(map).length, map: map };
    localStorage.setItem(CONTACTS_DB_KEY, JSON.stringify(db));
    return db;
  }

  function clearContactsDb() {
    localStorage.removeItem(CONTACTS_DB_KEY);
  }

  function refreshContactsDbUI() {
    var db = loadContactsDb();
    state.storedContactsDb = db;
    if (!db) {
      el.contactsDbInfo.classList.add("hidden");
      return;
    }
    el.contactsDbInfo.classList.remove("hidden");
    el.contactsDbStatus.textContent = db.count + "명 저장됨 (최근 저장: " + formatDate(new Date(db.updatedAt)) + ")";
  }

  function parseWorkbookFile(file, onSuccess, onError) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var workbook = XLSX.read(data, { type: "array", cellDates: true });
        var extracted = extractRows(workbook);

        if (!extracted || !extracted.rows.length) {
          var notFoundMsg = "표 데이터를 찾을 수 없습니다 (시트: " + workbook.SheetNames.join(", ") + ")";
          if (onError) onError(notFoundMsg);
          else alert("엑셀에서 " + notFoundMsg + "\n고객명 등 컬럼이 있는 표 형태 데이터가 있는지 확인해주세요.");
          return;
        }

        onSuccess(extracted);
      } catch (err) {
        var errMsg = "파일을 읽는 중 오류가 발생했습니다.";
        if (onError) onError(errMsg);
        else alert("엑셀 " + errMsg + " 파일 형식을 확인해 주세요.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleProductsFile(evt) {
    var file = evt.target.files[0];
    if (!file) return;
    el.fileNameDisplayProducts.textContent = "선택된 파일: " + file.name;
    parseWorkbookFile(file, function (extracted) {
      state.products = extracted;
      updateProceedButton();
    });
  }

  function handleContactsFile(evt) {
    var files = Array.prototype.slice.call(evt.target.files || []);
    if (!files.length) return;

    state.useStoredContacts = false;
    state.contactsFiles = [];
    var loadedCount = 0;
    var failedNames = [];

    function refreshDisplay() {
      if (loadedCount < files.length) {
        el.fileNameDisplayContacts.textContent = "불러오는 중... (" + loadedCount + "/" + files.length + ")";
        return;
      }
      var successCount = files.length - failedNames.length;
      var text = "연락처 파일 " + successCount + "개 불러옴";
      if (failedNames.length) text += " (실패: " + failedNames.join(", ") + ")";
      el.fileNameDisplayContacts.textContent = text;
      updateProceedButton();
    }

    refreshDisplay();

    files.forEach(function (file) {
      parseWorkbookFile(
        file,
        function (extracted) {
          state.contactsFiles.push(extracted);
          loadedCount++;
          refreshDisplay();
        },
        function () {
          failedNames.push(file.name);
          loadedCount++;
          refreshDisplay();
        }
      );
    });
  }

  function updateProceedButton() {
    el.proceedToMapping.disabled = !state.products;
  }

  var ALL_FIELD_KEYWORDS = Object.keys(FIELD_GUESSES).reduce(function (acc, field) {
    return acc.concat(FIELD_GUESSES[field]);
  }, []);

  function findHeaderRowIndex(grid) {
    var limit = Math.min(grid.length, 15);
    for (var i = 0; i < limit; i++) {
      var matches = grid[i].filter(function (cell) {
        var text = String(cell).trim().toLowerCase();
        if (!text) return false;
        return ALL_FIELD_KEYWORDS.some(function (k) { return text.indexOf(k.toLowerCase()) !== -1; });
      }).length;
      if (matches >= 2) return i;
    }
    return -1;
  }

  function looksLikeDataRow(row) {
    return row.some(function (cell) {
      if (cell instanceof Date) return true;
      var s = String(cell).trim();
      if (!s) return false;
      if (/^01[0-9][-\s]?\d{3,4}[-\s]?\d{4}$/.test(s)) return true;
      if (/^\d{4}[-.\/]\d{1,2}[-.\/]\d{1,2}$/.test(s)) return true;
      if (/^\d{6,}$/.test(s)) return true;
      return false;
    });
  }

  function toRowObjects(headers, dataRows) {
    return dataRows
      .filter(function (r) { return r.some(function (cell) { return String(cell).trim() !== ""; }); })
      .map(function (r) {
        var obj = {};
        headers.forEach(function (h, idx) {
          if (!h) return;
          obj[h] = r[idx] !== undefined ? r[idx] : "";
        });
        return obj;
      });
  }

  function extractRows(workbook) {
    for (var s = 0; s < workbook.SheetNames.length; s++) {
      var sheetName = workbook.SheetNames[s];
      var grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: false });
      if (!grid.length) continue;

      var headers, rows;
      var headerRowIndex = findHeaderRowIndex(grid);

      if (headerRowIndex !== -1) {
        headers = grid[headerRowIndex].map(function (h) { return String(h).trim(); });
        rows = toRowObjects(headers, grid.slice(headerRowIndex + 1));
      } else if (!looksLikeDataRow(grid[0])) {
        headers = grid[0].map(function (h) { return String(h).trim(); });
        rows = toRowObjects(headers, grid.slice(1));
      } else {
        var colCount = grid.reduce(function (max, r) { return Math.max(max, r.length); }, 0);
        headers = [];
        for (var c = 0; c < colCount; c++) headers.push("컬럼" + (c + 1));
        rows = toRowObjects(headers, grid);
      }

      if (rows.length) {
        return { sheetName: sheetName, headers: headers.filter(Boolean), rows: rows };
      }
    }
    return null;
  }

  function guessAllHeaders(headers) {
    var claimed = {};
    var result = {};
    Object.keys(FIELD_GUESSES).forEach(function (field) {
      var keywords = FIELD_GUESSES[field];
      var found = headers.find(function (h) {
        if (claimed[h]) return false;
        var lower = String(h).toLowerCase();
        return keywords.some(function (k) { return lower.indexOf(k.toLowerCase()) !== -1; });
      });
      if (found) {
        result[field] = found;
        claimed[found] = true;
      } else {
        result[field] = "";
      }
    });
    return result;
  }

  function loadSavedMapping(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "{}");
    } catch (e) {
      return {};
    }
  }

  function fillSelectOptions(select, headers, rows, presetValue) {
    select.innerHTML = "";
    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "(선택 안 함)";
    select.appendChild(blank);

    headers.forEach(function (h) {
      var opt = document.createElement("option");
      opt.value = h;
      var sample = rows[0] ? String(rows[0][h] || "").trim() : "";
      opt.textContent = /^컬럼\d+$/.test(h) && sample ? h + " (예: " + sample + ")" : h;
      select.appendChild(opt);
    });

    if (presetValue && headers.indexOf(presetValue) !== -1) select.value = presetValue;
  }

  function populateProductsMapping() {
    var saved = loadSavedMapping(MAPPING_STORAGE_KEY_PRODUCTS);
    var guesses = guessAllHeaders(state.products.headers);
    var headers = state.products.headers;
    var rows = state.products.rows;

    var fields = { name: el.mapName, auxKey: el.mapAuxProducts, type: el.mapType, product: el.mapProduct, date: el.mapDate };
    Object.keys(fields).forEach(function (field) {
      var preset = (saved[field] && headers.indexOf(saved[field]) !== -1) ? saved[field] : (guesses[field] || "");
      fillSelectOptions(fields[field], headers, rows, preset);
    });

    if (state.contactsFiles.length || state.useStoredContacts) {
      el.mappingProductsPhone.classList.add("hidden");
    } else {
      el.mappingProductsPhone.classList.remove("hidden");
      var phoneFields = { phone: el.mapPhone, phone2: el.mapPhone2 };
      Object.keys(phoneFields).forEach(function (field) {
        var preset = (saved[field] && headers.indexOf(saved[field]) !== -1) ? saved[field] : (guesses[field] || "");
        fillSelectOptions(phoneFields[field], headers, rows, preset);
      });
    }
  }

  function populateContactsMapping() {
    if (!state.contactsFiles.length) {
      el.mappingContacts.classList.add("hidden");
      return;
    }
    el.mappingContacts.classList.remove("hidden");

    var saved = loadSavedMapping(MAPPING_STORAGE_KEY_CONTACTS);
    var primary = state.contactsFiles[0];
    var guesses = guessAllHeaders(primary.headers);
    var headers = primary.headers;
    var rows = primary.rows;

    var fields = { name: el.mapNameContacts, auxKey: el.mapAuxContacts, phone: el.mapPhoneContacts, phone2: el.mapPhone2Contacts };
    Object.keys(fields).forEach(function (field) {
      var preset = (saved[field] && headers.indexOf(saved[field]) !== -1) ? saved[field] : (guesses[field] || "");
      fillSelectOptions(fields[field], headers, rows, preset);
    });
  }

  function handleProceedToMapping() {
    populateProductsMapping();
    populateContactsMapping();
    el.stepMapping.classList.remove("hidden");
    el.stepMapping.scrollIntoView({ behavior: "smooth" });
  }

  function handleApplyMapping() {
    var mapping = {
      name: el.mapName.value,
      auxKey: el.mapAuxProducts.value,
      type: el.mapType.value,
      product: el.mapProduct.value,
      date: el.mapDate.value,
      phone: "",
      phone2: "",
    };

    if (!mapping.name || !mapping.date) {
      alert("고객명, 만기일 컬럼은 필수 선택 사항입니다.");
      return;
    }

    if (state.contactsFiles.length) {
      mapping.contactsName = el.mapNameContacts.value;
      mapping.contactsAuxKey = el.mapAuxContacts.value;
      mapping.contactsPhone = el.mapPhoneContacts.value;
      mapping.contactsPhone2 = el.mapPhone2Contacts.value;

      if (!mapping.contactsName || !mapping.contactsPhone) {
        alert("연락처 엑셀의 고객명, 휴대폰번호 컬럼은 필수 선택 사항입니다.");
        return;
      }

      localStorage.setItem(MAPPING_STORAGE_KEY_CONTACTS, JSON.stringify({
        name: mapping.contactsName,
        auxKey: mapping.contactsAuxKey,
        phone: mapping.contactsPhone,
        phone2: mapping.contactsPhone2,
      }));

      state.mapping = mapping;
      var freshLookup = buildContactsLookup();
      state.storedContactsDb = saveContactsDb(freshLookup);
      state.useStoredContacts = true;
      refreshContactsDbUI();
    } else if (state.useStoredContacts) {
      state.mapping = mapping;
    } else {
      mapping.phone = el.mapPhone.value;
      mapping.phone2 = el.mapPhone2.value;

      if (!mapping.phone) {
        alert("휴대폰번호 컬럼은 필수 선택 사항입니다.");
        return;
      }
      state.mapping = mapping;
    }

    localStorage.setItem(MAPPING_STORAGE_KEY_PRODUCTS, JSON.stringify({
      name: mapping.name,
      auxKey: mapping.auxKey,
      type: mapping.type,
      product: mapping.product,
      date: mapping.date,
      phone: mapping.phone,
      phone2: mapping.phone2,
    }));

    el.stepFilter.classList.remove("hidden");
    el.stepFilter.scrollIntoView({ behavior: "smooth" });
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value)) return value;
    if (typeof value === "number") {
      var parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
    }

    var str = String(value).trim();
    if (/^\d{8}$/.test(str)) {
      var y = Number(str.substring(0, 4));
      var m = Number(str.substring(4, 6)) - 1;
      var d = Number(str.substring(6, 8));
      return new Date(y, m, d);
    }

    var cleaned = str.replace(/[.\/]/g, "-");
    var match = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    var parsedDate = new Date(cleaned);
    return isNaN(parsedDate) ? null : parsedDate;
  }

  function formatDate(d) {
    if (!d) return "";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function buildPhoneNumber(primary, secondary) {
    var p = String(primary || "").trim();
    var s = String(secondary || "").trim();
    if (!p && !s) return "";

    var digits = (p + (s ? "-" + s : "")).replace(/[^0-9]/g, "");
    if (digits.length === 8) {
      digits = "010" + digits;
    } else if ((digits.length === 9 || digits.length === 10) && digits.charAt(0) !== "0") {
      digits = "0" + digits;
    }
    return digits;
  }

  function formatPhoneDisplay(digits) {
    if (digits.length === 11) return digits.slice(0, 3) + "-" + digits.slice(3, 7) + "-" + digits.slice(7);
    if (digits.length === 10) return digits.slice(0, 3) + "-" + digits.slice(3, 6) + "-" + digits.slice(6);
    return digits;
  }

  function normalizeAuxKey(value) {
    var s = String(value || "").trim();
    return s.replace(/[\s\-.\/]/g, "");
  }

  function buildMatchKey(name, aux) {
    var n = String(name || "").trim();
    var a = aux !== undefined && aux !== "" ? normalizeAuxKey(aux) : "";
    return a ? (n + "|" + a) : n;
  }

  function buildContactsLookup() {
    var map = {};
    var cm = state.mapping;
    state.contactsFiles.forEach(function (file) {
      file.rows.forEach(function (row) {
        var key = buildMatchKey(row[cm.contactsName], cm.contactsAuxKey ? row[cm.contactsAuxKey] : "");
        if (!key) return;
        var phone = buildPhoneNumber(row[cm.contactsPhone], cm.contactsPhone2 ? row[cm.contactsPhone2] : "");
        if (phone) map[key] = phone;
      });
    });
    return map;
  }

  function handleApplyFilter() {
    var monthValue = el.targetMonth.value;
    if (!monthValue) {
      alert("대상 월을 선택해주세요.");
      return;
    }
    var parts = monthValue.split("-");
    var targetYear = Number(parts[0]);
    var targetMonth = Number(parts[1]);

    var m = state.mapping;
    var contactsLookup = (state.useStoredContacts && state.storedContactsDb) ? state.storedContactsDb.map : null;

    state.filtered = state.products.rows
      .map(function (row) {
        var dateValue = parseDate(row[m.date]);
        var name = String(row[m.name] || "").trim();
        var phone, phoneMissing;

        if (contactsLookup) {
          var key = buildMatchKey(name, m.auxKey ? row[m.auxKey] : "");
          phone = contactsLookup[key] || "";
          phoneMissing = !phone;
        } else {
          phone = buildPhoneNumber(row[m.phone], m.phone2 ? row[m.phone2] : "");
          phoneMissing = !phone;
        }

        return {
          name: name,
          phone: phone,
          phoneMissing: phoneMissing,
          type: m.type ? String(row[m.type] || "").trim() : "",
          product: m.product ? String(row[m.product] || "").trim() : "",
          date: dateValue,
        };
      })
      .filter(function (c) {
        return c.date && c.date.getFullYear() === targetYear && c.date.getMonth() + 1 === targetMonth;
      })
      .sort(function (a, b) { return a.date - b.date; });

    var missingCount = state.filtered.filter(function (c) { return c.phoneMissing; }).length;
    var hint = monthValue + " 만기예정 고객 " + state.filtered.length + "명이 검색되었습니다.";
    if (missingCount) hint += " (연락처를 찾지 못한 고객 " + missingCount + "명 포함)";
    el.filterResultHint.textContent = hint;

    el.stepTemplate.classList.remove("hidden");
    el.stepTemplate.scrollIntoView({ behavior: "smooth" });
  }

  function renderTemplate(template, customer) {
    return template
      .replace(/\{이름\}/g, customer.name)
      .replace(/\{상품유형\}/g, customer.type)
      .replace(/\{상품명\}/g, customer.product)
      .replace(/\{만기일\}/g, formatDate(customer.date));
  }

  function buildSmsHref(phone, message) {
    var digits = phone.replace(/[^0-9]/g, "");
    var isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    var separator = isiOS ? "&" : "?";
    return "sms:" + digits + separator + "body=" + encodeURIComponent(message);
  }

  function handleApplyTemplate() {
    var template = el.templateInput.value;
    localStorage.setItem(TEMPLATE_STORAGE_KEY, template);

    if (!state.filtered.length) {
      el.customerList.innerHTML = '<p class="empty-msg">선택한 조건에 해당하는 만기 예정 고객이 없습니다.</p>';
      el.stepSend.classList.remove("hidden");
      el.stepSend.scrollIntoView({ behavior: "smooth" });
      return;
    }

    el.customerList.innerHTML = "";
    state.filtered.forEach(function (customer, idx) {
      var message = renderTemplate(template, customer);
      var item = document.createElement("div");
      item.className = "customer-item";
      item.id = "customer-" + idx;

      var nameLine = document.createElement("div");
      nameLine.className = "name-line";
      var phoneText = customer.phoneMissing ? "연락처 없음" : formatPhoneDisplay(customer.phone);
      nameLine.innerHTML =
        '<span>' + escapeHtml(customer.name) + ' <span class="phone">' + escapeHtml(phoneText) + '</span></span>' +
        '<span class="status-badge" id="status-' + idx + '"></span>';
      item.appendChild(nameLine);

      var preview = document.createElement("div");
      preview.className = "message-preview";
      preview.textContent = message;
      item.appendChild(preview);

      var actions = document.createElement("div");
      actions.className = "actions";

      if (customer.phoneMissing) {
        item.classList.add("missing-phone");
        var warn = document.createElement("span");
        warn.className = "status-badge missing";
        warn.textContent = "연락처를 찾지 못했습니다 — 두 엑셀의 이름/매칭키를 확인해주세요";
        actions.appendChild(warn);
      } else {
        var sendLink = document.createElement("a");
        sendLink.className = "btn send small";
        sendLink.textContent = "문자 보내기";
        sendLink.href = buildSmsHref(customer.phone, message);
        sendLink.addEventListener("click", function () {
          var badge = document.getElementById("status-" + idx);
          if (badge) badge.textContent = "발송 연결됨";
          item.classList.add("done");
        });
        actions.appendChild(sendLink);
      }

      item.appendChild(actions);
      el.customerList.appendChild(item);
    });

    el.stepSend.classList.remove("hidden");
    el.stepSend.scrollIntoView({ behavior: "smooth" });
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
