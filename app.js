(function () {
  "use strict";

  var state = {
    products: null, // { sheetName, headers, rows }
    contactsFiles: [], // array of { sheetName, headers, rows }, one per uploaded 단체 연락처 파일
    mapping: {},
    filtered: [],
    storedContactsDb: null, // { updatedAt, count, map } loaded from localStorage
    useStoredContacts: false,
    pendingProductsFile: null,
    pendingContactsFiles: [],
    lastProductsPasswordAttempt: null,
    lastContactsPasswordAttempt: null,
    contactsLoading: false,
    targetMonthValue: "",
    manualImageDataUrl: null,
  };

  var FIELD_GUESSES = {
    name: ["고객명", "성명", "이름", "가입자"],
    phone: ["연락처", "휴대폰", "휴대전화", "전화번호", "핸드폰", "hp", "phone", "mobile"],
    date: ["만기예정일", "만기일", "재예치일", "만기", "maturity", "date"],
    type: ["상품유형", "제도유형", "유형", "구분", "type"],
    product: ["상품명", "펀드명", "product"],
    orgName: ["단체명", "단체", "거래처명", "거래처", "소속", "계약자"],
    balance: ["적립금", "적립금액", "잔액", "평가금액"],
  };

  // 고정 양식 헤더명 — 저장된 매핑이 없어도 이 이름이 있으면 정확 매칭으로 우선 사용
  // (여러 후보를 배열로 두면 순서대로 확인해서 처음 맞는 것을 사용)
  var PRODUCTS_EXACT_DEFAULTS = {
    name: ["가입자명", "가입자", "가입자성명"],
    auxKey: ["가입자번호"],
    orgName: ["계약자명", "계약자"],
    type: ["제도구분"],
    product: ["상품명"],
    date: ["만기예정일"],
    balance: ["적립금"],
  };

  var CONTACTS_EXACT_DEFAULTS = {
    name: ["가입자", "가입자명", "가입자성명"],
    auxKey: ["가입자번호"],
    phone: ["휴대전화국번호"],
    phone2: ["휴대전화개별번호"],
  };

  var TEMPLATE_STORAGE_KEY = "dcirp_sms_template_v1";
  var MAPPING_STORAGE_KEY_PRODUCTS = "dcirp_sms_mapping_products_v1";
  var MAPPING_STORAGE_KEY_CONTACTS = "dcirp_sms_mapping_contacts_v1";
  var CONTACTS_DB_KEY = "dcirp_contacts_db_v1";
  var HISTORY_KEY = "dcirp_sms_history_v1";
  var HISTORY_MAX_ENTRIES = 5000;
  var MONTHLY_RATE_KEY = "dcirp_sms_monthly_rate_v1";
  var DEFAULT_OPTION_RATE_KEY = "dcirp_sms_default_option_rate_v1";
  var MANUAL_IMAGE_KEY = "dcirp_sms_manual_image_v1";
  var MANUAL_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

  var DEFAULT_TEMPLATE =
    "{이름} 고객님 안녕하십니까\n" +
    "{단체명} 퇴직연금 담당하고 있는\n" +
    "삼성생명 퇴직연금부 구태형 과장입니다.\n\n" +
    "퇴직연금 상품 만기예정건이 있어 안내드립니다.\n\n" +
    "{만기내역}\n\n" +
    "{해당월}월 이율보증형3년 상품으로 지시하시면 적용이율은 {해당월이율}%입니다.\n\n" +
    "별도지시없이 기존 상품 만기 되셔도 디폴트 옵션 상품으로 운용 됩니다. <적용이율 {디폴트옵션이율}%>\n\n" +
    "참고 부탁드리며 퇴직연금 관련 문의사항 있으시면 언제든지 연락 부탁드립니다! 감사합니다!";

  var el = {};
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    el.fileInputProducts = document.getElementById("fileInputProducts");
    el.fileNameDisplayProducts = document.getElementById("fileNameDisplayProducts");
    el.productsPassword = document.getElementById("productsPassword");
    el.fileInputContacts = document.getElementById("fileInputContacts");
    el.fileNameDisplayContacts = document.getElementById("fileNameDisplayContacts");
    el.contactsPassword = document.getElementById("contactsPassword");
    el.proceedToMapping = document.getElementById("proceedToMapping");
    el.contactsDbInfo = document.getElementById("contactsDbInfo");
    el.contactsDbExistingInfo = document.getElementById("contactsDbExistingInfo");
    el.contactsDbStatus = document.getElementById("contactsDbStatus");
    el.useStoredContactsBtn = document.getElementById("useStoredContacts");
    el.clearContactsDbBtn = document.getElementById("clearContactsDb");
    el.exportContactsDbBtn = document.getElementById("exportContactsDb");
    el.importContactsDbInput = document.getElementById("importContactsDbInput");
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
    el.mapOrgProducts = document.getElementById("mapOrgProducts");
    el.mapType = document.getElementById("mapType");
    el.mapProduct = document.getElementById("mapProduct");
    el.mapDate = document.getElementById("mapDate");
    el.mapBalanceProducts = document.getElementById("mapBalanceProducts");
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
    el.monthlyRate = document.getElementById("monthlyRate");
    el.defaultOptionRate = document.getElementById("defaultOptionRate");
    el.applyTemplate = document.getElementById("applyTemplate");
    el.resetTemplateBtn = document.getElementById("resetTemplate");
    el.manualImageInput = document.getElementById("manualImageInput");
    el.clearManualImageBtn = document.getElementById("clearManualImage");
    el.manualImagePreviewWrap = document.getElementById("manualImagePreviewWrap");
    el.manualImagePreview = document.getElementById("manualImagePreview");
    el.customerList = document.getElementById("customerList");
    el.sendProgressText = document.getElementById("sendProgressText");
    el.scrollNextBtn = document.getElementById("scrollNextBtn");

    el.filterName = document.getElementById("filterName");
    el.filterStatus = document.getElementById("filterStatus");
    el.filterOrg = document.getElementById("filterOrg");
    el.filterOrgWrap = document.getElementById("filterOrgWrap");
    el.filterType = document.getElementById("filterType");
    el.filterTypeWrap = document.getElementById("filterTypeWrap");

    el.toggleHistoryBtn = document.getElementById("toggleHistory");
    el.historyPanel = document.getElementById("historyPanel");
    el.historyMonthFilter = document.getElementById("historyMonthFilter");
    el.historyNameFilter = document.getElementById("historyNameFilter");
    el.historyList = document.getElementById("historyList");
    el.clearHistoryBtn = document.getElementById("clearHistory");

    el.templateInput.value = localStorage.getItem(TEMPLATE_STORAGE_KEY) || DEFAULT_TEMPLATE;
    el.monthlyRate.value = localStorage.getItem(MONTHLY_RATE_KEY) || "";
    el.defaultOptionRate.value = localStorage.getItem(DEFAULT_OPTION_RATE_KEY) || "";
    state.manualImageDataUrl = localStorage.getItem(MANUAL_IMAGE_KEY) || null;

    var now = new Date();
    el.targetMonth.value = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

    el.fileInputProducts.addEventListener("change", handleProductsFile);
    el.fileInputContacts.addEventListener("change", handleContactsFile);

    function isFileDrag(e) {
      return !!(e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") !== -1);
    }
    document.addEventListener("dragover", function (e) { if (isFileDrag(e)) e.preventDefault(); });
    document.addEventListener("drop", function (e) { if (isFileDrag(e)) e.preventDefault(); });
    setupDropzone(document.getElementById("dropzoneProducts"), el.fileInputProducts);
    setupDropzone(document.getElementById("dropzoneContacts"), el.fileInputContacts);
    setupDropzone(document.getElementById("dropzoneImage"), el.manualImageInput);

    el.productsPassword.addEventListener("change", function () {
      if (!state.pendingProductsFile) return;
      if (el.productsPassword.value === state.lastProductsPasswordAttempt) return;
      state.lastProductsPasswordAttempt = el.productsPassword.value;
      loadProductsFile(state.pendingProductsFile, el.productsPassword.value);
    });

    el.contactsPassword.addEventListener("change", function () {
      if (!state.pendingContactsFiles.length) return;
      if (el.contactsPassword.value === state.lastContactsPasswordAttempt) return;
      state.lastContactsPasswordAttempt = el.contactsPassword.value;
      loadContactsFiles(state.pendingContactsFiles, el.contactsPassword.value);
    });

    el.proceedToMapping.addEventListener("click", handleProceedToMapping);
    el.applyMapping.addEventListener("click", handleApplyMapping);
    el.applyFilter.addEventListener("click", handleApplyFilter);
    el.applyTemplate.addEventListener("click", handleApplyTemplate);
    el.resetTemplateBtn.addEventListener("click", function () {
      if (!confirm("지금 작성 중인 문구를 지우고 기본 문구로 되돌릴까요?")) return;
      el.templateInput.value = DEFAULT_TEMPLATE;
    });

    el.manualImageInput.addEventListener("change", handleManualImageSelect);
    el.clearManualImageBtn.addEventListener("click", function () {
      localStorage.removeItem(MANUAL_IMAGE_KEY);
      state.manualImageDataUrl = null;
      refreshManualImageUI();
    });
    refreshManualImageUI();

    el.scrollNextBtn.addEventListener("click", scrollToNextPending);

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

    el.exportContactsDbBtn.addEventListener("click", exportContactsDb);
    el.importContactsDbInput.addEventListener("change", handleImportContactsDb);

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

    el.filterName.addEventListener("input", applyListFilters);
    el.filterStatus.addEventListener("change", applyListFilters);
    el.filterOrg.addEventListener("change", applyListFilters);
    el.filterType.addEventListener("change", applyListFilters);

    el.toggleHistoryBtn.addEventListener("click", function () {
      el.historyPanel.classList.toggle("hidden");
      if (!el.historyPanel.classList.contains("hidden")) {
        populateHistoryMonthOptions();
        renderHistoryList();
      }
    });

    el.historyMonthFilter.addEventListener("change", renderHistoryList);
    el.historyNameFilter.addEventListener("input", renderHistoryList);

    el.clearHistoryBtn.addEventListener("click", function () {
      if (!confirm("발송 이력을 전체 삭제할까요? 이 동작은 되돌릴 수 없습니다.")) return;
      localStorage.removeItem(HISTORY_KEY);
      populateHistoryMonthOptions();
      renderHistoryList();
    });

    refreshContactsDbUI();

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }
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
      el.contactsDbExistingInfo.classList.add("hidden");
      return;
    }
    el.contactsDbExistingInfo.classList.remove("hidden");
    el.contactsDbStatus.textContent = db.count + "명 저장됨 (최근 저장: " + formatDate(new Date(db.updatedAt)) + ")";
  }

  function exportContactsDb() {
    var db = state.storedContactsDb || loadContactsDb();
    if (!db) {
      alert("내보낼 연락처 DB가 없습니다.");
      return;
    }
    var blob = new Blob([JSON.stringify(db)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var today = new Date();
    var dateStr = today.getFullYear() + String(today.getMonth() + 1).padStart(2, "0") + String(today.getDate()).padStart(2, "0");
    a.href = url;
    a.download = "연락처DB_" + dateStr + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleImportContactsDb(evt) {
    var file = evt.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var imported = JSON.parse(e.target.result);
        if (!imported || typeof imported.map !== "object") {
          alert("올바른 연락처 DB 파일이 아닙니다.");
          return;
        }
        var importedCount = Object.keys(imported.map).length;
        var existingMap = (state.storedContactsDb && state.storedContactsDb.map) || {};
        var mergedMap = Object.assign({}, existingMap, imported.map);
        state.storedContactsDb = saveContactsDb(mergedMap);
        refreshContactsDbUI();
        alert("연락처 " + importedCount + "건을 가져와 합쳤습니다. (전체 " + state.storedContactsDb.count + "건)");
      } catch (err) {
        alert("파일을 읽는 중 오류가 발생했습니다. 올바른 DB 내보내기 파일인지 확인해주세요.");
      }
    };
    reader.readAsText(file);
    evt.target.value = "";
  }

  function parseWorkbookFile(file, password, onSuccess, onError) {
    var reader = new FileReader();
    reader.onload = async function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var workbook;

        try {
          workbook = XLSX.read(data, { type: "array", cellDates: true });
        } catch (readErr) {
          if (!/password/i.test(readErr.message || "")) throw readErr;

          if (!password) {
            var needPwMsg = "비밀번호로 보호된 파일입니다. 비밀번호를 입력한 뒤 다시 시도해주세요.";
            if (onError) onError(needPwMsg);
            else alert(needPwMsg);
            return;
          }

          var decrypted;
          try {
            decrypted = await OfficeCrypto.decrypt(data, { password: password });
          } catch (decErr) {
            var wrongPwMsg = /incorrect/i.test(decErr.message || "")
              ? "비밀번호가 틀렸습니다."
              : "비밀번호 해제 중 오류가 발생했습니다.";
            if (onError) onError(wrongPwMsg);
            else alert(wrongPwMsg);
            return;
          }

          workbook = XLSX.read(decrypted, { type: "buffer", cellDates: true });
        }

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

  function setupDropzone(zoneEl, inputEl) {
    if (!zoneEl || !inputEl) return;
    ["dragenter", "dragover"].forEach(function (evtName) {
      zoneEl.addEventListener(evtName, function (e) {
        e.preventDefault();
        e.stopPropagation();
        zoneEl.classList.add("drag-over");
      });
    });
    ["dragleave", "dragend"].forEach(function (evtName) {
      zoneEl.addEventListener(evtName, function (e) {
        e.preventDefault();
        e.stopPropagation();
        zoneEl.classList.remove("drag-over");
      });
    });
    zoneEl.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      zoneEl.classList.remove("drag-over");
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var dt = new DataTransfer();
      Array.prototype.forEach.call(files, function (f) { dt.items.add(f); });
      inputEl.files = dt.files;
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function handleProductsFile(evt) {
    var file = evt.target.files[0];
    if (!file) return;
    state.pendingProductsFile = file;
    state.lastProductsPasswordAttempt = el.productsPassword.value;
    loadProductsFile(file, el.productsPassword.value);
  }

  function loadProductsFile(file, password) {
    el.fileNameDisplayProducts.textContent = "선택된 파일: " + file.name + " (불러오는 중...)";
    state.products = null;
    updateProceedButton();
    parseWorkbookFile(
      file,
      password,
      function (extracted) {
        state.products = extracted;
        el.fileNameDisplayProducts.textContent = "선택된 파일: " + file.name;
        updateProceedButton();
      },
      function (msg) {
        el.fileNameDisplayProducts.textContent = "선택된 파일: " + file.name + " — " + msg;
        state.products = null;
        updateProceedButton();
      }
    );
  }

  function handleContactsFile(evt) {
    var files = Array.prototype.slice.call(evt.target.files || []);
    if (!files.length) return;

    state.useStoredContacts = false;
    state.pendingContactsFiles = files;
    state.lastContactsPasswordAttempt = el.contactsPassword.value;
    loadContactsFiles(files, el.contactsPassword.value);
  }

  function loadContactsFiles(files, password) {
    state.contactsFiles = [];
    state.contactsLoading = true;
    var loadedCount = 0;
    var failedNames = [];

    function refreshDisplay() {
      if (loadedCount < files.length) {
        el.fileNameDisplayContacts.textContent = "불러오는 중... (" + loadedCount + "/" + files.length + ")";
        return;
      }
      state.contactsLoading = false;
      var successCount = files.length - failedNames.length;
      var text = "연락처 파일 " + successCount + "개 불러옴";
      if (failedNames.length) text += " (실패: " + failedNames.join(", ") + ")";
      el.fileNameDisplayContacts.textContent = text;
      updateProceedButton();
    }

    refreshDisplay();
    updateProceedButton();

    files.forEach(function (file) {
      parseWorkbookFile(
        file,
        password,
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
    el.proceedToMapping.disabled = !state.products || !!state.contactsLoading;
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

    var fields = { name: el.mapName, auxKey: el.mapAuxProducts, orgName: el.mapOrgProducts, type: el.mapType, product: el.mapProduct, date: el.mapDate, balance: el.mapBalanceProducts };
    Object.keys(fields).forEach(function (field) {
      var preset = resolvePreset(saved, PRODUCTS_EXACT_DEFAULTS, guesses, headers, field);
      fillSelectOptions(fields[field], headers, rows, preset);
    });

    if (state.contactsFiles.length || state.useStoredContacts) {
      el.mappingProductsPhone.classList.add("hidden");
    } else {
      el.mappingProductsPhone.classList.remove("hidden");
      var phoneFields = { phone: el.mapPhone, phone2: el.mapPhone2 };
      Object.keys(phoneFields).forEach(function (field) {
        var preset = resolvePreset(saved, PRODUCTS_EXACT_DEFAULTS, guesses, headers, field);
        fillSelectOptions(phoneFields[field], headers, rows, preset);
      });
    }
  }

  function resolvePreset(saved, exactDefaults, guesses, headers, field) {
    if (saved[field] && headers.indexOf(saved[field]) !== -1) return saved[field];

    var candidates = exactDefaults[field];
    if (candidates) {
      var list = Array.isArray(candidates) ? candidates : [candidates];
      for (var i = 0; i < list.length; i++) {
        if (headers.indexOf(list[i]) !== -1) return list[i];
      }
    }

    return guesses[field] || "";
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
      var preset = resolvePreset(saved, CONTACTS_EXACT_DEFAULTS, guesses, headers, field);
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
      orgName: el.mapOrgProducts.value,
      type: el.mapType.value,
      product: el.mapProduct.value,
      date: el.mapDate.value,
      balance: el.mapBalanceProducts.value,
      phone: "",
      phone2: "",
    };

    if (!mapping.name || !mapping.date) {
      alert("고객명, 만기일 컬럼은 필수 선택 사항입니다.");
      return;
    }

    var dominantMonth = computeDominantMonth(state.products.rows, mapping.date);
    if (dominantMonth) el.targetMonth.value = dominantMonth;

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
      var existingMap = (state.storedContactsDb && state.storedContactsDb.map) || {};
      var mergedMap = Object.assign({}, existingMap, freshLookup);
      state.storedContactsDb = saveContactsDb(mergedMap);
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
      orgName: mapping.orgName,
      type: mapping.type,
      product: mapping.product,
      date: mapping.date,
      balance: mapping.balance,
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

  function computeDominantMonth(rows, dateField) {
    var counts = {};
    rows.forEach(function (row) {
      var d = parseDate(row[dateField]);
      if (!d) return;
      var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      counts[key] = (counts[key] || 0) + 1;
    });
    var best = null;
    var bestCount = 0;
    Object.keys(counts).forEach(function (key) {
      if (counts[key] > bestCount) {
        best = key;
        bestCount = counts[key];
      }
    });
    return best;
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
    state.targetMonthValue = monthValue;

    var m = state.mapping;
    var contactsLookup = (state.useStoredContacts && state.storedContactsDb) ? state.storedContactsDb.map : null;

    var rawEntries = state.products.rows
      .map(function (row) {
        var dateValue = parseDate(row[m.date]);
        var name = String(row[m.name] || "").trim();
        var auxRaw = m.auxKey ? row[m.auxKey] : "";
        var orgName = m.orgName ? String(row[m.orgName] || "").trim() : "";
        var phone, phoneMissing;

        if (contactsLookup) {
          var key = buildMatchKey(name, auxRaw);
          phone = contactsLookup[key] || "";
          phoneMissing = !phone;
        } else {
          phone = buildPhoneNumber(row[m.phone], m.phone2 ? row[m.phone2] : "");
          phoneMissing = !phone;
        }

        return {
          name: name,
          auxRaw: auxRaw,
          orgName: orgName,
          phone: phone,
          phoneMissing: phoneMissing,
          type: m.type ? String(row[m.type] || "").trim() : "",
          product: m.product ? String(row[m.product] || "").trim() : "",
          date: dateValue,
          balance: m.balance ? row[m.balance] : "",
        };
      })
      .filter(function (e) {
        return e.date && e.date.getFullYear() === targetYear && e.date.getMonth() + 1 === targetMonth;
      });

    var groups = {};
    var order = [];
    rawEntries.forEach(function (e) {
      var key = buildMatchKey(e.name, e.auxRaw);
      if (!groups[key]) {
        groups[key] = {
          name: e.name,
          orgName: e.orgName,
          phone: e.phone,
          phoneMissing: e.phoneMissing,
          products: [],
          date: e.date,
        };
        order.push(key);
      }
      var g = groups[key];
      g.products.push({ type: e.type, product: e.product, date: e.date, balance: e.balance });
      if (e.date < g.date) g.date = e.date;
    });

    state.filtered = order
      .map(function (key) { return groups[key]; })
      .sort(function (a, b) { return a.date - b.date; });

    var missingCount = state.filtered.filter(function (c) { return c.phoneMissing; }).length;
    var hint = monthValue + " 만기예정 고객 " + state.filtered.length + "명이 검색되었습니다.";
    if (missingCount) hint += " (연락처를 찾지 못한 고객 " + missingCount + "명 포함)";
    el.filterResultHint.textContent = hint;

    el.stepTemplate.classList.remove("hidden");
    el.stepTemplate.scrollIntoView({ behavior: "smooth" });
  }

  function formatProductLine(p) {
    return (p.type ? p.type + " " : "") + p.product + (p.date ? " (" + formatDate(p.date) + ")" : "");
  }

  function buildProductList(products) {
    if (products.length > 1) {
      return products.map(function (p) { return "- " + formatProductLine(p); }).join("\n");
    }
    return products[0] ? formatProductLine(products[0]) : "";
  }

  function formatBalance(value) {
    if (value === undefined || value === null || value === "") return "";
    var num = Number(String(value).replace(/[^0-9.-]/g, ""));
    if (isNaN(num)) return String(value).trim();
    return num.toLocaleString("ko-KR");
  }

  function parseBalanceNumber(value) {
    var num = Number(String(value || "").replace(/[^0-9.-]/g, ""));
    return isNaN(num) ? 0 : num;
  }

  function buildMaturityDetails(products) {
    if (products.length > 1) {
      var lines = products.map(function (p) {
        return "만기예정일 " + formatDate(p.date) + "일   적립금 " + formatBalance(p.balance) + "원";
      });
      var total = products.reduce(function (sum, p) { return sum + parseBalanceNumber(p.balance); }, 0);
      return lines.join("\n") + "\n적립금 계    " + total.toLocaleString("ko-KR") + "원";
    }
    var p = products[0] || {};
    return "만기예정일 " + formatDate(p.date) + "일\n적립금 계    " + formatBalance(p.balance) + "원";
  }

  function renderTemplate(template, customer) {
    var first = customer.products[0] || {};
    var monthParts = (state.targetMonthValue || "").split("-");
    var monthNumber = monthParts[1] ? String(Number(monthParts[1])) : "";

    return template
      .replace(/\{이름\}/g, customer.name)
      .replace(/\{단체명\}/g, customer.orgName || "")
      .replace(/\{상품유형\}/g, first.type || "")
      .replace(/\{상품명\}/g, first.product || "")
      .replace(/\{만기일\}/g, formatDate(first.date))
      .replace(/\{적립금\}/g, formatBalance(first.balance))
      .replace(/\{만기내역\}/g, buildMaturityDetails(customer.products))
      .replace(/\{상품목록\}/g, buildProductList(customer.products))
      .replace(/\{해당월\}/g, monthNumber)
      .replace(/\{해당월이율\}/g, el.monthlyRate.value.trim())
      .replace(/\{디폴트옵션이율\}/g, el.defaultOptionRate.value.trim());
  }

  function buildSmsHref(phone, message) {
    var digits = phone.replace(/[^0-9]/g, "");
    var isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    var separator = isiOS ? "&" : "?";
    return "sms:" + digits + separator + "body=" + encodeURIComponent(message);
  }

  function refreshManualImageUI() {
    if (state.manualImageDataUrl) {
      el.manualImagePreview.src = state.manualImageDataUrl;
      el.manualImagePreviewWrap.classList.remove("hidden");
      el.clearManualImageBtn.classList.remove("hidden");
    } else {
      el.manualImagePreview.src = "";
      el.manualImagePreviewWrap.classList.add("hidden");
      el.clearManualImageBtn.classList.add("hidden");
    }
  }

  function handleManualImageSelect(evt) {
    var file = evt.target.files && evt.target.files[0];
    if (!file) return;
    if (file.size > MANUAL_IMAGE_MAX_BYTES) {
      alert("이미지 용량이 너무 큽니다 (최대 3MB). 더 작은 이미지를 선택해주세요.");
      evt.target.value = "";
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = reader.result;
      try {
        localStorage.setItem(MANUAL_IMAGE_KEY, dataUrl);
      } catch (e) {
        alert("이미지 저장에 실패했습니다 (용량 초과일 수 있습니다). 더 작은 이미지를 사용해주세요.");
        evt.target.value = "";
        return;
      }
      state.manualImageDataUrl = dataUrl;
      refreshManualImageUI();
    };
    reader.readAsDataURL(file);
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(",");
    var mimeMatch = parts[0].match(/data:(.*?);base64/);
    var mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    var binary = atob(parts[1]);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function legacyCopyText(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () {
        return legacyCopyText(text);
      });
    }
    return Promise.resolve(legacyCopyText(text));
  }

  function showToast(text) {
    var toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add("show"); });
    setTimeout(function () {
      toast.classList.remove("show");
      setTimeout(function () { toast.remove(); }, 300);
    }, 2200);
  }

  function guessImageExtension(mime) {
    if (!mime) return "jpg";
    if (mime.indexOf("png") !== -1) return "png";
    if (mime.indexOf("gif") !== -1) return "gif";
    if (mime.indexOf("webp") !== -1) return "webp";
    if (mime.indexOf("jpeg") !== -1 || mime.indexOf("jpg") !== -1) return "jpg";
    return "jpg";
  }

  function shareViaKakao(message, recipientName) {
    if (navigator.share) {
      if (recipientName) {
        copyTextToClipboard(recipientName).then(function (ok) {
          if (ok) showToast('"' + recipientName + '" 이름이 복사되었습니다 — 카카오톡 검색창에 붙여넣기 하세요');
        });
      }
      if (state.manualImageDataUrl) {
        try {
          var blob = dataUrlToBlob(state.manualImageDataUrl);
          var ext = guessImageExtension(blob.type);
          var file = new File([blob], "안내이미지." + ext, { type: blob.type || "image/jpeg" });
          if (navigator.canShare && navigator.canShare({ files: [file], text: message })) {
            navigator.share({ text: message, files: [file] }).catch(function () {});
            return;
          }
        } catch (e) {}
      }
      navigator.share({ text: message }).catch(function () {});
      return;
    }
    copyTextToClipboard(message).then(function (ok) {
      if (ok) {
        alert("문구가 복사되었습니다. 카카오톡에서 대화 상대를 선택해 붙여넣기 해주세요.");
      } else {
        alert("이 브라우저에서는 공유하기/복사가 지원되지 않습니다. 문구를 직접 선택해 복사해주세요.");
      }
    });
  }

  function handleApplyTemplate() {
    var template = el.templateInput.value;
    localStorage.setItem(TEMPLATE_STORAGE_KEY, template);
    localStorage.setItem(MONTHLY_RATE_KEY, el.monthlyRate.value.trim());
    localStorage.setItem(DEFAULT_OPTION_RATE_KEY, el.defaultOptionRate.value.trim());

    if (!state.filtered.length) {
      el.customerList.innerHTML = '<p class="empty-msg">선택한 조건에 해당하는 만기 예정 고객이 없습니다.</p>';
      el.sendProgressText.textContent = "";
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
      item.dataset.name = customer.name;
      item.dataset.org = customer.orgName || "";
      item.dataset.types = customer.products.map(function (p) { return p.type; }).filter(Boolean).join(",");

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
          recordSendHistory(customer, message, "문자");
          updateSendProgress();
          applyListFilters();
          setTimeout(scrollToNextPending, 400);
        });
        actions.appendChild(sendLink);

        var kakaoBtn = document.createElement("button");
        kakaoBtn.type = "button";
        kakaoBtn.className = "btn kakao small";
        kakaoBtn.textContent = "카톡으로 보내기";
        kakaoBtn.addEventListener("click", function () {
          shareViaKakao(message, customer.name);
          var badge = document.getElementById("status-" + idx);
          if (badge) badge.textContent = "카톡 공유 열림";
          item.classList.add("done");
          recordSendHistory(customer, message, "카카오톡");
          updateSendProgress();
          applyListFilters();
          setTimeout(scrollToNextPending, 400);
        });
        actions.appendChild(kakaoBtn);
      }

      item.appendChild(actions);
      el.customerList.appendChild(item);
    });

    populateSendFilters();
    applyListFilters();
    updateSendProgress();
    el.stepSend.classList.remove("hidden");
    el.stepSend.scrollIntoView({ behavior: "smooth" });
  }

  function populateSendFilters() {
    var orgs = Array.from(new Set(state.filtered.map(function (c) { return c.orgName; }).filter(Boolean))).sort();
    var types = Array.from(new Set(state.filtered.reduce(function (acc, c) {
      c.products.forEach(function (p) { if (p.type) acc.push(p.type); });
      return acc;
    }, []))).sort();

    fillSimpleOptions(el.filterOrg, orgs, "전체 단체");
    el.filterOrgWrap.classList.toggle("hidden", orgs.length === 0);

    fillSimpleOptions(el.filterType, types, "전체 상품유형");
    el.filterTypeWrap.classList.toggle("hidden", types.length === 0);

    el.filterName.value = "";
    el.filterStatus.value = "";
  }

  function fillSimpleOptions(select, values, allLabel) {
    var current = select.value;
    select.innerHTML = "";
    var allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = allLabel;
    select.appendChild(allOpt);
    values.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
    if (values.indexOf(current) !== -1) select.value = current;
  }

  function applyListFilters() {
    var nameQ = el.filterName.value.trim().toLowerCase();
    var statusQ = el.filterStatus.value;
    var orgQ = el.filterOrg.value;
    var typeQ = el.filterType.value;

    var items = el.customerList.querySelectorAll(".customer-item");
    items.forEach(function (item) {
      var matchesName = !nameQ || item.dataset.name.toLowerCase().indexOf(nameQ) !== -1;
      var matchesOrg = !orgQ || item.dataset.org === orgQ;
      var matchesType = !typeQ || (item.dataset.types || "").split(",").indexOf(typeQ) !== -1;
      var status = item.classList.contains("missing-phone") ? "missing" : (item.classList.contains("done") ? "done" : "pending");
      var matchesStatus = !statusQ || status === statusQ;

      item.classList.toggle("hidden-by-filter", !(matchesName && matchesOrg && matchesType && matchesStatus));
    });
  }

  function updateSendProgress() {
    var missing = state.filtered.filter(function (c) { return c.phoneMissing; }).length;
    var sendable = state.filtered.length - missing;
    var doneCount = el.customerList.querySelectorAll(".customer-item.done").length;
    var remaining = sendable - doneCount;
    var text = "발송 대기 " + remaining + "명 / 전체 " + sendable + "명";
    if (missing) text += " (연락처 확인 필요 " + missing + "명 별도)";
    el.sendProgressText.textContent = text;
  }

  function scrollToNextPending() {
    var items = el.customerList.querySelectorAll(".customer-item");
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.classList.contains("done") || item.classList.contains("missing-phone") || item.classList.contains("hidden-by-filter")) continue;
      item.scrollIntoView({ behavior: "smooth", block: "center" });
      item.classList.add("highlight");
      (function (target) {
        setTimeout(function () { target.classList.remove("highlight"); }, 1500);
      })(item);
      return;
    }
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function recordSendHistory(customer, message, channel) {
    var history = loadHistory();
    history.push({
      ts: new Date().toISOString(),
      month: state.targetMonthValue,
      name: customer.name,
      phone: customer.phone,
      products: customer.products.map(formatProductLine).join(", "),
      message: message,
      channel: channel || "문자",
    });
    if (history.length > HISTORY_MAX_ENTRIES) {
      history = history.slice(history.length - HISTORY_MAX_ENTRIES);
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  function populateHistoryMonthOptions() {
    var history = loadHistory();
    var months = Array.from(new Set(history.map(function (h) { return h.month; }).filter(Boolean))).sort().reverse();
    var current = el.historyMonthFilter.value;
    el.historyMonthFilter.innerHTML = "";
    var allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "전체";
    el.historyMonthFilter.appendChild(allOpt);
    months.forEach(function (mo) {
      var opt = document.createElement("option");
      opt.value = mo;
      opt.textContent = mo;
      el.historyMonthFilter.appendChild(opt);
    });
    if (months.indexOf(current) !== -1) el.historyMonthFilter.value = current;
  }

  function renderHistoryList() {
    var history = loadHistory();
    var monthQ = el.historyMonthFilter.value;
    var nameQ = el.historyNameFilter.value.trim().toLowerCase();

    var filtered = history
      .filter(function (h) { return !monthQ || h.month === monthQ; })
      .filter(function (h) { return !nameQ || h.name.toLowerCase().indexOf(nameQ) !== -1; })
      .sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });

    el.historyList.innerHTML = "";

    if (!filtered.length) {
      el.historyList.innerHTML = '<p class="hint">발송 이력이 없습니다.</p>';
      return;
    }

    filtered.slice(0, 100).forEach(function (h) {
      var row = document.createElement("div");
      row.className = "db-row";

      var label = document.createElement("span");
      label.className = "db-row-name";
      var d = new Date(h.ts);
      var timeStr = formatDate(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      label.textContent = timeStr + " [" + (h.channel || "문자") + "] — " + h.name + " (" + formatPhoneDisplay(h.phone) + ") — " + h.products;
      row.appendChild(label);

      el.historyList.appendChild(row);
    });

    if (filtered.length > 100) {
      var more = document.createElement("p");
      more.className = "hint";
      more.textContent = (filtered.length - 100) + "건 더 있습니다. 월/이름으로 좁혀보세요.";
      el.historyList.appendChild(more);
    }
  }
})();
