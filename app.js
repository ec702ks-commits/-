(function () {
  "use strict";

  var state = {
    headers: [],
    rows: [], // array of objects keyed by header
    mapping: { name: "", phone: "", phone2: "", type: "", product: "", date: "" },
    filtered: [], // normalized customer objects for the selected month
  };

  var FIELD_GUESSES = {
    name: ["고객명", "성명", "이름"],
    phone: ["연락처", "휴대폰", "휴대전화", "전화번호", "핸드폰", "hp", "phone", "mobile"],
    date: ["만기예정일", "만기일", "재예치일", "만기", "maturity", "date"],
    type: ["상품유형", "제도유형", "유형", "구분", "type"],
    product: ["상품명", "펀드명", "product"],
  };

  var TEMPLATE_STORAGE_KEY = "dcirp_sms_template_v1";
  var MAPPING_STORAGE_KEY = "dcirp_sms_mapping_v1";

  var DEFAULT_TEMPLATE =
    "[삼성생명] {이름} 고객님, 가입하신 {상품유형} {상품명} 상품이 {만기일} 만기 예정입니다. " +
    "재예치/이전 관련 상담 원하시면 담당 RM에게 연락 부탁드립니다. 감사합니다.";

  var el = {};
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    el.fileInput = document.getElementById("fileInput");
    el.stepMapping = document.getElementById("step-mapping");
    el.stepFilter = document.getElementById("step-filter");
    el.stepTemplate = document.getElementById("step-template");
    el.stepSend = document.getElementById("step-send");
    el.mapName = document.getElementById("mapName");
    el.mapPhone = document.getElementById("mapPhone");
    el.mapPhone2 = document.getElementById("mapPhone2");
    el.mapType = document.getElementById("mapType");
    el.mapProduct = document.getElementById("mapProduct");
    el.mapDate = document.getElementById("mapDate");
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

    el.fileInput.addEventListener("change", handleFile);
    el.applyMapping.addEventListener("click", handleApplyMapping);
    el.applyFilter.addEventListener("click", handleApplyFilter);
    el.applyTemplate.addEventListener("click", handleApplyTemplate);
  }

  function handleFile(evt) {
    var file = evt.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var workbook = XLSX.read(data, { type: "array", cellDates: true });
        var extracted = extractRows(workbook);

        if (!extracted || !extracted.rows.length) {
          alert(
            "엑셀에서 표 데이터를 찾을 수 없습니다.\n" +
            "확인한 시트: " + workbook.SheetNames.join(", ") + "\n" +
            "고객명/연락처 등 컬럼이 있는 표 형태 데이터가 있는지 확인해주세요."
          );
          return;
        }

        state.headers = extracted.headers;
        state.rows = extracted.rows;
        populateMappingSelects();
        el.stepMapping.classList.remove("hidden");
        el.stepMapping.scrollIntoView({ behavior: "smooth" });
      } catch (err) {
        alert("엑셀 파일을 읽는 중 오류가 발생했습니다. 파일 형식을 확인해 주세요.");
      }
    };
    reader.readAsArrayBuffer(file);
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

  function populateMappingSelects() {
    var savedMapping = {};
    try {
      savedMapping = JSON.parse(localStorage.getItem(MAPPING_STORAGE_KEY) || "{}");
    } catch (e) {
      savedMapping = {};
    }

    var selects = {
      name: el.mapName,
      phone: el.mapPhone,
      phone2: el.mapPhone2,
      type: el.mapType,
      product: el.mapProduct,
      date: el.mapDate,
    };

    var guesses = guessAllHeaders(state.headers);

    Object.keys(selects).forEach(function (field) {
      var select = selects[field];
      select.innerHTML = "";
      var blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "(선택 안 함)";
      select.appendChild(blank);

      state.headers.forEach(function (h) {
        var opt = document.createElement("option");
        opt.value = h;
        var sample = state.rows[0] ? String(state.rows[0][h] || "").trim() : "";
        opt.textContent = /^컬럼\d+$/.test(h) && sample ? h + " (예: " + sample + ")" : h;
        select.appendChild(opt);
      });

      var preset = savedMapping[field] && state.headers.indexOf(savedMapping[field]) !== -1
        ? savedMapping[field]
        : guesses[field];
      if (preset) select.value = preset;
    });
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

  function handleApplyMapping() {
    state.mapping = {
      name: el.mapName.value,
      phone: el.mapPhone.value,
      phone2: el.mapPhone2.value,
      type: el.mapType.value,
      product: el.mapProduct.value,
      date: el.mapDate.value,
    };

    if (!state.mapping.name || !state.mapping.phone || !state.mapping.date) {
      alert("고객명, 휴대폰번호, 만기일 컬럼은 필수 선택 사항입니다.");
      return;
    }

    localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(state.mapping));

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
    state.filtered = state.rows
      .map(function (row) {
        var dateValue = parseDate(row[m.date]);
        var phoneRaw = buildPhoneNumber(row[m.phone], m.phone2 ? row[m.phone2] : "");
        return {
          name: String(row[m.name] || "").trim(),
          phone: phoneRaw,
          type: m.type ? String(row[m.type] || "").trim() : "",
          product: m.product ? String(row[m.product] || "").trim() : "",
          date: dateValue,
        };
      })
      .filter(function (c) {
        return c.date && c.date.getFullYear() === targetYear && c.date.getMonth() + 1 === targetMonth && c.phone;
      })
      .sort(function (a, b) { return a.date - b.date; });

    el.filterResultHint.textContent = monthValue + " 만기예정 고객 " + state.filtered.length + "명이 검색되었습니다.";

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
      nameLine.innerHTML =
        '<span>' + escapeHtml(customer.name) + ' <span class="phone">' + escapeHtml(formatPhoneDisplay(customer.phone)) + '</span></span>' +
        '<span class="status-badge" id="status-' + idx + '"></span>';
      item.appendChild(nameLine);

      var preview = document.createElement("div");
      preview.className = "message-preview";
      preview.textContent = message;
      item.appendChild(preview);

      var actions = document.createElement("div");
      actions.className = "actions";

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
