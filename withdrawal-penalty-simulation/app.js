(function () {
  "use strict";

  var PRODUCTS_KEY = "wpsim_new_products_v1";
  var RM_INFO_KEY = "wpsim_rm_info_v1";
  // 배경색 문제 진단용 — 실제로 어느 빌드가 렌더링되는지 화면/인쇄 결과에서 바로 확인할
  // 수 있게 매번 올릴 때 값을 바꾼다. 해결되면 이 상수와 사용처를 지운다.
  var REPORT_BUILD_TAG = "2026-08-07-inline-colors-1";

  var DEFAULT_ROWS = [
    { label: "1년", years: 1, method: "simple" },
    { label: "2년", years: 2, method: "simple" },
    { label: "2.5년", years: 2.5, method: "simple" },
    { label: "3년", years: 3, method: "simple" },
    { label: "5년", years: 5, method: "simple" }
  ];

  var DEFAULT_RM_INFO = {
    name: "구태형",
    dept: "부산퇴직연금부",
    contact: "010-9861-5626"
  };

  var state = {
    rows: [], // 신상품 재예치 제안금리: { id, label, years, rate }
    products: [], // 기존상품(명세) 목록: { id, withdrawals:[{id,date,amount}], refs:{} }
    nextId: 1
  };

  var el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    [
      "customerName", "todayDate",
      "existingProducts", "addExistingProduct",
      "newProductRows", "addProductRow",
      "rmName", "rmDept", "rmContact", "printBtn", "resetBtn", "reportContent", "reportSection"
    ].forEach(function (id) { el[id] = $(id); });
  }

  // ---------- 날짜: YYYY.MM.DD 숫자 입력 도우미 ----------

  function todayLocalDate() {
    var d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  function bindDateMask(input, nextInput) {
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("placeholder", "YYYY.MM.DD");
    input.setAttribute("maxlength", "10");
    input.addEventListener("input", function () {
      var digits = input.value.replace(/\D/g, "").slice(0, 8);
      var formatted = digits.slice(0, 4);
      if (digits.length > 4) formatted += "." + digits.slice(4, 6);
      if (digits.length > 6) formatted += "." + digits.slice(6, 8);
      input.value = formatted;
      if (digits.length === 8) {
        if (nextInput) nextInput.focus();
        else input.blur();
      }
    });
  }

  // ---------- 금액: 천 단위 콤마(회계식) 입력 도우미 ----------

  function bindAmountMask(input) {
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");
    input.addEventListener("input", function () {
      var digits = input.value.replace(/[^\d]/g, "");
      input.value = digits === "" ? "" : Number(digits).toLocaleString("ko-KR");
    });
  }

  function setAmountValue(input, num) {
    input.value = (num === null || num === undefined || isNaN(num)) ? "" : Math.round(num).toLocaleString("ko-KR");
  }

  function parseAmountStr(str) {
    var v = parseFloat(String(str === undefined || str === null ? "" : str).replace(/,/g, ""));
    return isNaN(v) ? null : v;
  }

  function parseDateUTC(str) {
    if (!str) return null;
    var m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(String(str).trim());
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    return date;
  }

  function addDaysUTC(date, days) {
    return new Date(date.getTime() + days * 86400000);
  }

  // 명세일자 + 기간(년)의 만기일 계산. 달력상 "몇 개월 뒤"가 아니라, 1년을
  // 365일로 고정해 날짜수를 더하는 방식이다(예: 2.5년 = floor(2.5*365) = 912일,
  // 3년 = 1095일 — 윤년 여부와 무관하게 항상 같은 일수). 실제 상품 조회
  // 자료 여러 건(2.5년/3년 상품, 서로 다른 명세일자)의 실제 만기일과 정확히
  // 대조해 확인한 규칙이며, 달력 기준 개월수 계산과는 결과가 다를 수 있다.
  function addYears(date, years) {
    var days = Math.floor(years * 365);
    return new Date(date.getTime() + days * 86400000);
  }

  // 은행/보험 상품의 이자 계산에 흔히 쓰이는 30/360(1개월=30일, 1년=360일)
  // 방식으로 두 날짜 사이 기간을 연 단위로 환산한다. 실제 상품 조회 자료의
  // "예상적립금"과 대조해 이 방식이 맞는 것을 확인했다(달력상 실제 경과일수
  // 기준으로 계산하면 실제 조회값과 어긋난다). 기존상품 자체의 성장(오늘까지
  // 경과, 만기까지 유지) 계산에 쓴다.
  function yearsBetween(d1, d2) {
    if (!d1 || !d2) return null;
    var y1 = d1.getUTCFullYear(), m1 = d1.getUTCMonth() + 1, day1 = d1.getUTCDate();
    var y2 = d2.getUTCFullYear(), m2 = d2.getUTCMonth() + 1, day2 = d2.getUTCDate();
    var dd1 = Math.min(day1, 30);
    var dd2 = day2;
    if (dd1 === 30 && day2 === 31) dd2 = 30;
    var days360 = (y2 - y1) * 360 + (m2 - m1) * 30 + (dd2 - dd1);
    return days360 / 360;
  }

  // 실제 달력 경과일수/365(act/365) 방식. 신상품 재예치 쪽 성장(오늘 재예치해서
  // 비교 시점까지) 계산에 쓴다 — 같은 실제 조회 자료로 대조해보니 기존상품과
  // 달리 이쪽은 30/360이 아니라 act/365가 정확히 일치했다.
  function actYearsBetween(d1, d2) {
    if (!d1 || !d2) return null;
    return (d2.getTime() - d1.getTime()) / 86400000 / 365;
  }

  function formatDateUTC(date) {
    if (!date) return "-";
    var y = date.getUTCFullYear();
    var m = String(date.getUTCMonth() + 1).padStart(2, "0");
    var d = String(date.getUTCDate()).padStart(2, "0");
    return y + "." + m + "." + d;
  }

  // ---------- 포맷 ----------

  function formatWon(n) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    return Math.round(n).toLocaleString("ko-KR") + "원";
  }

  function formatSignedWon(n) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    return (n >= 0 ? "+" : "") + formatWon(n);
  }

  function formatPct(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    return n.toFixed(digits === undefined ? 2 : digits) + "%";
  }

  function formatYears(n) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    return (Math.round(n * 100) / 100) + "년";
  }

  function escapeAttr(str) {
    return String(str === undefined || str === null ? "" : str).replace(/"/g, "&quot;");
  }

  function escapeHtml(str) {
    return String(str === undefined || str === null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------- 저장/불러오기 (신상품 금리 행, 작성자 정보) ----------

  function loadRows() {
    try {
      var raw = localStorage.getItem(PRODUCTS_KEY);
      if (!raw) return DEFAULT_ROWS.map(function (r) { return Object.assign({}, r, { rate: "" }); });
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) throw new Error("empty");
      return parsed.map(function (r) { return Object.assign({ method: "simple" }, r); });
    } catch (e) {
      return DEFAULT_ROWS.map(function (r) { return Object.assign({}, r, { rate: "" }); });
    }
  }

  function saveRows() {
    var data = state.rows.map(function (r) {
      return { label: r.label, years: r.years, rate: r.rate, method: r.method };
    });
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(data));
  }

  function loadRmInfo() {
    try {
      var raw = localStorage.getItem(RM_INFO_KEY);
      if (!raw) return Object.assign({}, DEFAULT_RM_INFO);
      var parsed = JSON.parse(raw);
      if (!parsed || (!parsed.name && !parsed.dept && !parsed.contact)) return Object.assign({}, DEFAULT_RM_INFO);
      return parsed;
    } catch (e) {
      return Object.assign({}, DEFAULT_RM_INFO);
    }
  }

  function saveRmInfo() {
    localStorage.setItem(RM_INFO_KEY, JSON.stringify({
      name: el.rmName.value.trim(),
      dept: el.rmDept.value.trim(),
      contact: el.rmContact.value.trim()
    }));
  }

  // ---------- 신상품 재예치 제안금리 행 렌더링 (공통, 상품 전체에 적용) ----------

  function renderRows() {
    el.newProductRows.innerHTML = "";
    state.rows.forEach(function (row) {
      var wrap = document.createElement("div");
      wrap.className = "product-row";
      wrap.innerHTML =
        '<input type="text" data-field="label" placeholder="예: 1년" value="' + escapeAttr(row.label) + '" />' +
        '<input type="number" data-field="years" step="0.1" min="0" placeholder="기간(년)" value="' + (row.years === "" || row.years === null || row.years === undefined ? "" : row.years) + '" />' +
        '<input type="number" data-field="rate" step="0.01" min="0" placeholder="제안금리(%)" value="' + (row.rate === "" || row.rate === null || row.rate === undefined ? "" : row.rate) + '" />' +
        '<button type="button" class="btn small danger" data-action="delete">삭제</button>' +
        '<select data-field="method" class="product-row-method">' +
          '<option value="simple"' + (row.method === "simple" || !row.method ? " selected" : "") + '>연단리</option>' +
          '<option value="compoundYear"' + (row.method === "compoundYear" ? " selected" : "") + '>연복리</option>' +
          '<option value="compoundMonth"' + (row.method === "compoundMonth" ? " selected" : "") + '>월복리</option>' +
        '</select>';

      wrap.querySelectorAll("input").forEach(function (input) {
        input.addEventListener("input", function () {
          row[input.getAttribute("data-field")] = input.type === "number"
            ? (input.value === "" ? "" : parseFloat(input.value))
            : input.value;
          saveRows();
          renderReport();
        });
      });
      wrap.querySelector('[data-field="method"]').addEventListener("change", function (e) {
        row.method = e.target.value;
        saveRows();
        renderReport();
      });
      wrap.querySelector('[data-action="delete"]').addEventListener("click", function () {
        state.rows = state.rows.filter(function (r) { return r.id !== row.id; });
        saveRows();
        renderRows();
        renderReport();
      });

      el.newProductRows.appendChild(wrap);
    });
  }

  function addRow(preset) {
    state.rows.push(Object.assign({ id: state.nextId++, label: "", years: "", rate: "", method: "simple" }, preset || {}));
  }

  // ---------- 계산 유틸 ----------

  // 이자계산방식(단리/연복리/월복리)에 따른 성장계수. r=연이율(소수), t=기간(년)
  function growthFactor(method, r, t) {
    if (method === "simple") return 1 + r * t;
    if (method === "compoundMonth") return Math.pow(1 + r / 12, 12 * t);
    return Math.pow(1 + r, t); // compoundYear (기본값)
  }

  function methodLabel(method) {
    if (method === "simple") return "연단리";
    if (method === "compoundMonth") return "월복리";
    return "연복리";
  }

  // 명세일자 이후 실제 인출 이력을 반영해 "오늘 기준 실제 잔액"을 재구성한다.
  // 보수적으로 인출액은 항상 원금에서 먼저 차감된 것으로 간주한다(=남는 순원금이
  // 작아지고, 그만큼 이자 비중이 커져서 중도해지 패널티 계산 시 더 낮은 금액이 나온다).
  function gatherWithdrawalEvents(withdrawals) {
    return withdrawals.map(function (w) {
      return { date: parseDateUTC(w.date), amount: parseAmountStr(w.amount) };
    }).filter(function (e) {
      return e.date && e.amount !== null && e.amount > 0;
    });
  }

  // 납입원금을 직접 입력하지 않았을 때, 적립금을 "계약일(명세일자 입력칸)"까지 거꾸로
  // 되감아서 "오늘 기준 순원금"을 추정한다. 적립금이 정확히 "언제 시점" 값인지(=되감기
  // 시작점)는 두 가지 경우가 있다:
  // - 표 형식 자동입력처럼 적립금기준일자가 명세일자와 별도로(더 뒤에) 주어졌으면, 적립금은
  //   그 적립금기준일자 시점 값이 확실하므로 거기서부터 계약일까지 되감는다.
  // - 적립금기준일자를 따로 못 구해서 명세일자와 같은 경우엔, 실제로는 RM이 최근/오늘 기준
  //   적립금을 그냥 넣은 것으로 보고(=명세일자 시점 값이라고 단정할 근거가 없음) 오늘부터
  //   계약일까지 되감는다 — 그래야 계약일~오늘 전체 기간만큼 이자를 인식해서 추정한다.
  // 되감는 구간에 실제 인출 이력이 있으면, 되감기 시작점에서 뒤에서부터 순서대로 그
  // 시점까지의 성장을 되돌리고 인출액을 다시 더해준 뒤 계속 계약일까지 되감는다(=인출이
  // 없었다면 그만큼 더 컸을 잔액을 복원) — 그래야 인출이 있었던 상품도 정확한 납입원금이
  // 나온다. 계약일 시점 원금이 나오면, 계약일~오늘 전체 기간의 인출액 합계를 그대로 빼서
  // "오늘 기준 순원금"으로 되돌린다(순원금은 이자가 안 붙고 인출된 만큼만 줄어드는 것으로 본다).
  function estimateNetPrincipalToday(c, r, events) {
    var anchor = c.start.getTime() !== c.contractStart.getTime() ? c.start : c.today;

    var histEvents = events
      .filter(function (e) { return e.date.getTime() >= c.contractStart.getTime() && e.date.getTime() < anchor.getTime(); })
      .sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });

    var v = c.principal;
    var segEnd = anchor;
    for (var i = histEvents.length - 1; i >= 0; i--) {
      var e = histEvents[i];
      var segYears = Math.max(0, yearsBetween(e.date, segEnd) || 0);
      v = v / growthFactor(c.method, r, segYears) + e.amount;
      segEnd = e.date;
    }
    var firstSegYears = Math.max(0, yearsBetween(c.contractStart, segEnd) || 0);
    var principalAtContractStart = v / growthFactor(c.method, r, firstSegYears);

    var withdrawnSinceContractStart = events
      .filter(function (e) { return e.date.getTime() >= c.contractStart.getTime() && e.date.getTime() <= c.today.getTime(); })
      .reduce(function (s, e) { return s + e.amount; }, 0);
    return Math.max(0, principalAtContractStart - withdrawnSinceContractStart);
  }

  function computeHistory(c, events) {
    if (c.principal === null || c.rate === null || !c.start || !c.today) return null;
    var r = c.rate / 100;
    var validEvents = events
      .filter(function (e) { return e.date.getTime() >= c.start.getTime() && e.date.getTime() <= c.today.getTime(); })
      .sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });

    // "잔액"은 입력한 현재 적립금에서 출발해 그대로 굴린다.
    // "순원금"(패널티 계산 시 원금/이자를 나누는 기준, 오늘 기준)은:
    // - 납입원금(선택)을 입력했으면, 계약일(명세일자) 이후 있었던 인출 이력을 전부 뺀
    //   값을 그대로 사용한다(정확).
    // - 입력하지 않았고 계약일 정보가 있으면, 적립금을 계약일까지 거꾸로 되감아 순원금을
    //   추정한다(그 사이 인출 이력도 반영 — estimateNetPrincipalToday). 계약일 정보가
    //   없으면(극히 드묾) 보수적으로 적립금 전액을 원금으로 본다.
    var netPrincipalEstimated = false;
    var netPrincipal;
    var hasContractStart = c.contractStart && c.contractStart.getTime() < c.today.getTime();
    if (c.contributionPrincipal !== null) {
      var withdrawnSinceContract = hasContractStart
        ? events.filter(function (e) { return e.date.getTime() >= c.contractStart.getTime() && e.date.getTime() <= c.today.getTime(); })
            .reduce(function (s, e) { return s + e.amount; }, 0)
        : validEvents.reduce(function (s, e) { return s + e.amount; }, 0);
      netPrincipal = Math.max(0, c.contributionPrincipal - withdrawnSinceContract);
    } else if (hasContractStart) {
      netPrincipal = estimateNetPrincipalToday(c, r, events);
      netPrincipalEstimated = true;
    } else {
      netPrincipal = c.principal;
      netPrincipalEstimated = true;
    }

    var balance = c.principal;
    var segStart = c.start;

    validEvents.forEach(function (e) {
      var segYears = Math.max(0, yearsBetween(segStart, e.date) || 0);
      balance = Math.max(0, balance * growthFactor(c.method, r, segYears) - e.amount);
      segStart = e.date;
    });

    var lastYears = Math.max(0, yearsBetween(segStart, c.today) || 0);
    balance = balance * growthFactor(c.method, r, lastYears);

    var withdrawnTotal = validEvents.reduce(function (s, e) { return s + e.amount; }, 0);

    return {
      hasEvents: validEvents.length > 0,
      events: validEvents,
      balanceToday: balance,
      netPrincipal: netPrincipal,
      netPrincipalEstimated: netPrincipalEstimated,
      withdrawnTotal: withdrawnTotal
    };
  }

  // ---------- 기존상품(명세) : 여러 건 지원 ----------

  function createProduct() {
    return { id: state.nextId++, withdrawals: [], attachments: [], refs: {}, holdAmountManual: false, principalAsOfDate: null };
  }

  // 상품 카드는 추가될 때 딱 한 번만 DOM에 생성되고, 이후 renderReport()가
  // 아무리 자주 호출돼도 다시 만들어지지 않는다(다시 만들면 입력 중이던
  // 다른 상품 카드의 값이 전부 날아가고 포커스도 끊긴다).
  function addProduct() {
    var p = createProduct();
    state.products.push(p);
    var wrap = document.createElement("div");
    wrap.className = "product-card";
    wrap.innerHTML = productCardMarkup(p, state.products.length - 1);
    el.existingProducts.appendChild(wrap);
    bindProductCard(wrap, p);
    updateProductChrome();
    return p;
  }

  function removeProduct(id) {
    var p = state.products.filter(function (pp) { return pp.id === id; })[0];
    state.products = state.products.filter(function (pp) { return pp.id !== id; });
    if (p && p.refs.card) p.refs.card.remove();
    if (!state.products.length) addProduct();
    updateProductChrome();
    renderReport();
  }

  // 삭제 후 남은 카드들의 "기존상품 N" 번호와, 카드가 1개뿐일 때 삭제 버튼을
  // 숨기는 처리를 다시 계산한다(카드 자체는 다시 그리지 않는다).
  function updateProductChrome() {
    state.products.forEach(function (p, index) {
      if (p.refs.indexEl) p.refs.indexEl.textContent = "기존상품 " + (index + 1);
      if (p.refs.deleteBtn) p.refs.deleteBtn.classList.toggle("hidden", state.products.length <= 1);
    });
  }

  function productCardMarkup(p, index) {
    return (
      '<div class="product-card-header">' +
        '<span class="product-index">기존상품 ' + (index + 1) + '</span>' +
        '<input type="text" class="product-label-input" data-field="label" placeholder="상품명(예: A상품, 삼성생명 IRP) — 선택" />' +
        '<button type="button" class="btn small danger" data-action="delete-product">삭제</button>' +
      '</div>' +

      '<div class="product-subsection attachment-subsection">' +
        '<h4>해지패널티 계산 자료 첨부(선택) — 먼저 올리면 아래 항목이 자동으로 채워집니다</h4>' +
        '<p class="hint">당사 시스템에서 나오는 해지패널티 계산 자료를 첨부하면 아래 계산기 항목(적립금·날짜·금리 등)을 자동으로 인식해서 채워줍니다. 엑셀 파일(.xlsx/.xls/.csv) 또는 상품설명서 PDF를 지원하며, 여러 개 첨부할 수 있습니다. 파일은 서버로 전송되지 않고 이 화면 안에서만 처리됩니다. 자동으로 채워진 값은 아래에서 언제든 직접 수정할 수 있습니다.</p>' +
        '<input type="file" accept=".xlsx,.xls,.csv,.pdf" data-field="attachmentFile" multiple />' +
        '<div class="autofill-summary" data-role="autofillSummary"></div>' +
        '<div class="attachment-list" data-role="attachmentList"></div>' +
      '</div>' +

      '<div class="mapping-grid">' +
        '<label>현재 적립금(원)<input type="text" data-field="principal" placeholder="예: 100,000,000" /></label>' +
        '<label>납입원금(선택 — 알고 있으면 해지패널티 계산이 더 정확해집니다. 모르면 비워두세요)<input type="text" data-field="contributionPrincipal" /></label>' +
        '<div class="two-col">' +
          '<label>명세일자<input type="text" data-field="startDate" /></label>' +
          '<label>만기일<input type="text" data-field="maturityDate" /></label>' +
        '</div>' +
        '<div class="term-quick">' +
          '<span class="term-quick-label">만기일 빠른 설정(명세일자 + 기간, 직접입력도 그대로 가능):</span>' +
          '<div class="term-quick-buttons">' +
            '<button type="button" class="btn small term-quick-btn" data-term-years="1">1년</button>' +
            '<button type="button" class="btn small term-quick-btn" data-term-years="2">2년</button>' +
            '<button type="button" class="btn small term-quick-btn" data-term-years="2.5">2.5년</button>' +
            '<button type="button" class="btn small term-quick-btn" data-term-years="3">3년</button>' +
            '<button type="button" class="btn small term-quick-btn" data-term-years="5">5년</button>' +
          '</div>' +
        '</div>' +
        '<div class="two-col">' +
          '<label>약정금리(연 %)<input type="number" data-field="contractRate" min="0" step="0.01" placeholder="예: 3.5" /></label>' +
          '<label>이자계산방식' +
            '<select data-field="method">' +
              '<option value="compoundYear" selected>연복리</option>' +
              '<option value="simple">연단리</option>' +
              '<option value="compoundMonth">월복리</option>' +
            '</select>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<p class="hint" data-role="periodSummary"></p>' +

      '<div class="withdrawal-history">' +
        '<p class="hint"><strong>중간인출 이력(선택)</strong> — 명세일자 이후 퇴직금 등으로 실제 인출된 금액이 있으면 추가하세요. 있으면 "만기까지 유지 시"와 "중도해지 시" 계산에 자동 반영됩니다(보수적으로 원금에서 먼저 차감되는 것으로 계산).</p>' +
        '<div data-role="withdrawalRows"></div>' +
        '<button type="button" class="btn small" data-action="add-withdrawal">+ 인출 이력 추가</button>' +
        '<p class="hint" data-role="historySummary"></p>' +
      '</div>' +

      '<div class="product-subsection">' +
        '<h4>이 상품을 만기까지 유지할 경우</h4>' +
        '<label>만기 시 예상 수령액(원)<input type="text" data-field="holdAmount" placeholder="시스템 조회값 또는 아래 참고값 사용" /></label>' +
        '<p class="hint">아래에서 이자계산방식을 골라 사용하세요(기본값 연복리). 고르면 위 "이자계산방식"도 함께 바뀝니다.</p>' +
        '<div class="suggest-list">' +
          '<div class="suggest-row"><span class="suggest-label">연단리</span><span class="suggest-value" data-role="suggestSimple">-</span><button type="button" class="btn small suggest-use-btn" data-method="simple">사용</button></div>' +
          '<div class="suggest-row"><span class="suggest-label">연복리</span><span class="suggest-value" data-role="suggestCompoundYear">-</span><button type="button" class="btn small suggest-use-btn" data-method="compoundYear">사용</button></div>' +
          '<div class="suggest-row"><span class="suggest-label">월복리</span><span class="suggest-value" data-role="suggestCompoundMonth">-</span><button type="button" class="btn small suggest-use-btn" data-method="compoundMonth">사용</button></div>' +
        '</div>' +
      '</div>' +

      '<div class="product-subsection">' +
        '<h4>이 상품의 중도해지 패널티</h4>' +
        '<p class="hint">당사 상품처럼 해지패널티/해지적립금을 정확히 알 수 있으면 "직접입력", 타사 신탁상품처럼 "중도해지 시 적용이율이 약정금리의 80%" 식으로만 아는 경우 "적용이율 비율"을 사용하세요.</p>' +
        '<div class="radio-row">' +
          '<label><input type="radio" name="penaltyMode-' + p.id + '" data-field="penaltyMode" value="direct" checked /> 해지적립금 직접입력</label>' +
          '<label><input type="radio" name="penaltyMode-' + p.id + '" data-field="penaltyMode" value="ratio" /> 적용이율 비율로 계산</label>' +
        '</div>' +
        '<div class="mapping-grid" data-role="directModeFields">' +
          '<label>해지적립금(패널티 차감 후, 재예치 가능 금액, 원)<input type="text" data-field="directCancelAmount" /></label>' +
          '<label>해지패널티 금액(원) — 선택, 참고용<input type="text" data-field="directPenaltyAmount" /></label>' +
        '</div>' +
        '<p class="hint" data-role="directModeFutureNote"></p>' +
        '<div class="mapping-grid hidden" data-role="ratioModeFields">' +
          '<label>중도해지 시 적용이율 비율(%, 약정금리 대비)<input type="number" data-field="appliedRatePct" min="0" max="100" step="1" placeholder="예: 80" /></label>' +
          '<p class="hint" data-role="ratioModeCalc"></p>' +
        '</div>' +
        '<p class="result-line">해지적립금(재예치 원금): <strong data-role="cancelAmountResult">-</strong></p>' +
      '</div>'
    );
  }

  function renderProductWithdrawalRows(p) {
    var container = p.refs.withdrawalRowsEl;
    container.innerHTML = "";
    p.withdrawals.forEach(function (row) {
      var wrap = document.createElement("div");
      wrap.className = "withdrawal-row";
      wrap.innerHTML =
        '<input type="text" data-field="date" placeholder="인출일 YYYY.MM.DD" value="' + escapeAttr(row.date) + '" />' +
        '<input type="text" data-field="amount" placeholder="인출금액(원)" value="' + escapeAttr(row.amount) + '" />' +
        '<button type="button" class="btn small danger" data-action="delete">삭제</button>';

      var dateInput = wrap.querySelector('[data-field="date"]');
      var amountInput = wrap.querySelector('[data-field="amount"]');
      bindDateMask(dateInput, amountInput);
      bindAmountMask(amountInput);

      wrap.querySelectorAll("input").forEach(function (input) {
        input.addEventListener("input", function () {
          row[input.getAttribute("data-field")] = input.value;
          renderReport();
        });
      });
      wrap.querySelector('[data-action="delete"]').addEventListener("click", function () {
        p.withdrawals = p.withdrawals.filter(function (r) { return r.id !== row.id; });
        renderProductWithdrawalRows(p);
        renderReport();
      });

      container.appendChild(wrap);
    });
  }

  function updateProductPenaltyModeUI(p) {
    var refs = p.refs;
    var mode = refs.penaltyModeRatio.checked ? "ratio" : "direct";
    refs.directModeFields.classList.toggle("hidden", mode !== "direct");
    refs.ratioModeFields.classList.toggle("hidden", mode !== "ratio");
  }

  function bindProductCard(wrap, p) {
    var refs = p.refs;
    refs.card = wrap;
    refs.indexEl = wrap.querySelector('.product-index');
    refs.deleteBtn = wrap.querySelector('[data-action="delete-product"]');
    refs.labelInput = wrap.querySelector('[data-field="label"]');
    refs.principalInput = wrap.querySelector('[data-field="principal"]');
    refs.contributionPrincipalInput = wrap.querySelector('[data-field="contributionPrincipal"]');
    refs.startDateInput = wrap.querySelector('[data-field="startDate"]');
    refs.maturityDateInput = wrap.querySelector('[data-field="maturityDate"]');
    refs.contractRateInput = wrap.querySelector('[data-field="contractRate"]');
    refs.methodSelect = wrap.querySelector('[data-field="method"]');
    refs.periodSummaryEl = wrap.querySelector('[data-role="periodSummary"]');
    refs.withdrawalRowsEl = wrap.querySelector('[data-role="withdrawalRows"]');
    refs.historySummaryEl = wrap.querySelector('[data-role="historySummary"]');
    refs.holdAmountInput = wrap.querySelector('[data-field="holdAmount"]');
    refs.suggestSimpleEl = wrap.querySelector('[data-role="suggestSimple"]');
    refs.suggestCompoundYearEl = wrap.querySelector('[data-role="suggestCompoundYear"]');
    refs.suggestCompoundMonthEl = wrap.querySelector('[data-role="suggestCompoundMonth"]');
    refs.penaltyModeDirect = wrap.querySelector('[data-field="penaltyMode"][value="direct"]');
    refs.penaltyModeRatio = wrap.querySelector('[data-field="penaltyMode"][value="ratio"]');
    refs.directModeFields = wrap.querySelector('[data-role="directModeFields"]');
    refs.ratioModeFields = wrap.querySelector('[data-role="ratioModeFields"]');
    refs.directCancelAmountInput = wrap.querySelector('[data-field="directCancelAmount"]');
    refs.directPenaltyAmountInput = wrap.querySelector('[data-field="directPenaltyAmount"]');
    refs.appliedRatePctInput = wrap.querySelector('[data-field="appliedRatePct"]');
    refs.ratioModeCalcEl = wrap.querySelector('[data-role="ratioModeCalc"]');
    refs.directModeFutureNoteEl = wrap.querySelector('[data-role="directModeFutureNote"]');
    refs.cancelAmountResultEl = wrap.querySelector('[data-role="cancelAmountResult"]');
    refs.attachmentFileInput = wrap.querySelector('[data-field="attachmentFile"]');
    refs.attachmentListEl = wrap.querySelector('[data-role="attachmentList"]');
    refs.autofillSummaryEl = wrap.querySelector('[data-role="autofillSummary"]');

    bindDateMask(refs.startDateInput, refs.maturityDateInput);
    bindDateMask(refs.maturityDateInput, null);
    [refs.principalInput, refs.contributionPrincipalInput, refs.holdAmountInput, refs.directCancelAmountInput, refs.directPenaltyAmountInput].forEach(bindAmountMask);

    [refs.labelInput, refs.principalInput, refs.contributionPrincipalInput, refs.startDateInput, refs.maturityDateInput,
      refs.contractRateInput, refs.directCancelAmountInput, refs.directPenaltyAmountInput, refs.appliedRatePctInput
    ].forEach(function (input) {
      input.addEventListener("input", renderReport);
    });
    // 이 칸을 직접 입력하기 시작하면(시스템 조회값 등) 이후로는 이자계산방식을 바꿔도
    // 자동으로 덮어쓰지 않는다. 비우면 다시 선택된 이자계산방식 값으로 자동 채워진다.
    refs.holdAmountInput.addEventListener("input", function () {
      p.holdAmountManual = refs.holdAmountInput.value.trim() !== "";
      renderReport();
    });
    refs.methodSelect.addEventListener("change", renderReport);
    [refs.penaltyModeDirect, refs.penaltyModeRatio].forEach(function (radio) {
      radio.addEventListener("change", function () {
        updateProductPenaltyModeUI(p);
        renderReport();
      });
    });

    refs.deleteBtn.addEventListener("click", function () {
      if (confirm("이 기존상품을 삭제할까요?")) removeProduct(p.id);
    });

    wrap.querySelectorAll(".term-quick-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var start = parseDateUTC(refs.startDateInput.value);
        if (!start) {
          alert("먼저 명세일자를 입력해주세요.");
          return;
        }
        var years = parseFloat(btn.getAttribute("data-term-years"));
        refs.maturityDateInput.value = formatDateUTC(addYears(start, years));
        renderReport();
      });
    });

    wrap.querySelectorAll(".suggest-use-btn").forEach(function (btn) {
      var method = btn.getAttribute("data-method");
      btn.addEventListener("click", function () {
        refs.methodSelect.value = method;
        p.holdAmountManual = false;
        var c = gatherProductCustomer(p);
        var s = updateHoldSuggestion(p, c);
        if (s && s[method] !== null && !isNaN(s[method])) {
          setAmountValue(refs.holdAmountInput, s[method]);
          renderReport();
        }
      });
    });

    wrap.querySelector('[data-action="add-withdrawal"]').addEventListener("click", function () {
      p.withdrawals.push({ id: state.nextId++, date: "", amount: "" });
      renderProductWithdrawalRows(p);
      renderReport();
    });

    refs.attachmentFileInput.addEventListener("change", function () {
      var files = refs.attachmentFileInput.files ? Array.prototype.slice.call(refs.attachmentFileInput.files) : [];
      refs.attachmentFileInput.value = "";
      if (!files.length) return;

      // 명세엑셀 + 해지패널티엑셀 + 상품설명서 PDF처럼 여러 파일을 한 번에 선택해도
      // 순서대로 하나씩 처리한다 — 카드 병합 로직이 "이 카드에 이미 어떤 상품이
      // 들어있는지"를 참고하므로, 동시에 처리하면 서로의 결과를 못 보고 카드가
      // 중복 생성될 수 있다. 처리 순서도 중요하다: 상품설명서(PDF)는 상품명이 이미
      // 카드에 채워져 있어야 어느 카드에 적용할지 매칭할 수 있는데, 파일 선택 창에서
      // 고른 순서가 항상 "엑셀 먼저"라는 보장이 없다(운영체제/선택 방식에 따라
      // 뒤바뀔 수 있음). 그래서 실제 선택 순서와 무관하게 항상 엑셀/CSV(상품명 등을
      // 채움) → PDF(그 상품명을 보고 매칭) 순으로 정렬해서 처리한다.
      var typeOrder = { xlsx: 0, xls: 0, csv: 0, pdf: 1 };
      files.sort(function (a, b) {
        function rank(f) {
          var ext = (/\.([^.]+)$/.exec(f.name) || [])[1];
          return typeOrder.hasOwnProperty(ext && ext.toLowerCase()) ? typeOrder[ext.toLowerCase()] : 1;
        }
        return rank(a) - rank(b);
      });

      var fileQueueIdx = 0;
      function processNextQueuedFile() {
        if (fileQueueIdx >= files.length) return;
        var file = files[fileQueueIdx++];
        processOneAttachmentFile(file, processNextQueuedFile);
      }
      processNextQueuedFile();
    });

    function processOneAttachmentFile(file, done) {
      if (/\.(xlsx|xls|csv)$/i.test(file.name)) {
        if (typeof XLSX === "undefined") {
          alert("엑셀을 읽는 기능을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.");
          done();
          return;
        }
        parseSpreadsheetFile(file, function (err, sheets) {
          if (err || !sheets || !sheets.length) {
            alert("이 파일을 열 수 없습니다. 비밀번호가 걸려 있거나 지원하지 않는 형식일 수 있습니다.");
            done();
            return;
          }

          // 1) "헤더 한 줄 + 상품별 데이터행" 표 형식 먼저 시도(당사 시스템 다건 조회 자료 등).
          //    행이 여러 개면, 상품명+명세일자가 이미 있는 카드와 같은 행은 그 기존 카드에
          //    합쳐 넣는다(같은 상품을 "상품운용현황"과 "해지패널티 계산자료" 두 파일로
          //    나눠 올려도 카드가 쪼개지지 않도록). 나머지는 새 상품카드를 자동으로 추가해
          //    채운다. 이 카드(p)가 이미 다른 상품으로 채워져 있으면, 매칭되지 않는 행으로
          //    그 내용을 덮어쓰지 않는다 — p가 비어 있을 때만 첫 매칭 없는 행을 채우는 용도로 쓴다.
          var tableRecords = extractTableRecordsFromSheets(sheets);
          if (tableRecords.length) {
            var pIsBlank = normalizeLabelText(refs.labelInput.value) === "";
            var pUsedForTable = false;
            var targets = tableRecords.map(function (rec) {
              var existing = findMatchingProductForRecord(rec);
              var targetProduct;
              if (existing) {
                targetProduct = existing;
              } else if (pIsBlank && !pUsedForTable) {
                targetProduct = p;
                pUsedForTable = true;
              } else {
                targetProduct = addProduct();
              }
              var applied = applyTableRecordToProduct(targetProduct, rec);
              updateProductPenaltyModeUI(targetProduct);
              return { product: targetProduct, applied: applied, merged: !!existing };
            });

            // 첨부파일 자체는 항상 업로드한 이 카드(p)에 기록해서, 이 카드에서 첨부 목록이
            // 계속 쌓이는 걸 볼 수 있게 한다 — 실제 값이 다른 카드로 갔더라도 마찬가지.
            var pTarget = targets.filter(function (t) { return t.product === p; })[0];
            p.attachments.push({ id: state.nextId++, kind: "excel", name: file.name, sheets: sheets, appliedFields: pTarget ? pTarget.applied : [] });
            renderProductAttachments(p);

            targets.forEach(function (t, idx) {
              renderAutofillSummary(t.product, t.applied, file.name, targets.length, idx, t.merged);
            });

            if (!pTarget && p.refs.autofillSummaryEl) {
              var otherLabels = targets.map(function (t) { return t.product.refs.labelInput.value; }).filter(Boolean).join(", ");
              p.refs.autofillSummaryEl.innerHTML =
                '<div class="autofill-note autofill-ok"><p><strong>"' + escapeHtml(file.name) + '"에서 인식한 상품(' + escapeHtml(otherLabels) + ')이 이 카드와는 달라서, 기존/새 카드로 나눠 반영했습니다.</strong> 이 카드의 내용은 바뀌지 않았습니다.</p></div>';
            }
            updateProductChrome();
            renderReport();
            done();
            return;
          }

          // 2) 표 형식이 아니면 "라벨: 값" 형식으로 시도(타사 상품 캡처 자료 등).
          var extracted = extractFieldsFromSheets(sheets);
          var applied = applyExtractedFields(p, extracted);
          p.attachments.push({ id: state.nextId++, kind: "excel", name: file.name, sheets: sheets, appliedFields: applied });
          renderProductAttachments(p);
          renderAutofillSummary(p, applied, file.name);
          updateProductPenaltyModeUI(p);
          renderReport();
          done();
        });
        return;
      }

      if (/\.pdf$/i.test(file.name)) {
        if (typeof pdfjsLib === "undefined") {
          alert("PDF를 읽는 기능을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.");
          done();
          return;
        }
        extractPdfPenaltyClauses(file, function (err, result) {
          if (err) {
            alert("이 PDF를 열 수 없습니다. 비밀번호가 걸려 있거나 지원하지 않는 형식일 수 있습니다.");
            done();
            return;
          }

          // 상품설명서 PDF는 보통 단체 전체에 공통으로 쓰는 자료라, 이 카드 하나에만
          // 적용하지 않고 화면에 있는 모든 상품카드를 훑어서 상품명이 (정확히 또는
          // 유일하게) 일치하는 카드마다 자동으로 적용한다. 그래야 "삼성화재" 명세가
          // 여러 건이어도 PDF를 한 번만 올리면 전부 반영된다. 안전을 위해, 카드가
          // 여러 개와 겹치거나 상품명이 비어 있으면 그 카드는 건너뛰고 자동 적용하지 않는다.
          var appliedResults = [];
          state.products.forEach(function (prod) {
            var c = gatherProductCustomer(prod);
            var matchedTier = null;
            var elapsedMonths = null;
            if (result.breakpoints && result.breakpoints.length && c.elapsedYears !== null) {
              elapsedMonths = Math.max(0, c.elapsedYears) * 12;
              var hasTags = result.breakpoints.some(function (b) { return b.productName; });
              var applicableBreakpoints = !hasTags ? result.breakpoints : result.breakpoints.filter(function (b) {
                return !b.productName || labelMatchesCandidateName(prod.refs.labelInput.value, b.productName, true);
              });
              matchedTier = matchPenaltyTier(applicableBreakpoints, elapsedMonths);
            }

            var matchedFlatRatio = null;
            var flatMatchReason = null;
            if (!matchedTier && result.flatRatios && result.flatRatios.length) {
              var flatPcts = distinctFlatPcts(result.flatRatios);
              if (flatPcts.length === 1) {
                matchedFlatRatio = result.flatRatios[0];
                flatMatchReason = "unique";
              } else {
                var picked = pickUniqueCandidateForLabel(prod.refs.labelInput.value, result.flatRatios);
                if (picked) {
                  matchedFlatRatio = picked;
                  flatMatchReason = "label";
                }
              }
            }

            if (!matchedTier && !matchedFlatRatio) return;

            prod.refs.penaltyModeRatio.checked = true;
            updateProductPenaltyModeUI(prod);
            prod.refs.appliedRatePctInput.value = matchedTier ? matchedTier.pct : matchedFlatRatio.pct;

            prod.attachments.push({
              id: state.nextId++, kind: "pdf", name: file.name,
              snippets: prod === p ? result.snippets : [],
              pageCount: result.pageCount, breakpoints: result.breakpoints, matchedTier: matchedTier,
              flatRatios: result.flatRatios, matchedFlatRatio: matchedFlatRatio, flatMatchReason: flatMatchReason
            });
            renderProductAttachments(prod);
            appliedResults.push({ product: prod, matchedTier: matchedTier, matchedFlatRatio: matchedFlatRatio, flatMatchReason: flatMatchReason, elapsedMonths: elapsedMonths });
          });

          var ownResult = appliedResults.filter(function (a) { return a.product === p; })[0];
          if (!ownResult) {
            // p 자신은 매칭되지 않았으면(상품명이 없거나 PDF 상품명과 안 맞으면), 첨부
            // 자체는 기록해서 첨부 목록/원문 스니펫은 볼 수 있게 한다(매칭 안 됨 = 값 채움 없음).
            p.attachments.push({
              id: state.nextId++, kind: "pdf", name: file.name, snippets: result.snippets,
              pageCount: result.pageCount, breakpoints: result.breakpoints, matchedTier: null,
              flatRatios: result.flatRatios, matchedFlatRatio: null, flatMatchReason: null
            });
            renderProductAttachments(p);
          }
          renderPdfSnippetsSummary(p, result, file.name,
            ownResult ? ownResult.matchedTier : null,
            ownResult ? ownResult.elapsedMonths : null,
            ownResult ? ownResult.matchedFlatRatio : null,
            ownResult ? ownResult.flatMatchReason : null);

          var otherApplied = appliedResults.filter(function (a) { return a.product !== p; });
          if (otherApplied.length && p.refs.autofillSummaryEl) {
            var otherListHtml = otherApplied.map(function (a) {
              var pct = a.matchedTier ? a.matchedTier.pct : a.matchedFlatRatio.pct;
              return "<li>" + escapeHtml(a.product.refs.labelInput.value || "(상품명 없음)") + " → " + pct + "%</li>";
            }).join("");
            var otherNoteHtml =
              '<div class="autofill-note autofill-ok">' +
                "<p><strong>같은 상품설명서를 상품명이 일치하는 다른 카드 " + otherApplied.length + "개에도 자동으로 적용했습니다:</strong></p>" +
                "<ul>" + otherListHtml + "</ul>" +
              "</div>";
            p.refs.autofillSummaryEl.innerHTML = otherNoteHtml + p.refs.autofillSummaryEl.innerHTML;
          }

          renderReport();
          done();
        });
        return;
      }

      alert("엑셀 파일(.xlsx/.xls/.csv) 또는 PDF만 첨부할 수 있습니다.");
      done();
    }

    renderProductWithdrawalRows(p);
    renderProductAttachments(p);
  }

  function renderProductAttachments(p) {
    var container = p.refs.attachmentListEl;
    container.innerHTML = "";
    p.attachments.forEach(function (a) {
      var row = document.createElement("div");
      row.className = "attachment-row";
      var thumbHtml = a.kind === "excel"
        ? '<span class="attachment-thumb attachment-thumb-excel">표</span>'
        : '<span class="attachment-thumb attachment-thumb-pdf">PDF</span>';
      var appliedCount = (a.appliedFields && a.appliedFields.length) || 0;
      var nameHtml = a.kind === "excel"
        ? escapeHtml(a.name) + '<span class="attachment-meta">' + a.sheets.length + '개 시트 · ' + a.sheets.reduce(function (s, sh) { return s + sh.rows.length; }, 0) + '행 인식됨' +
          (appliedCount ? ' · ' + appliedCount + '개 항목 자동입력됨' : '') + '</span>'
        : escapeHtml(a.name) + '<span class="attachment-meta">' + a.pageCount + '쪽 중 중도해지 관련 문구 ' + a.snippets.length + '건 찾음' +
          (a.matchedTier ? ' · 적용이율 비율 ' + a.matchedTier.pct + '% 자동설정됨' : '') + '</span>';
      row.innerHTML = thumbHtml +
        '<span class="attachment-name">' + nameHtml + '</span>' +
        '<button type="button" class="btn small danger" data-action="delete">삭제</button>';
      row.querySelector('[data-action="delete"]').addEventListener("click", function () {
        p.attachments = p.attachments.filter(function (x) { return x.id !== a.id; });
        renderProductAttachments(p);
        if (!p.attachments.length && p.refs.autofillSummaryEl) p.refs.autofillSummaryEl.innerHTML = "";
        renderReport();
      });
      container.appendChild(row);
    });
  }

  // ---------- 엑셀/CSV 첨부 파싱 ----------

  var ATTACHMENT_MAX_ROWS = 200;
  var ATTACHMENT_MAX_COLS = 30;

  function parseSpreadsheetFile(file, callback) {
    var isCsv = /\.csv$/i.test(file.name);
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var wb = isCsv
          ? XLSX.read(reader.result, { type: "string" })
          : XLSX.read(new Uint8Array(reader.result), { type: "array" });
        var sheets = wb.SheetNames.map(function (name) {
          var ws = wb.Sheets[name];
          var rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "", raw: false });
          var truncated = rows.length > ATTACHMENT_MAX_ROWS;
          rows = rows.slice(0, ATTACHMENT_MAX_ROWS).map(function (row) {
            var colsTruncated = row.length > ATTACHMENT_MAX_COLS;
            var sliced = row.slice(0, ATTACHMENT_MAX_COLS);
            if (colsTruncated) truncated = true;
            return sliced;
          });
          return { name: name, rows: rows, truncated: truncated };
        }).filter(function (s) { return s.rows.length > 0; });
        callback(null, sheets);
      } catch (e) {
        callback(e, null);
      }
    };
    reader.onerror = function () { callback(new Error("read failed"), null); };
    if (isCsv) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  }

  // ---------- 첨부 엑셀/CSV에서 항목 자동 인식 ----------

  var FIELD_EXTRACT_SPECS = [
    { field: "directPenaltyAmount", type: "amount", label: "해지패널티 금액", keywords: ["해지패널티금액", "해지패널티", "중도해지패널티", "패널티금액"] },
    { field: "directCancelAmount", type: "amount", label: "해지적립금(재예치 원금)", keywords: ["해지적립금", "해지후적립금", "해지환급금", "재예치가능금액", "재예치원금", "중도해지적립금"] },
    { field: "principal", type: "amount", label: "현재 적립금", keywords: ["현재적립금", "적립금현황", "평가금액", "적립금"] },
    { field: "contributionPrincipal", type: "amount", label: "납입원금", keywords: ["납입원금", "납입원본", "납입금액"] },
    { field: "startDate", type: "date", label: "명세일자", keywords: ["명세일자", "산출기준일", "기준일자", "명세일"] },
    { field: "maturityDate", type: "date", label: "만기일", keywords: ["만기일자", "만기일"] },
    { field: "contractRate", type: "rate", label: "약정금리", keywords: ["약정금리", "계약금리", "적용금리"] }
  ];

  function normalizeLabelText(v) {
    return String(v === undefined || v === null ? "" : v).replace(/\s+/g, "").trim();
  }

  function parseFlexibleDateToMasked(v) {
    var s = String(v === undefined || v === null ? "" : v).trim();
    if (!s) return null;

    // YYYY.MM.DD / YYYY-MM-DD / YYYY/MM/DD / YYYY년 MM월 DD일
    var m = /(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/.exec(s);
    if (m) {
      var y = m[1], mo = ("0" + m[2]).slice(-2), d = ("0" + m[3]).slice(-2);
      if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) return y + "." + mo + "." + d;
    }

    // M/D/YY 또는 M/D/YYYY (엑셀 날짜 셀이 서식 변환되어 이 형식으로 나오는 경우가 많음)
    var m2 = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
    if (m2) {
      var mo3 = Number(m2[1]), d3 = Number(m2[2]), yRaw = m2[3];
      var y3 = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
      if (mo3 >= 1 && mo3 <= 12 && d3 >= 1 && d3 <= 31) {
        return y3 + "." + ("0" + mo3).slice(-2) + "." + ("0" + d3).slice(-2);
      }
    }

    var digits = s.replace(/\D/g, "");
    if (digits.length === 8) {
      var y2 = digits.slice(0, 4), mo2 = digits.slice(4, 6), d2 = digits.slice(6, 8);
      if (Number(mo2) >= 1 && Number(mo2) <= 12 && Number(d2) >= 1 && Number(d2) <= 31) return y2 + "." + mo2 + "." + d2;
    }
    return null;
  }

  // "이율보증형(2.5년)"처럼 상품명에 기간이 포함된 경우, 그 기간을 뽑아낸다.
  function inferTermYearsFromLabel(label) {
    if (!label) return null;
    var m = /(\d+(\.\d+)?)\s*년/.exec(String(label));
    if (!m) return null;
    var years = parseFloat(m[1]);
    return isNaN(years) ? null : years;
  }

  // 시트들의 셀을 스캔해 라벨 텍스트를 찾고, 오른쪽/아래 인접 셀을 값으로 추출합니다.
  function extractFieldsFromSheets(sheets) {
    var results = {};
    var consumed = {};

    FIELD_EXTRACT_SPECS.forEach(function (spec) {
      var found = null;
      for (var si = 0; si < sheets.length && !found; si++) {
        var rows = sheets[si].rows;
        for (var ri = 0; ri < rows.length && !found; ri++) {
          var row = rows[ri];
          for (var ci = 0; ci < row.length && !found; ci++) {
            var key = si + "-" + ri + "-" + ci;
            if (consumed[key]) continue;
            var norm = normalizeLabelText(row[ci]);
            if (!norm) continue;
            var matched = spec.keywords.some(function (kw) { return norm.indexOf(kw) !== -1; });
            if (!matched) continue;

            var rawValue = null;
            if (ci + 1 < row.length && normalizeLabelText(row[ci + 1]) !== "") {
              rawValue = row[ci + 1];
            } else if (rows[ri + 1] && rows[ri + 1][ci] !== undefined && normalizeLabelText(rows[ri + 1][ci]) !== "") {
              rawValue = rows[ri + 1][ci];
            }
            if (rawValue === null) continue;

            var value = null;
            if (spec.type === "amount") {
              var digits = String(rawValue).replace(/[^\d]/g, "");
              if (digits) value = parseInt(digits, 10);
            } else if (spec.type === "date") {
              value = parseFlexibleDateToMasked(rawValue);
            } else if (spec.type === "rate") {
              var rm = /(\d+(\.\d+)?)/.exec(String(rawValue));
              if (rm) value = parseFloat(rm[1]);
            }
            if (value === null || value === undefined || (typeof value === "number" && isNaN(value))) continue;

            consumed[key] = true;
            found = { field: spec.field, label: spec.label, value: value };
          }
        }
      }
      if (found) results[spec.field] = found;
    });

    return results;
  }

  // ---------- 첨부 엑셀/CSV의 "표(헤더+데이터행)" 형식 인식 ----------
  // 당사 시스템 등에서 뽑는 자료는 라벨:값 쌍이 아니라 "가입자번호 | 상품명 | 명세일자 | 적립금 | ..."
  // 처럼 헤더 한 줄 + 상품별 데이터행 여러 줄로 되어 있는 경우가 많다. 이 경우 헤더의 열 위치를
  // 찾아서, 데이터행 하나당 기존상품 한 건으로 처리한다(행이 여러 개면 상품카드도 여러 개로 자동 추가).
  var TABLE_HEADER_FIELD_SPECS = [
    { field: "label", type: "text", displayLabel: "상품명", headers: ["상품명"] },
    // "명세일자"는 계약(명세) 체결일 — 상품명의 기간과 더해 만기일을 계산하는 용도로만 쓰고,
    // 계산기의 "명세일자" 입력칸에는 넣지 않는다(적립금의 산정 기준일과 다를 수 있어서 그대로
    // 넣으면 오늘까지의 경과이자가 이중으로 계산되는 문제가 있었다). 계산기 입력칸에는 아래
    // "asOfDate"(적립금기준일자)를 사용한다.
    { field: "contractDate", type: "date", displayLabel: "명세일자(계약일)", headers: ["명세일자"] },
    { field: "asOfDate", type: "date", displayLabel: "적립금기준일자", headers: ["적립금기준일자", "평가기준일", "기준일자", "산출기준일"] },
    // "경과일"(명세일자 이후 지난 일수)만 있고 별도 기준일자 컬럼이 없는 자료(예: 상품운용현황)를 위한 보조 필드.
    // asOfDate가 없을 때만 "명세일자 + 경과일"로 적립금기준일자를 대신 계산하는 데 쓴다.
    { field: "elapsedDays", type: "number", displayLabel: "경과일", headers: ["경과일"] },
    { field: "maturityDate", type: "date", displayLabel: "만기일", headers: ["만기일자", "만기일"] },
    { field: "principal", type: "amount", displayLabel: "현재 적립금", headers: ["적립금", "현재적립금", "평가금액"] },
    { field: "contributionPrincipal", type: "amount", displayLabel: "납입원금", headers: ["납입원금", "납입원본", "가입원금"] },
    { field: "contractRate", type: "rate", displayLabel: "약정금리(명세 적용이율)", headers: ["명세적용이율", "적용이율", "약정금리", "계약금리", "적용금리", "적용이율(단리환산)"] },
    // "3.4% (3.52%)"처럼 괄호 안에 단리환산 참고값이 함께 있는 경우, contractRate는 앞 숫자(실제 적용이율)만
    // 쓰고 원본 텍스트는 이 필드로 따로 받아서 적용 요약에 참고용으로 표시한다(값을 잃어버리지 않도록).
    { field: "contractRateRaw", type: "text", displayLabel: "적용이율 원본", headers: ["적용이율(단리환산)"] },
    { field: "directCancelAmount", type: "amount", displayLabel: "해지적립금(해지환급금)", headers: ["해지환급금", "해지적립금", "해지후적립금", "재예치가능금액"] },
    { field: "directPenaltyAmount", type: "amount", displayLabel: "해지패널티 금액", headers: ["중도해지페널티", "중도해지패널티", "해지패널티", "해지패널티금액", "패널티"] },
    { field: "withdrawalDate", type: "date", displayLabel: "중간인출 일자", headers: ["인출일자", "출금일자", "인출일", "중도인출일자", "중도인출일"] },
    { field: "withdrawalAmount", type: "amount", displayLabel: "중간인출 금액", headers: ["인출금액", "출금액", "인출액", "중도인출금액", "중도인출액"] }
  ];

  function findTableHeaderColumnMap(row) {
    var map = {};
    var matchCount = 0;
    row.forEach(function (cell, ci) {
      var norm = normalizeLabelText(cell);
      if (!norm) return;
      TABLE_HEADER_FIELD_SPECS.forEach(function (spec) {
        if (map[spec.field] !== undefined) return;
        if (spec.headers.indexOf(norm) !== -1) {
          map[spec.field] = ci;
          matchCount++;
        }
      });
    });
    return matchCount >= 3 ? map : null;
  }

  function convertCellValueByType(raw, type) {
    if (raw === undefined || raw === null || String(raw).trim() === "") return null;
    if (type === "text") return String(raw).trim();
    if (type === "amount") {
      var digits = String(raw).replace(/[^\d]/g, "");
      return digits ? parseInt(digits, 10) : null;
    }
    if (type === "date") return parseFlexibleDateToMasked(raw);
    if (type === "rate") {
      var m = /(\d+(\.\d+)?)/.exec(String(raw));
      return m ? parseFloat(m[1]) : null;
    }
    if (type === "number") {
      var n = parseFloat(String(raw).replace(/[^\d.\-]/g, ""));
      return isNaN(n) ? null : n;
    }
    return null;
  }

  // 표 맨 아래에 흔히 붙는 "합계/총계" 행은 실제 상품이 아니므로 상품카드로 만들지 않는다.
  var TABLE_SUMMARY_ROW_LABELS = ["합계", "총계", "소계", "계", "total", "sum"];

  function extractTableRecordsFromSheets(sheets) {
    var records = [];
    sheets.forEach(function (sheet) {
      var rows = sheet.rows;
      for (var ri = 0; ri < rows.length; ri++) {
        var map = findTableHeaderColumnMap(rows[ri]);
        if (!map) continue;
        for (var dr = ri + 1; dr < rows.length; dr++) {
          var row = rows[dr];
          var rec = {};
          var any = false;
          Object.keys(map).forEach(function (field) {
            var spec = TABLE_HEADER_FIELD_SPECS.filter(function (s) { return s.field === field; })[0];
            var val = convertCellValueByType(row[map[field]], spec.type);
            if (val !== null) {
              rec[field] = val;
              any = true;
            }
          });
          if (!any) break;
          if (rec.label && TABLE_SUMMARY_ROW_LABELS.indexOf(normalizeLabelText(String(rec.label)).toLowerCase()) !== -1) continue;
          records.push(rec);
        }
        break; // 시트당 표 하나만 처리
      }
    });
    return records;
  }

  // 표 형식 자료의 한 행(rec)이 이미 화면에 있는 상품카드 중 하나와 같은 상품인지 찾는다.
  // 상품명이 같고(공백 무시), 명세일자가 둘 다 있으면 그것도 같아야 매칭으로 본다 —
  // 상품명만으로는 같은 파일 안의 "동일 상품, 다른 시점 자료" 여러 행을 하나로 잘못
  // 합칠 수 있어서, 명세일자까지 같을 때만 합친다.
  function findMatchingProductForRecord(rec) {
    if (!rec.label) return null;
    var labelNorm = normalizeLabelText(rec.label);
    if (!labelNorm) return null;
    var found = null;
    state.products.some(function (prod) {
      var prodLabelNorm = normalizeLabelText(prod.refs.labelInput.value);
      if (!prodLabelNorm || prodLabelNorm !== labelNorm) return false;
      var prodStart = prod.refs.startDateInput.value;
      if (rec.contractDate && prodStart && rec.contractDate !== prodStart) return false;
      found = prod;
      return true;
    });
    return found;
  }

  function tableRecordToExtracted(rec) {
    var extracted = {};
    TABLE_HEADER_FIELD_SPECS.forEach(function (spec) {
      if (rec[spec.field] !== undefined) {
        extracted[spec.field] = { label: spec.displayLabel, value: rec[spec.field] };
      }
    });
    return extracted;
  }

  // 표 형식 자료(당사 시스템 자료)를 상품카드에 적용한다. 만기일 컬럼이 없어도
  // 상품명에 "OO년"처럼 기간이 들어있으면 "명세일자(계약일)" + 기간으로 만기일을 자동 계산한다.
  // 계산기의 "명세일자" 입력칸에는 실제 명세일자(계약일) 그대로 넣는다(화면에 보이는
  // 값과 원본 자료가 달라 보이면 안 되므로). 대신 "적립금기준일자"는 화면에는 표시하지
  // 않고 내부적으로만 저장해서(product.principalAsOfDate) 경과이자 계산에 쓴다 — 적립금
  // 값 자체가 이미 그 날짜(대개 오늘) 기준이므로, 명세일자를 기준으로 다시 이자를 붙이면
  // "오늘 기준 잔액"과 "만기 예상액"이 이중으로 부풀려지는 문제가 있었다.
  // 당사 보험 상품은 만기 예상액(만기까지 유지 시) 계산에 연복리를 적용한다.
  function applyTableRecordToProduct(targetProduct, rec) {
    var extracted = tableRecordToExtracted(rec);

    if (!extracted.maturityDate && extracted.label && extracted.contractDate) {
      var years = inferTermYearsFromLabel(extracted.label.value);
      if (years) {
        var startD = parseDateUTC(extracted.contractDate.value);
        if (startD) {
          extracted.maturityDate = {
            label: "만기일(상품명 기간 " + years + "년 기준 자동계산)",
            value: formatDateUTC(addYears(startD, years))
          };
        }
      }
    }

    var asOfDateValue = extracted.asOfDate ? extracted.asOfDate.value : null;
    var asOfDateNote = "";
    delete extracted.asOfDate;

    var elapsedDaysValue = extracted.elapsedDays ? extracted.elapsedDays.value : null;
    delete extracted.elapsedDays;
    if (!asOfDateValue && elapsedDaysValue !== null && extracted.contractDate) {
      var contractStartD = parseDateUTC(extracted.contractDate.value);
      if (contractStartD) {
        asOfDateValue = formatDateUTC(new Date(contractStartD.getTime() + elapsedDaysValue * 86400000));
        asOfDateNote = " — 명세일자 + 경과일(" + elapsedDaysValue + "일)로 자동계산";
      }
    }

    var contractRateRawValue = extracted.contractRateRaw ? extracted.contractRateRaw.value : null;
    delete extracted.contractRateRaw;

    var withdrawalDateValue = extracted.withdrawalDate ? extracted.withdrawalDate.value : null;
    var withdrawalAmountValue = extracted.withdrawalAmount ? extracted.withdrawalAmount.value : null;
    delete extracted.withdrawalDate;
    delete extracted.withdrawalAmount;

    var applied = applyExtractedFields(targetProduct, extracted);

    if (contractRateRawValue && contractRateRawValue.indexOf("(") !== -1) {
      applied.forEach(function (a) {
        if (a.field === "contractRate") {
          a.label = a.label + "(원본 표기: " + contractRateRawValue + ")";
        }
      });
    }

    targetProduct.principalAsOfDate = asOfDateValue;
    if (asOfDateValue) {
      applied.push({ field: "asOfDate", label: "적립금기준일자(경과이자 계산 기준, 화면에는 표시 안 됨)" + asOfDateNote, display: asOfDateValue });
    }

    if (withdrawalDateValue && withdrawalAmountValue) {
      targetProduct.withdrawals.push({
        id: state.nextId++,
        date: withdrawalDateValue,
        amount: Math.round(withdrawalAmountValue).toLocaleString("ko-KR")
      });
      renderProductWithdrawalRows(targetProduct);
      applied.push({ field: "withdrawal", label: "중간인출 이력", display: withdrawalDateValue + " / " + formatWon(withdrawalAmountValue) });
    }

    if (targetProduct.refs.methodSelect.value !== "compoundYear") {
      targetProduct.refs.methodSelect.value = "compoundYear";
      applied.push({ field: "method", label: "이자계산방식(보험사 상품 기본값)", display: "연복리" });
    }

    return applied;
  }

  function applyExtractedFields(p, extracted) {
    var refs = p.refs;
    var fieldToInput = {
      label: refs.labelInput,
      principal: refs.principalInput,
      contributionPrincipal: refs.contributionPrincipalInput,
      startDate: refs.startDateInput,
      contractDate: refs.startDateInput,
      maturityDate: refs.maturityDateInput,
      contractRate: refs.contractRateInput,
      directCancelAmount: refs.directCancelAmountInput,
      directPenaltyAmount: refs.directPenaltyAmountInput
    };
    var applied = [];
    Object.keys(extracted).forEach(function (field) {
      var input = fieldToInput[field];
      if (!input) return;
      var item = extracted[field];
      if (field === "startDate" || field === "contractDate" || field === "maturityDate" || field === "contractRate" || field === "label") {
        input.value = item.value;
      } else {
        setAmountValue(input, item.value);
      }
      applied.push({ field: field, label: item.label, display: input.value });
    });
    if (extracted.directCancelAmount || extracted.directPenaltyAmount) {
      refs.penaltyModeDirect.checked = true;
    }
    return applied;
  }

  function renderAutofillSummary(p, applied, fileName, totalRecords, recordIndex, merged) {
    var box = p.refs.autofillSummaryEl;
    if (!box) return;
    var multiNote = "";
    if (totalRecords && totalRecords > 1) {
      multiNote = '<p class="autofill-multi-note">이 파일에서 상품 정보 ' + totalRecords + '건을 인식했습니다' +
        (recordIndex !== undefined && recordIndex !== null ? ' (이 카드는 그 중 ' + (recordIndex + 1) + '번째 항목' + (merged ? ", 기존 카드와 병합됨" : "") + ')' : '') + '.</p>';
    } else if (merged) {
      multiNote = '<p class="autofill-multi-note">기존에 입력되어 있던 같은 상품 카드와 병합되었습니다(중복 카드를 만들지 않음).</p>';
    }
    if (!applied || !applied.length) {
      box.innerHTML = multiNote +
        '<div class="autofill-note autofill-none">"' + escapeHtml(fileName) + '"에서 자동으로 인식된 항목이 없습니다. 아래 항목을 직접 입력해주세요.</div>';
      return;
    }
    var itemsHtml = applied.map(function (a) {
      return '<li><strong>' + escapeHtml(a.label) + '</strong> → ' + escapeHtml(String(a.display)) + '</li>';
    }).join("");
    box.innerHTML = multiNote +
      '<div class="autofill-note autofill-ok">' +
        '<p><strong>"' + escapeHtml(fileName) + '"에서 ' + applied.length + '개 항목을 자동으로 채웠습니다.</strong> 아래에서 값을 확인하고, 필요하면 직접 수정하세요.</p>' +
        '<ul>' + itemsHtml + '</ul>' +
      '</div>';
  }

  // PDF는 값을 계산기에 자동으로 채우지 않고, 찾은 문구만 그대로 보여준다(직접 확인 후 입력).
  function renderPdfSnippetsSummary(p, result, fileName, matchedTier, elapsedMonths, matchedFlatRatio, flatMatchReason) {
    var box = p.refs.autofillSummaryEl;
    if (!box) return;
    var snippets = result.snippets;
    var breakpoints = result.breakpoints;
    var flatRatios = result.flatRatios;

    var tierHtml = "";
    if (matchedTier) {
      tierHtml =
        '<div class="autofill-note autofill-ok">' +
          '<p><strong>경과기간별 적용비율표를 찾아서 자동으로 설정했습니다.</strong></p>' +
          '<p>현재 경과기간 약 ' + formatYears(elapsedMonths / 12) + '(' + Math.round(elapsedMonths) + '개월) → "' + escapeHtml(matchedTier.raw) + '" 구간 적용 → 적용이율 비율 <strong>' + matchedTier.pct + '%</strong>로 설정</p>' +
          (breakpoints.length > 1 ? '<pre class="pdf-snippet">' + escapeHtml(breakpoints.map(function (b) { return b.raw; }).join("\n")) + '</pre>' : "") +
          '<p class="cell-note">자동으로 채운 값이니 아래 "적용이율 비율" 칸에서 다시 한 번 확인해주세요.</p>' +
        '</div>';
    } else if (breakpoints && breakpoints.length) {
      tierHtml =
        '<div class="autofill-note pdf-found">' +
          '<p><strong>경과기간별 적용비율표를 찾았지만, 현재 경과기간에 자동으로 매칭하지 못했습니다.</strong> 아래 표를 보고 직접 "적용이율 비율" 칸에 입력해주세요.</p>' +
          '<pre class="pdf-snippet">' + escapeHtml(breakpoints.map(function (b) { return b.raw; }).join("\n")) + '</pre>' +
        '</div>';
    } else if (matchedFlatRatio) {
      var matchReasonText = flatMatchReason === "label"
        ? "이 카드의 상품명(\"" + escapeHtml(p.refs.labelInput.value) + "\")과 PDF 안의 상품명이 일치하는 항목을 찾아 자동으로 설정했습니다."
        : "경과기간 구분 없는 고정 중도해지비율을 찾아서 자동으로 설정했습니다.";
      tierHtml =
        '<div class="autofill-note autofill-ok">' +
          '<p><strong>' + matchReasonText + '</strong></p>' +
          '<p>' + (matchedFlatRatio.productName ? '[' + escapeHtml(matchedFlatRatio.productName) + '] ' : '') + '"' + escapeHtml(matchedFlatRatio.raw) + '" → 적용이율 비율 <strong>' + matchedFlatRatio.pct + '%</strong>로 설정</p>' +
          '<p class="cell-note">자동으로 채운 값이니 아래 "적용이율 비율" 칸에서 다시 한 번 확인해주세요.</p>' +
        '</div>';
    } else if (flatRatios && flatRatios.length > 1) {
      var candidatesHtml = flatRatios.map(function (r, i) {
        return '<div class="flat-ratio-candidate">' +
          '<p class="cell-note">' + (r.productName ? '[' + escapeHtml(r.productName) + '] ' : '') + escapeHtml(r.raw) + '</p>' +
          '<button type="button" class="btn small flat-ratio-pick-btn" data-pct="' + r.pct + '" data-idx="' + i + '" data-product-name="' + escapeAttr(r.productName || "") + '">이 비율(' + r.pct + '%) 사용</button>' +
        '</div>';
      }).join("");
      tierHtml =
        '<div class="autofill-note pdf-found">' +
          '<p><strong>고정 중도해지비율 후보를 ' + flatRatios.length + '개 찾았지만, 상품(또는 옵션)이 여러 개라 자동으로 정하지 못했습니다.</strong> 가입하신 상품에 맞는 비율의 버튼을 눌러 바로 채우거나, 아래 "적용이율 비율" 칸에 직접 입력해주세요.</p>' +
          candidatesHtml +
        '</div>';
    }

    if (!snippets || !snippets.length) {
      if (!tierHtml) {
        box.innerHTML = '<div class="autofill-note autofill-none">"' + escapeHtml(fileName) + '"에서 중도해지 관련 문구를 찾지 못했습니다. 직접 확인 후 아래 항목에 입력해주세요.</div>';
      } else {
        box.innerHTML = tierHtml;
      }
      wireFlatRatioPickButtons(p, box);
      return;
    }
    // PDF 한 개에 상품이 여러 개 실려 있으면, 어느 스니펫이 어느 상품 소속인지
    // 먼저 표시해서 서로 다른 상품의 조항이 뒤섞여 보이지 않게 한다.
    var snippetsHtml = snippets.map(function (s) {
      return (s.productName ? '<p class="cell-note"><strong>[' + escapeHtml(s.productName) + ']</strong></p>' : '<p class="cell-note">[공통 안내]</p>') +
        '<pre class="pdf-snippet">' + escapeHtml(s.text) + '</pre>';
    }).join("");
    box.innerHTML = tierHtml +
      '<div class="autofill-note pdf-found">' +
        '<p><strong>"' + escapeHtml(fileName) + '"에서 중도해지 관련 문구 ' + snippets.length + '건을 찾았습니다.</strong> 원문은 아래에서 확인하세요.</p>' +
        snippetsHtml +
      '</div>';
    wireFlatRatioPickButtons(p, box);
  }

  // "고정 중도해지비율 후보" 목록에서 버튼을 눌러 바로 "적용이율 비율" 칸을 채울 수 있게 한다
  // (상품(또는 옵션)이 여러 개라 자동으로 하나를 정하지 못했을 때, 숫자를 직접 타이핑하지
  // 않고 후보 중 맞는 걸 한 번 클릭으로 반영하기 위한 용도).
  function wireFlatRatioPickButtons(p, box) {
    box.querySelectorAll(".flat-ratio-pick-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pct = btn.getAttribute("data-pct");
        var candidateProductName = btn.getAttribute("data-product-name") || "";

        // 이 버튼은 PDF를 첨부한 "이 카드"에 비율을 채우는데, PDF에 적힌 상품명과
        // 이 카드의 상품명이 서로 전혀 안 겹치면(예: PDF는 삼성화재 상품인데
        // 이 카드는 삼성생명 상품인 경우) 잘못된 카드에 적용하는 것일 수 있으니
        // 되묻는다. 카드 상품명이 비어있거나 후보에 상품명이 없으면(비교 대상이
        // 없으니) 그냥 진행한다.
        if (candidateProductName && normalizeLabelText(p.refs.labelInput.value)) {
          var overlaps = labelMatchesCandidateName(p.refs.labelInput.value, candidateProductName, false);
          if (!overlaps) {
            var ok = confirm(
              '이 카드의 상품명은 "' + p.refs.labelInput.value + '"인데, 선택한 ' + pct + '%는 상품설명서의 "' + candidateProductName + '"에서 찾은 값입니다.\n' +
              '서로 다른 상품일 수 있으니 한 번 더 확인해주세요. 그래도 이 카드에 적용할까요?'
            );
            if (!ok) return;
          }
        }

        p.refs.penaltyModeRatio.checked = true;
        updateProductPenaltyModeUI(p);
        p.refs.appliedRatePctInput.value = pct;
        renderReport();
      });
    });
  }

  // ---------- 첨부 PDF(상품설명서)에서 중도해지 관련 문구 찾기 ----------
  // PDF는 회사마다 표/줄글 형식이 제각각이라 값을 자동으로 계산에 채워 넣는 건
  // 신뢰할 수 없다. 대신 "중도해지/해지환급금/해지공제" 등 키워드가 있는 문단을
  // 찾아 그대로 보여주기만 하고, 정확한 숫자는 RM이 읽고 직접 입력하게 한다.
  var PDF_PENALTY_KEYWORDS = ["중도해지", "중도 해지", "해지환급금", "해지공제", "해지패널티", "중도인출", "경과기간별"];

  function ensurePdfWorkerReady() {
    if (typeof pdfjsLib === "undefined") return false;
    if (pdfjsLib.GlobalWorkerOptions.workerSrc) return true;
    var embedded = document.getElementById("pdfWorkerSrc");
    if (embedded && embedded.textContent && embedded.textContent.length > 1000) {
      var blob = new Blob([embedded.textContent], { type: "application/javascript" });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    } else {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
    }
    return true;
  }

  // pdf.js가 페이지마다 내려주는 글자 조각들을 y좌표가 비슷한 것끼리 묶어
  // 읽기 좋은 "줄" 단위 배열로 재구성한다.
  function pdfPageTextLines(content) {
    var lines = [];
    var current = null;
    var lastY = null;
    content.items.forEach(function (item) {
      var y = Math.round(item.transform[5]);
      if (lastY === null || Math.abs(y - lastY) > 2) {
        if (current !== null) lines.push(current.trim());
        current = item.str;
      } else {
        current += item.str;
      }
      lastY = y;
    });
    if (current !== null) lines.push(current.trim());
    return lines.filter(function (l) { return l !== ""; });
  }

  // 줄 배열을 훑으면서 "상품명 ..." 줄을 만날 때마다 그 이후 줄들이 어느 상품 설명인지
  // 기록한다. PDF 한 개에 상품(또는 "OO(디폴트옵션)"처럼 별개 취급해야 하는 변형) 여러
  // 개가 함께 실려 있을 때, 특정 줄이 어느 상품 소속인지 판단하는 데 공통으로 쓴다.
  function buildLineProductNames(lines) {
    var names = new Array(lines.length);
    var current = null;
    lines.forEach(function (line, idx) {
      var pm = /^상품명\s*(.+)/.exec(line.trim());
      if (pm) current = pm[1].trim();
      names[idx] = current;
    });
    return names;
  }

  // 키워드가 있는 줄을 찾아 그 앞뒤 줄을 붙여서(표는 보통 여러 줄에 걸쳐 있으므로)
  // 스니펫으로 만든다. 가까이 있는 매칭들은 하나로 합친다. PDF 한 개에 상품이 여러 개
  // 실려 있으면(예: 기본형 vs 디폴트옵션) 각 스니펫이 어느 상품 소속인지도 같이
  // 표시해서, 서로 다른 상품의 조항이 뒤섞여 보이지 않고 분리해서 확인할 수 있게 한다.
  function findPenaltyClauseSnippets(lines) {
    var lineProductNames = buildLineProductNames(lines);
    var matchedIdx = [];
    lines.forEach(function (line, idx) {
      if (PDF_PENALTY_KEYWORDS.some(function (kw) { return line.indexOf(kw) !== -1; })) {
        matchedIdx.push(idx);
      }
    });
    if (!matchedIdx.length) return [];

    // 창(윈도) 앞뒤로 늘릴 때, 같은 상품 소속인 줄까지만 늘린다 — 그래야 창이 다른
    // 상품 구간까지 넘어가서 스니펫 하나에 두 상품 내용이 섞이는 걸 막을 수 있다.
    var windows = matchedIdx.map(function (idx) {
      var pname = lineProductNames[idx];
      var start = idx;
      while (start > 0 && start > idx - 2 && lineProductNames[start - 1] === pname) start--;
      var end = idx;
      var maxEnd = Math.min(lines.length - 1, idx + 8);
      while (end < maxEnd && lineProductNames[end + 1] === pname) end++;
      return { start: start, end: end, productName: pname };
    });
    var merged = [];
    windows.forEach(function (w) {
      var last = merged[merged.length - 1];
      if (last && w.start <= last.end + 1 && w.productName === last.productName) {
        last.end = Math.max(last.end, w.end);
      } else {
        merged.push({ start: w.start, end: w.end, productName: w.productName });
      }
    });

    return merged.slice(0, 4).map(function (w) {
      return { text: lines.slice(w.start, w.end + 1).join("\n"), productName: w.productName };
    });
  }

  // "6개월 미만 약정이율의 30%" 같은 경과기간별 적용비율 표를 줄 단위로 찾아
  // {minMonths, maxMonths, pct} 구간 목록으로 만든다. 한 줄에 기간 표현과 %가
  // 함께 있는, 표에서 흔한 형태만 인식한다(문장이 여러 줄에 걸치는 경우는
  // 못 찾을 수 있음 — 그 경우엔 스니펫만 보여주고 자동 설정은 하지 않는다).
  function parsePenaltyRateTable(lines) {
    var TU = "(\\d+(?:\\.\\d+)?)\\s*(개월|년)";
    var lineProductNames = buildLineProductNames(lines);
    var breakpoints = [];
    lines.forEach(function (line, idx) {
      var pctMatch = /(\d+(?:\.\d+)?)\s*%/.exec(line);
      if (!pctMatch) return;
      var pct = parseFloat(pctMatch[1]);
      var productName = lineProductNames[idx];

      var rangeRe = new RegExp(TU + "\\s*이상\\s*" + TU + "\\s*미만");
      var m = rangeRe.exec(line);
      if (m) {
        breakpoints.push({ minMonths: toMonthsFromUnit(parseFloat(m[1]), m[2]), maxMonths: toMonthsFromUnit(parseFloat(m[3]), m[4]), pct: pct, raw: line, productName: productName });
        return;
      }
      var underRe = new RegExp(TU + "\\s*미만");
      m = underRe.exec(line);
      if (m && line.indexOf("이상") === -1) {
        breakpoints.push({ minMonths: 0, maxMonths: toMonthsFromUnit(parseFloat(m[1]), m[2]), pct: pct, raw: line, productName: productName });
        return;
      }
      var overRe = new RegExp(TU + "\\s*(이상|초과)");
      m = overRe.exec(line);
      if (m && line.indexOf("미만") === -1) {
        breakpoints.push({ minMonths: toMonthsFromUnit(parseFloat(m[1]), m[2]), maxMonths: null, pct: pct, raw: line, productName: productName });
      }
    });
    return breakpoints;
  }

  function toMonthsFromUnit(n, unit) {
    return unit === "년" ? n * 12 : n;
  }

  // 상품명 끝에 흔히 붙는 "보험" 같은 일반 단어나 "3년"/"2.5년" 같은 기간 표시를
  // 떼고 핵심명(회사명+상품종류)만 남긴다. 예: "삼성화재 이율보증형 3년" →
  // "삼성화재이율보증형", "삼성화재 이율보증형보험" → "삼성화재이율보증형" — 실제
  // 회사 시스템은 상품명에 기간을 붙여 관리하고, 상품설명서 PDF는 기간 대신
  // "보험"으로 끝나는 정식 명칭을 쓰는 경우가 많아 이 둘을 이어주기 위한 것이다.
  // "(디폴트옵션)"처럼 상품을 구분짓는 진짜 중요한 접미사는 이 규칙에 안 걸려서
  // (끝이 "보험"도 "N년"도 아니므로) 그대로 남아 서로 다른 상품으로 유지된다.
  function normalizeProductStem(norm) {
    return norm.replace(/\d+(\.\d+)?년$/, "").replace(/보험$/, "");
  }

  // 카드 상품명과 PDF에서 찾은 상품명이 같은 상품을 가리키는지 본다. 다음 순서로
  // 느슨하게 확인한다: 1) 완전히 같음, 2) exactOnly가 아니면 서로 포함 관계(한쪽이
  // 다른 쪽 안에 그대로 들어있는 경우 — 예: "OO보험" vs "OO보험(디폴트옵션)"),
  // 3) 위 핵심명(접미사 뗀 이름)이 같음(예: "OO 3년" vs "OO보험").
  function labelMatchesCandidateName(cardLabel, candidateName, exactOnly) {
    var a = normalizeLabelText(cardLabel);
    var b = normalizeLabelText(candidateName);
    if (!a || !b) return false;
    if (a === b) return true;
    if (exactOnly) return false;
    if (b.indexOf(a) !== -1 || a.indexOf(b) !== -1) return true;
    var sa = normalizeProductStem(a);
    var sb = normalizeProductStem(b);
    return !!sa && !!sb && sa === sb;
  }

  // 상품(또는 옵션)이 여러 개 실린 PDF에서, 이 카드의 상품명과 유일하게 일치하는 후보
  // 하나를 찾는다. 완전히 같은 이름이 있으면 그것을 우선하고(포함 관계만 보면 기본형
  // 이름이 변형 이름 안에도 걸려서 오히려 더 애매해질 수 있어서), 없으면 포함 관계로
  // 다시 찾는다. 정확히 하나로 좁혀지지 않으면(상품명이 없거나 여러 개와 겹치면) null.
  function pickUniqueCandidateForLabel(cardLabel, candidates) {
    var labelNorm = normalizeLabelText(cardLabel);
    if (!labelNorm) return null;
    var exact = candidates.filter(function (c) {
      return c.productName && normalizeLabelText(c.productName) === labelNorm;
    });
    var pool = exact.length ? exact : candidates.filter(function (c) {
      return c.productName && labelMatchesCandidateName(cardLabel, c.productName, false);
    });
    return pool.length === 1 ? pool[0] : null;
  }

  // 경과기간 구분 없이 "중도해지이율은 적용이율의 60%"처럼 고정 비율만 있는 경우를 찾는다.
  // 문서 한 개에 상품(또는 디폴트옵션 등 변형) 여러 개가 실려 있으면 비율도 여러 개일 수
  // 있어, 그런 경우엔 각 비율이 어느 상품명 아래에서 나왔는지 함께 기록해 후보로 보여준다
  // (자동 적용은 비율이 문서 전체에서 하나로만 정해질 때만 한다).
  function parseFlatPenaltyRatios(lines) {
    var re = /(적용이율|약정이율|계약이율|만기이율)\s*의\s*(\d+(?:\.\d+)?)\s*%/;
    var lineProductNames = buildLineProductNames(lines);
    var results = [];
    var seen = {};
    lines.forEach(function (line, idx) {
      var trimmed = line.trim();
      if (/^상품명\s*(.+)/.test(trimmed)) return;
      var m = re.exec(trimmed);
      if (!m) return;
      var pct = parseFloat(m[2]);
      var productName = lineProductNames[idx];
      var key = pct + "|" + (productName || "");
      if (seen[key]) return;
      seen[key] = true;
      results.push({ pct: pct, raw: trimmed, productName: productName });
    });
    return results;
  }

  // 문서 전체에서 서로 다른 비율(%) 값이 몇 종류인지 센다 — 하나뿐이면 자동 적용해도 안전하다.
  function distinctFlatPcts(flatRatios) {
    var pcts = [];
    flatRatios.forEach(function (r) {
      if (pcts.indexOf(r.pct) === -1) pcts.push(r.pct);
    });
    return pcts;
  }

  // 구간이 정확히 하나만 걸리는 경우에만 자동 적용한다(겹치거나 빈 구간이 있어
  // 애매하면 자동 적용하지 않고 RM이 직접 확인하게 한다).
  function matchPenaltyTier(breakpoints, elapsedMonths) {
    var matches = breakpoints.filter(function (b) {
      return elapsedMonths >= b.minMonths && (b.maxMonths === null || elapsedMonths < b.maxMonths);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function extractPdfPenaltyClauses(file, callback) {
    if (!ensurePdfWorkerReady()) {
      callback(new Error("pdfjs not available"), null);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var bytes = new Uint8Array(reader.result);
      pdfjsLib.getDocument({ data: bytes }).promise.then(function (doc) {
        var pagePromises = [];
        for (var i = 1; i <= doc.numPages; i++) {
          pagePromises.push(
            doc.getPage(i).then(function (page) {
              return page.getTextContent().then(pdfPageTextLines);
            })
          );
        }
        return Promise.all(pagePromises).then(function (perPageLines) {
          var allLines = [];
          perPageLines.forEach(function (pl) { allLines = allLines.concat(pl); });
          var snippets = findPenaltyClauseSnippets(allLines);
          var breakpoints = parsePenaltyRateTable(allLines);
          var flatRatios = breakpoints.length ? [] : parseFlatPenaltyRatios(allLines);
          callback(null, { snippets: snippets, pageCount: doc.numPages, breakpoints: breakpoints, flatRatios: flatRatios });
        });
      }).catch(function (e) {
        callback(e, null);
      });
    };
    reader.onerror = function () { callback(new Error("read failed"), null); };
    reader.readAsArrayBuffer(file);
  }

  // 첨부 자료 표에서 불필요한 개인정보 열은 빼고, 자주 길어지는 열은 넓게 표시한다.
  // 열 위치는 파일마다 다를 수 있어 고정 인덱스 대신 헤더 텍스트로 찾는다.
  var ATTACHMENT_DROP_COLUMN_KEYWORDS = ["가입자번호", "가입자명", "주민번호"];
  var ATTACHMENT_WIDE_COLUMN_KEYWORDS = ["상품명", "명세일자", "적립금기준일자"];

  function renderSheetTableHtml(sheet) {
    var dropCols = {};
    var wideCols = {};
    sheet.rows.forEach(function (row) {
      row.forEach(function (cell, ci) {
        var norm = normalizeLabelText(cell);
        if (!norm) return;
        if (ATTACHMENT_DROP_COLUMN_KEYWORDS.indexOf(norm) !== -1) dropCols[ci] = true;
        if (ATTACHMENT_WIDE_COLUMN_KEYWORDS.indexOf(norm) !== -1) wideCols[ci] = true;
      });
    });

    var html = '<div class="table-scroll"><table class="report-table attachment-excel-table" style="color:#131b2b;"><tbody>';
    sheet.rows.forEach(function (row) {
      html += "<tr>";
      row.forEach(function (cell, ci) {
        if (dropCols[ci]) return;
        html += (wideCols[ci] ? '<td class="col-wide" style="border-color:#d8dae0;">' : '<td style="border-color:#d8dae0;">') + escapeHtml(cell === null || cell === undefined ? "" : cell) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    if (sheet.truncated) {
      html += '<p class="cell-note" style="color:#5c6576;">(내용이 많아 앞부분만 표시했습니다. 전체 내용은 원본 파일을 확인해주세요.)</p>';
    }
    return html;
  }

  // ---------- 상품별 계산 ----------

  function gatherProductCustomer(p) {
    var refs = p.refs;
    var principal = parseAmountStr(refs.principalInput.value);
    var start = parseDateUTC(refs.startDateInput.value);
    var maturity = parseDateUTC(refs.maturityDateInput.value);
    var rate = parseFloat(refs.contractRateInput.value);
    rate = isNaN(rate) ? null : rate;
    var method = refs.methodSelect.value || "compoundYear";
    var today = parseDateUTC(el.todayDate.value);
    var contributionPrincipal = parseAmountStr(refs.contributionPrincipalInput.value);

    // 표 형식 자동입력에서는 "적립금이 실제 산정된 날짜"(적립금기준일자)가 화면에 보이는
    // 명세일자와 다를 수 있다. 그 경우에도 명세일자 칸에는 실제 명세일자를 그대로 보여주되,
    // 경과이자 계산(오늘까지 잔액을 불리는 기준)에는 principalAsOfDate를 대신 사용해서
    // 이미 최신 값인 적립금에 이자가 이중으로 붙지 않게 한다.
    var principalAsOf = (p.principalAsOfDate && parseDateUTC(p.principalAsOfDate)) || start;

    var totalYears = yearsBetween(start, maturity);
    var elapsedYears = yearsBetween(principalAsOf, today);
    var remainingYears = yearsBetween(today, maturity);

    return {
      label: refs.labelInput.value.trim(),
      principal: principal, start: principalAsOf, contractStart: start, maturity: maturity, rate: rate, method: method, today: today,
      contributionPrincipal: contributionPrincipal,
      totalYears: totalYears, elapsedYears: elapsedYears, remainingYears: remainingYears,
      remainingYearsClamped: remainingYears === null ? null : Math.max(0, remainingYears),
      valid: principal !== null && start && maturity && rate !== null && today
    };
  }

  function updateProductPeriodSummary(p, c) {
    var elp = p.refs.periodSummaryEl;
    if (!c.start || !c.maturity || !c.today) {
      elp.textContent = "";
      return;
    }
    var parts = [];
    if (c.totalYears !== null) parts.push("전체기간(명세일자 기준) " + formatYears(c.totalYears));
    var asOfDiffers = c.contractStart && Math.abs(c.start.getTime() - c.contractStart.getTime()) > 24 * 3600 * 1000;
    if (asOfDiffers) {
      parts.push("적립금 산정일 " + formatDateUTC(c.start) + "(경과 " + formatYears(c.elapsedYears) + ")");
    } else if (c.elapsedYears !== null) {
      parts.push("경과기간 " + formatYears(c.elapsedYears));
    }
    if (c.remainingYears !== null) parts.push("잔여기간 " + formatYears(c.remainingYears));
    elp.textContent = parts.join(" · ");
  }

  // 세 방식(연단리/연복리/월복리) 각각 "그 방식으로 전부 일관되게 계산했을 때"의
  // 만기 예상 수령액을 따로 구한다. 그래야 화면에 보이는 참고값과, 그 값을
  // "사용" 눌러서 채웠을 때 실제로 들어가는 값이 항상 서로 일치한다.
  function updateHoldSuggestion(p, c) {
    var refs = p.refs;
    if (c.principal === null || c.rate === null || c.totalYears === null) {
      refs.suggestSimpleEl.textContent = "-";
      refs.suggestCompoundYearEl.textContent = "-";
      refs.suggestCompoundMonthEl.textContent = "-";
      return null;
    }
    var events = gatherWithdrawalEvents(p.withdrawals);
    var t = c.remainingYearsClamped === null ? 0 : c.remainingYearsClamped;
    var results = {};

    // "오늘(해지기준일)"과 만기 사이에 예정된 인출 이력이 있으면(예: 앞으로 얼마를
    // 더 인출할 예정이라 미리 계산해보는 경우), 그 시점에서 빼고 나머지 구간만
    // 굴려야 만기 예상 수령액에 제대로 반영된다 — 오늘 이전 인출은 computeHistory가
    // balanceToday에 이미 반영해 준다.
    var futureEvents = events.filter(function (e) {
      return c.today && c.maturity && e.date.getTime() > c.today.getTime() && e.date.getTime() <= c.maturity.getTime();
    }).sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });

    ["simple", "compoundYear", "compoundMonth"].forEach(function (m) {
      var cForMethod = Object.assign({}, c, { method: m });
      var hForMethod = computeHistory(cForMethod, events);
      var base = hForMethod ? hForMethod.balanceToday : c.principal;

      if (futureEvents.length && c.today && c.maturity) {
        var amount = base;
        var segStart = c.today;
        futureEvents.forEach(function (e) {
          var segYears = Math.max(0, yearsBetween(segStart, e.date) || 0);
          amount = Math.max(0, amount * growthFactor(m, c.rate / 100, segYears) - e.amount);
          segStart = e.date;
        });
        var lastYears = Math.max(0, yearsBetween(segStart, c.maturity) || 0);
        results[m] = amount * growthFactor(m, c.rate / 100, lastYears);
      } else {
        results[m] = base * growthFactor(m, c.rate / 100, t);
      }
    });

    refs.suggestSimpleEl.textContent = formatWon(results.simple);
    refs.suggestCompoundYearEl.textContent = formatWon(results.compoundYear);
    refs.suggestCompoundMonthEl.textContent = formatWon(results.compoundMonth);

    return results;
  }


  function updatePenalty(p, c, history) {
    var refs = p.refs;
    updateProductPenaltyModeUI(p);
    var mode = refs.penaltyModeRatio.checked ? "ratio" : "direct";

    var cancelAmount = null;
    var penaltyAmount = null;

    if (mode === "direct") {
      var rawCancelAmount = parseAmountStr(refs.directCancelAmountInput.value);
      penaltyAmount = parseAmountStr(refs.directPenaltyAmountInput.value);

      var todayReal = todayLocalDate();
      var allEvents = (history && history.events) ? history.events : [];

      // 입력한 해지적립금은 회사 시스템에서 조회한 시점(대개 실제 오늘) 기준 값이므로,
      // 그 시점 이전에 실제로 이미 벌어진 인출은 조회값에 이미 반영돼 있다고 보고 다시
      // 빼지 않는다 — 다만 화면에 안내한 대로("명세일자 이후 실제 인출된 금액이 있으면
      // 추가하세요. 있으면 중도해지 시 계산에도 자동 반영됩니다") 실제 오늘 이전 인출
      // 이력을 입력했는데도 전혀 반영이 안 되는 문제가 있었다 — 조회 시점을 정확히
      // 알 수 없으므로, "실제 오늘"을 기준으로 그 이전 인출은 그대로 빼서 반영한다.
      var pastEvents = allEvents.filter(function (e) { return e.date.getTime() <= todayReal.getTime(); });
      var pastWithdrawn = pastEvents.reduce(function (s, e) { return s + e.amount; }, 0);
      cancelAmount = rawCancelAmount === null ? null : Math.max(0, rawCancelAmount - pastWithdrawn);

      if (pastEvents.length && rawCancelAmount !== null) {
        refs.directModeFutureNoteEl.textContent =
          "입력하신 해지적립금 " + formatWon(rawCancelAmount) + "에서 인출 이력 " + pastEvents.length + "건(합계 " +
          formatWon(pastWithdrawn) + ")을 뺀 " + formatWon(cancelAmount) + "을 사용합니다.";
      } else {
        refs.directModeFutureNoteEl.textContent = "";
      }

      // 위 "오늘(해지기준일)"을 미래로 바꾼 경우, 그 값을 약정금리로 계속 굴렸다고
      // 가정한 추정치로 미래 시점 해지적립금을 보여준다(실제 회사 값과 다를 수 있음).
      // 이때 "실제 오늘"과 미래 해지기준일 사이에 인출 이력이 있으면(예: 조회 시점
      // 이후에 예정된 인출), 그 시점에서 빼고 나머지 구간만 굴린다. (실제 오늘 이전
      // 인출은 위에서 이미 처리했으므로 여기서는 그 이후분만 다뤄 중복으로 빼지 않는다.)
      if (cancelAmount !== null && c.today && c.rate !== null &&
          Math.abs(c.today.getTime() - todayReal.getTime()) > 12 * 3600 * 1000) {
        var gapYrs = yearsBetween(todayReal, c.today);
        if (gapYrs !== null) {
          var futureEvents = allEvents
            .filter(function (e) { return e.date.getTime() > todayReal.getTime() && e.date.getTime() <= c.today.getTime(); })
            .sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });

          var estimated = cancelAmount;
          var segStart = todayReal;
          futureEvents.forEach(function (e) {
            var segYears = Math.max(0, yearsBetween(segStart, e.date) || 0);
            estimated = Math.max(0, estimated * growthFactor(c.method, c.rate / 100, segYears) - e.amount);
            segStart = e.date;
          });
          var lastYears = Math.max(0, yearsBetween(segStart, c.today) || 0);
          estimated = estimated * growthFactor(c.method, c.rate / 100, lastYears);

          cancelAmount = estimated;
          var withdrawalNote = futureEvents.length
            ? " 그 사이 예정된 인출 " + futureEvents.length + "건(합계 " + formatWon(futureEvents.reduce(function (s, e) { return s + e.amount; }, 0)) + ")도 반영했습니다."
            : "";
          refs.directModeFutureNoteEl.textContent =
            (gapYrs >= 0
              ? "오늘 날짜가 실제 오늘(" + formatDateUTC(todayReal) + ")보다 " + formatYears(gapYrs) + " 미래라, 해지적립금이 약정금리로 계속 늘었다고 가정한 추정치 " + formatWon(estimated) + "을 사용합니다."
              : "오늘 날짜가 실제 오늘(" + formatDateUTC(todayReal) + ")보다 " + formatYears(-gapYrs) + " 과거라, 해지적립금을 그만큼 거꾸로 할인한 추정치 " + formatWon(estimated) + "을 사용합니다.") +
            withdrawalNote +
            " 실제 회사 시스템 조회값과 다를 수 있으니 참고용으로만 사용하세요.";
        }
      }
    } else {
      var ratePct = parseFloat(refs.appliedRatePctInput.value);
      ratePct = isNaN(ratePct) ? null : ratePct;

      if (c.principal !== null && c.rate !== null && c.elapsedYears !== null && ratePct !== null && history) {
        var preValue = history.balanceToday;
        var netPrincipal = history.netPrincipal;
        var netPrincipalEstimated = history.netPrincipalEstimated;

        var interestPortion = Math.max(0, preValue - netPrincipal);
        cancelAmount = netPrincipal + interestPortion * (ratePct / 100);
        penaltyAmount = preValue - cancelAmount;
        refs.ratioModeCalcEl.textContent =
          "해지시점 세전평가액(참고) " + formatWon(preValue) + " → 해지패널티 " + formatWon(penaltyAmount) + " → 해지적립금 " + formatWon(cancelAmount) +
          " (순원금 " + formatWon(netPrincipal) + (netPrincipalEstimated ? ", 납입원금 미입력으로 추정치 사용" : "") + ")";
      } else {
        refs.ratioModeCalcEl.textContent = "";
      }
    }

    refs.cancelAmountResultEl.textContent = cancelAmount === null ? "-" : formatWon(cancelAmount);
    return { mode: mode, cancelAmount: cancelAmount, penaltyAmount: penaltyAmount };
  }

  // 상품 하나에 대한 전체 계산(입력 카드의 실시간 표시도 이 안에서 함께 갱신한다).
  function computeProduct(p) {
    var c = gatherProductCustomer(p);
    updateProductPeriodSummary(p, c);
    var events = gatherWithdrawalEvents(p.withdrawals);
    var history = computeHistory(c, events);

    var refs = p.refs;
    if (history) {
      var breakdown = " (순원금" + (history.netPrincipalEstimated ? "(추정)" : "") + " " + formatWon(history.netPrincipal) +
        " + 누적이자 " + formatWon(Math.max(0, history.balanceToday - history.netPrincipal)) + ")";
      // 입력한 인출 이력 중 적립금 산정일 이전(또는 오늘 이후) 날짜는 계산에서 제외된다
      // (적립금 산정일 이전 인출은 이미 그 적립금 값 자체에 반영돼 있다고 보기 때문) —
      // 그런데 그 사실이 화면에 아무 표시 없이 조용히 빠지면, "인출 이력을 넣어도
      // 적립금/해지적립금이 안 바뀐다"는 오해를 사기 쉬워서 왜 빠졌는지 명시한다.
      var excludedCount = events.length - history.events.length;
      var excludedNote = excludedCount > 0
        ? " · 인출 이력 " + excludedCount + "건은 적립금 산정일(" + formatDateUTC(c.start) + ") 이전(또는 오늘 이후)이라 이미 적립금에 반영된 것으로 보고 제외했습니다"
        : "";
      refs.historySummaryEl.textContent =
        (history.hasEvents ? "인출 이력 " + history.events.length + "건 반영 · 인출총액 " + formatWon(history.withdrawnTotal) + " · " : "") +
        "오늘 기준 실제 잔액(세전, 추정) " + formatWon(history.balanceToday) + breakdown + excludedNote;
    } else {
      refs.historySummaryEl.textContent = "";
    }

    var holdSuggestions = updateHoldSuggestion(p, c);
    if (holdSuggestions && !p.holdAmountManual) {
      var trackedEst = holdSuggestions[c.method];
      if (trackedEst !== null && trackedEst !== undefined && !isNaN(trackedEst)) {
        setAmountValue(refs.holdAmountInput, trackedEst);
      }
    }
    var holdSuggestion = holdSuggestions ? holdSuggestions[c.method] : null;
    var penalty = updatePenalty(p, c, history);
    var holdAmount = parseAmountStr(refs.holdAmountInput.value);
    var holdAmountForCompare = holdAmount === null ? holdSuggestion : holdAmount;

    var remainYrs = c.remainingYearsClamped;
    // 신상품 재예치 쪽 성장은 act/365 기준(실제 조회 자료로 확인됨)이라, 기존상품
    // 자체 계산(30/360, remainYrs)과는 별도로 같은 오늘→기존상품만기 구간을
    // act/365로 다시 잰다.
    var remainYrsAct = actYearsBetween(c.today, c.maturity);
    if (remainYrsAct !== null) remainYrsAct = Math.max(0, remainYrsAct);

    var breakEvenRate = null;
    if (holdAmountForCompare !== null && penalty.cancelAmount !== null && penalty.cancelAmount > 0 && remainYrsAct !== null && remainYrsAct > 0) {
      breakEvenRate = ((holdAmountForCompare / penalty.cancelAmount) - 1) / remainYrsAct * 100;
    }

    var rows = [];
    if (penalty.cancelAmount !== null && remainYrsAct !== null) {
      rows = state.rows.filter(function (r) {
        return r.years !== "" && r.years !== null && !isNaN(r.years) && r.rate !== "" && r.rate !== null && !isNaN(r.rate);
      }).map(function (r) {
        var method = r.method || "simple";
        var rr = r.rate / 100;
        var maturityAmount = penalty.cancelAmount * growthFactor(method, rr, remainYrsAct);
        var ownMaturityDate = addYears(c.today, r.years);
        var diff = holdAmountForCompare === null ? null : maturityAmount - holdAmountForCompare;

        // 신상품 자체 기간이 기존상품 잔여기간과 다르면(더 길거나 짧으면), 두 시나리오의
        // 만기 시점이 서로 달라 단순 차액 비교만으로는 부족하다. 이 신상품을 실제로 그
        // 자체 만기까지(그 상품이 고른 이자계산방식으로, act/365 기준) 운용했을 때의
        // 예상액(ownTermAmount)을 구하고, 더 늦게 끝나는 쪽을 기준으로 "그 사이 기간
        // 동안 최소 몇 %로(연단리 환산) 재예치해야 동등해지는지"를 계산해서, 만기 후
        // 재예치 가이드로 제공한다.
        var ownTermYrsAct = actYearsBetween(c.today, ownMaturityDate);
        var ownTermAmount = penalty.cancelAmount * growthFactor(method, rr, ownTermYrsAct);
        var horizonDiffYears = actYearsBetween(c.maturity, ownMaturityDate);
        var gapYears = Math.abs(horizonDiffYears);
        var requiredReinvestRate = null;
        if (gapYears > 0.05 && holdAmountForCompare !== null && holdAmountForCompare > 0 && ownTermAmount > 0) {
          if (horizonDiffYears > 0) {
            // 신상품 만기가 기존상품 만기보다 늦음: 기존상품을 만기까지 유지한 뒤,
            // 그 차이만큼 재예치했을 때 신상품 자체 만기 시점 금액과 같아지는 금리.
            requiredReinvestRate = ((ownTermAmount / holdAmountForCompare) - 1) / gapYears * 100;
          } else {
            // 신상품 만기가 기존상품 만기보다 빠름: 신상품 자체 만기 이후 그 차이만큼
            // 재예치했을 때 기존상품 유지 금액과 같아지는 금리.
            requiredReinvestRate = ((holdAmountForCompare / ownTermAmount) - 1) / gapYears * 100;
          }
        }

        return {
          label: r.label || (r.years + "년"), years: r.years, rate: r.rate, method: method,
          ownMaturityDate: ownMaturityDate, maturityAmount: maturityAmount, diff: diff, horizonDiffYears: horizonDiffYears,
          ownTermAmount: ownTermAmount, gapYears: gapYears, requiredReinvestRate: requiredReinvestRate
        };
      });
    }

    var bestRow = null;
    rows.forEach(function (r) {
      if (bestRow === null || r.maturityAmount > bestRow.maturityAmount) bestRow = r;
    });

    return {
      product: p, c: c, history: history, penalty: penalty,
      holdAmount: holdAmount, holdAmountForCompare: holdAmountForCompare,
      remainYrs: remainYrs, breakEvenRate: breakEvenRate, rows: rows, bestRow: bestRow
    };
  }

  // 명세가 여러 건일 때, 세부 내용보다 먼저 "그래서 뭘 어떻게 하라는 건지"를
  // 한 줄씩 모아서 보여주는 결론 요약. 표는 좁은 화면에서 옆으로 잘리기 쉬워서
  // 자연스럽게 줄바꿈되는 카드 목록으로 구성한다.
  function buildConclusionSummary(validResults) {
    var html = '<div class="report-block conclusion-summary" style="background:#ffffff;color:#131b2b;"><h3>결론: 명세별 추천</h3>';
    html += '<div class="conclusion-list">';
    validResults.forEach(function (r, idx) {
      var c = r.c, bestRow = r.bestRow;
      var name = escapeHtml(c.label || "기존상품 " + (idx + 1));
      var verdict, diffText, cls, badgeBg, textColor;
      if (bestRow && bestRow.diff !== null) {
        if (bestRow.diff > 0) {
          verdict = "재예치(" + escapeHtml(bestRow.label) + ")";
          diffText = formatSignedWon(bestRow.diff) + " 더 유리";
          cls = "better"; badgeBg = "#e3f6e3"; textColor = "#0ca30c";
        } else {
          verdict = "유지";
          diffText = formatSignedWon(-bestRow.diff) + " 더 유리";
          cls = "hold"; badgeBg = "#e3ecfb"; textColor = "#1c5cab";
        }
      } else {
        verdict = "-";
        diffText = "신상품 금리 입력 필요";
        cls = "neutral"; badgeBg = "#f5f7fb"; textColor = "#5c6576";
      }
      html += '<div class="conclusion-item" style="background:#ffffff;color:#131b2b;">' +
        '<div class="conclusion-item-top">' +
          '<span class="conclusion-num" style="background:#0b1f3d;color:#ffffff;">' + (idx + 1) + '</span>' +
          '<span class="conclusion-title" style="color:#131b2b;">' + name + '</span>' +
          '<span class="badge ' + cls + '" style="background:' + badgeBg + ';color:' + textColor + ';">' + verdict + '</span>' +
        '</div>' +
        '<div class="conclusion-item-diff ' + cls + '" style="color:' + textColor + ';">' + diffText + '</div>' +
      '</div>';
    });
    html += '</div></div>';
    return html;
  }

  // 합계 KPI(총 해지적립금/총 만기유지 합계) 바로 옆에, 그 합계를 구성하는
  // 명세별 금액을 나란히 보여줘서 총액과 바로 비교할 수 있게 한다.
  function buildAggregateBreakdown(validResults) {
    var html = '<div class="breakdown-list">';
    validResults.forEach(function (r, idx) {
      var name = escapeHtml(r.c.label || "기존상품 " + (idx + 1));
      html += '<div class="breakdown-row" style="color:#131b2b;">' +
        '<span class="breakdown-name" style="color:#131b2b;">' + (idx + 1) + '. ' + name + '</span>' +
        '<span class="breakdown-vals" style="color:#5c6576;">' +
          '<span>해지적립금 ' + formatWon(r.penalty.cancelAmount) + '</span>' +
          '<span>만기까지 유지 시 ' + formatWon(r.holdAmountForCompare) + '</span>' +
        '</span>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  // ---------- 결과 요약(리포트) ----------
  // 비교 기준: 각 기존상품의 만기일. 재예치 금액도 "그 상품의 잔여기간" 동안
  // 신금리를 적용해 그 상품 만기일 시점 금액으로 환산해서 비교한다.

  function renderReport() {
    var customerName = el.customerName.value.trim();
    var todayVal = parseDateUTC(el.todayDate.value);

    var results = state.products.map(computeProduct);
    var validResults = results.filter(function (r) { return r.c.valid && r.penalty.cancelAmount !== null; });

    if (!validResults.length) {
      el.reportContent.innerHTML = '<p class="report-empty">기존상품 정보를 입력하면 여기에 비교 결과가 표시됩니다.</p>';
      return;
    }

    var rm = { name: el.rmName.value.trim(), dept: el.rmDept.value.trim(), contact: el.rmContact.value.trim() };
    var multi = validResults.length > 1;

    var html = "";

    // ---- 배너 ----
    html += '<div class="report-banner" style="background:#f5ead0;color:#131b2b;border-color:#0b1f3d;">';
    html += '<p class="report-banner-eyebrow" style="color:#96701e;">퇴직연금 상품 제안서' + (multi ? " · 기존상품 " + validResults.length + "건" : "") + '</p>';
    html += '<p class="report-title" style="color:#0b1f3d;">중도해지 · 재예치 시뮬레이션' + (customerName ? " — " + escapeHtml(customerName) : "") + '</p>';
    html += '<p class="report-meta" style="color:#5c6576;">작성일 ' + formatDateUTC(todayLocalDate()) + (todayVal ? ' · 해지(기준)일 ' + formatDateUTC(todayVal) : '') + '</p>';
    html += '</div>';

    // ---- 결론(두괄식): 명세별 추천을 세부 내용보다 먼저 한눈에 ----
    if (multi) {
      html += buildConclusionSummary(validResults);

      var totalCancel = 0;
      var totalHold = 0;
      var holdKnownCount = 0;
      validResults.forEach(function (r) {
        totalCancel += r.penalty.cancelAmount;
        if (r.holdAmountForCompare !== null) { totalHold += r.holdAmountForCompare; holdKnownCount++; }
      });
      html += '<div class="report-block" style="background:#ffffff;color:#131b2b;"><h3>기존상품 ' + validResults.length + '건 합계</h3>';
      html += '<div class="kpi-row">';
      html += kpiTile("총 해지적립금 합계(오늘 기준)", formatWon(totalCancel), "모두 오늘 해지할 경우 재예치 가능한 총액", false);
      html += kpiTile("총 만기유지 시 합계", formatWon(totalHold), holdKnownCount === validResults.length ? "각 상품 자기 만기일 기준 합계(만기 시점은 상품마다 다름)" : "일부 상품은 정보 부족으로 제외됨", false);
      html += '</div>';
      html += buildAggregateBreakdown(validResults);
      html += '</div>';
    }

    // ---- 상품별 리포트 ----
    validResults.forEach(function (r, idx) {
      html += buildProductReportSection(r, idx, multi);
    });

    html += '<p class="report-disclaimer" style="color:#5c6576;">본 시뮬레이션은 입력하신 정보를 기준으로 한 추정 참고자료이며, 실제 적용금리·세금·수수료 등에 따라 실수령액과 차이가 있을 수 있습니다. 신상품 재예치 금액은 각 기존상품 만기일까지의 잔여기간에 제안금리(단리)를 적용해 환산한 값이며, 상품 자체 만기가 그보다 짧거나 길 경우 이후 재투자 조건은 별도로 확인이 필요합니다. 신상품 제안금리는 안내 시점 기준이며 향후 변동될 수 있습니다.' +
      (validResults.some(function (r) { return r.history && r.history.hasEvents; }) ? ' 중간인출 이력은 인출액이 원금에서 먼저 차감된 것으로 보수적으로 가정해 계산했으며, 정확한 금액은 상품사 확인이 필요합니다.' : '') +
      (validResults.some(function (r) { return r.history && r.history.netPrincipalEstimated; }) ? ' 납입원금을 별도로 입력하지 않은 상품은 현재 적립금을 경과기간만큼 할인해 순원금을 추정했습니다. 정확한 납입원금을 입력하시면 더 정확한 패널티 계산이 가능합니다.' : '') +
      '</p>';

    if (rm.name || rm.dept || rm.contact) {
      html += '<p class="report-signature" style="color:#131b2b;border-color:#f5ead0;">' + [rm.dept, rm.name, rm.contact].filter(Boolean).join(" · ") + "</p>";
    }

    // 배경색 문제가 반복 재현돼서, 지금 실제로 어느 빌드가 렌더링되고 있는지 화면/인쇄
    // 결과에서 바로 확인할 수 있게 작은 버전 표시를 남긴다(문제 해결되면 지워도 됨).
    html += '<p style="margin-top:8px;font-size:0.66rem;color:#b7bdc9;">build ' + REPORT_BUILD_TAG + '</p>';

    el.reportContent.innerHTML = html;
  }

  // 상품별 리포트에서 가장 먼저 보여줄 "그래서 어떻게 할지" 결론 배너.
  function buildRecommendBanner(r) {
    var bestRow = r.bestRow;
    if (bestRow && bestRow.diff !== null) {
      if (bestRow.diff > 0) {
        return '<div class="recommend-banner recommend-switch" style="background:#f5ead0;border-color:#b8892b;color:#0b1f3d;">' +
          '<p class="recommend-eyebrow">이 명세, 이렇게 하세요</p>' +
          '<p class="recommend-headline">중도해지 후 <strong style="color:#96701e;">' + escapeHtml(bestRow.label) + '</strong> 재예치 추천</p>' +
          '<p class="recommend-detail">만기까지 유지 대비 <strong style="color:#96701e;">' + formatSignedWon(bestRow.diff) + '</strong> 더 유리 (제안금리 ' + formatPct(bestRow.rate) + ', ' + methodLabel(bestRow.method) + ')</p>' +
          '</div>';
      }
      return '<div class="recommend-banner recommend-hold" style="background:#eaf1fb;border-color:#1c5cab;color:#0b1f3d;">' +
        '<p class="recommend-eyebrow">이 명세, 이렇게 하세요</p>' +
        '<p class="recommend-headline">만기까지 <strong style="color:#1c5cab;">유지</strong> 추천</p>' +
        '<p class="recommend-detail">재예치 최선안(' + escapeHtml(bestRow.label) + ') 대비 <strong style="color:#1c5cab;">' + formatSignedWon(-bestRow.diff) + '</strong> 더 유리</p>' +
        '</div>';
    }
    if (bestRow) {
      return '<div class="recommend-banner recommend-neutral" style="background:#f7f9fc;color:#131b2b;">' +
        '<p class="recommend-eyebrow">이 명세, 이렇게 하세요</p>' +
        '<p class="recommend-headline">최선 재예치 옵션: <strong>' + escapeHtml(bestRow.label) + '</strong></p>' +
        '<p class="recommend-detail">만기까지 유지 시 예상 수령액을 입력하면 정확한 유불리를 비교해드립니다</p>' +
        '</div>';
    }
    return '<div class="recommend-banner recommend-neutral" style="background:#f7f9fc;color:#131b2b;">' +
      '<p class="recommend-eyebrow">이 명세, 이렇게 하세요</p>' +
      '<p class="recommend-headline">신상품 제안금리를 입력하면 추천이 표시됩니다</p>' +
      '</div>';
  }

  function buildProductReportSection(r, idx, multi) {
    var c = r.c, history = r.history, penalty = r.penalty, rows = r.rows, bestRow = r.bestRow;
    var holdAmountForCompare = r.holdAmountForCompare, breakEvenRate = r.breakEvenRate;
    var html = "";

    html += '<div class="product-report' + (multi ? " product-report-divided" : "") + '" style="background:#ffffff;color:#131b2b;">';
    if (multi) {
      html += '<h3 class="product-report-title" style="color:#0b1f3d;">기존상품 ' + (idx + 1) + (c.label ? ' — ' + escapeHtml(c.label) : '') + '</h3>';
    }

    // ---- 결론(추천) 배너: 세부 수치보다 먼저 보여준다 ----
    html += buildRecommendBanner(r);

    // ---- 근거 KPI 타일 ----
    html += '<div class="kpi-row">';
    html += kpiTile("만기까지 유지 시", formatWon(holdAmountForCompare), "만기일 " + formatDateUTC(c.maturity) + (r.holdAmount === null ? " · " + methodLabel(c.method) + " 추정치" : ""), false);
    html += kpiTile("해지적립금(재예치 원금)", formatWon(penalty.cancelAmount), penalty.penaltyAmount !== null ? "해지패널티 " + formatWon(penalty.penaltyAmount) : (penalty.mode === "direct" ? "직접입력" : ""), false);
    if (bestRow) {
      html += kpiTile(
        "재예치 시(기존상품 만기 기준)",
        formatWon(bestRow.maturityAmount),
        bestRow.label + " · 제안금리 " + formatPct(bestRow.rate) + "(" + methodLabel(bestRow.method) + ") 가정 · " + formatDateUTC(c.maturity) + " 시점 환산액",
        false
      );
    }
    if (breakEvenRate !== null) {
      html += kpiTile("손익분기 금리", formatPct(breakEvenRate), "오늘 재예치해서 " + formatDateUTC(c.maturity) + "(기존상품 만기)까지 운용할 경우, 신상품 금리가 이 값 이상이어야 재예치가 유리", false);
    }
    html += '</div>';

    // ---- 신상품 옵션별 유불리 비교 ----
    html += buildCompareBars(r);

    // ---- 상세 정보 ----
    var asOfDiffers = c.contractStart && Math.abs(c.start.getTime() - c.contractStart.getTime()) > 24 * 3600 * 1000;
    html += '<div class="report-block" style="background:#ffffff;color:#131b2b;"><h4>기존상품 정보</h4>';
    html += kv(asOfDiffers ? "현재 적립금(적립금 산정일 " + formatDateUTC(c.start) + " 기준)" : "현재 적립금(명세일자 기준)", formatWon(c.principal));
    if (c.contributionPrincipal !== null) {
      html += kv("납입원금(참고)", formatWon(c.contributionPrincipal));
    } else if (history && history.netPrincipalEstimated) {
      html += kv("납입원금(추정)", formatWon(history.netPrincipal));
    }
    html += kv("명세일자 → 만기일", formatDateUTC(c.contractStart || c.start) + " → " + formatDateUTC(c.maturity));
    html += kv("약정금리(연) / 이자계산방식", formatPct(c.rate) + " / " + methodLabel(c.method));
    if (asOfDiffers) {
      html += kv("전체기간(명세일자 기준) / 잔여기간", formatYears(c.totalYears) + " / " + formatYears(c.remainingYears));
    } else {
      html += kv("전체기간 / 경과기간 / 잔여기간", formatYears(c.totalYears) + " / " + formatYears(c.elapsedYears) + " / " + formatYears(c.remainingYears));
    }
    if (history && history.hasEvents) {
      html += kv("중간인출 이력", history.events.length + "건, 인출총액 " + formatWon(history.withdrawnTotal));
    }
    if (history) {
      html += kv("오늘 기준 실제 잔액(세전, 추정)", formatWon(history.balanceToday));
    }
    html += "</div>";

    html += '<div class="report-block" style="background:#ffffff;color:#131b2b;"><h4>중도해지 시</h4>';
    html += kv("해지방식", penalty.mode === "direct" ? "해지적립금 직접입력" : "적용이율 비율 방식");
    if (penalty.penaltyAmount !== null) html += kv("해지패널티 금액", formatWon(penalty.penaltyAmount));
    html += kv("해지적립금(재예치 원금)", formatWon(penalty.cancelAmount));
    html += "</div>";

    if (r.product.attachments && r.product.attachments.length) {
      html += '<div class="report-block" style="background:#ffffff;color:#131b2b;"><h4>첨부: 해지패널티 계산 자료</h4>';
      r.product.attachments.forEach(function (a) {
        if (a.kind === "excel") {
          a.sheets.forEach(function (sheet) {
            if (a.sheets.length > 1) {
              html += '<p class="cell-note" style="color:#5c6576;"><strong style="color:#131b2b;">' + escapeHtml(a.name) + '</strong> — 시트: ' + escapeHtml(sheet.name) + '</p>';
            } else {
              html += '<p class="cell-note" style="color:#5c6576;">' + escapeHtml(a.name) + '</p>';
            }
            html += renderSheetTableHtml(sheet);
          });
        } else {
          html += '<p class="cell-note" style="color:#5c6576;">' + escapeHtml(a.name) + ' — 상품설명서 중 중도해지 관련 문구(참고용, RM 확인 필요)</p>';
          if (a.matchedTier) {
            html += '<p class="cell-note" style="color:#5c6576;">경과기간별 적용비율표에서 "' + escapeHtml(a.matchedTier.raw) + '" 구간이 적용되어 적용이율 비율 <strong style="color:#131b2b;">' + a.matchedTier.pct + '%</strong>로 자동 설정됨</p>';
          } else if (a.matchedFlatRatio) {
            html += '<p class="cell-note" style="color:#5c6576;">' + (a.matchedFlatRatio.productName ? '[' + escapeHtml(a.matchedFlatRatio.productName) + '] ' : '') +
              '"' + escapeHtml(a.matchedFlatRatio.raw) + '"에서 적용이율 비율 <strong style="color:#131b2b;">' + a.matchedFlatRatio.pct + '%</strong>로 자동 설정됨' +
              (a.flatMatchReason === "label" ? ' (상품명 일치로 자동 선택됨)' : '') + '</p>';
          } else if (a.flatRatios && a.flatRatios.length > 1) {
            html += '<p class="cell-note" style="color:#5c6576;">고정 중도해지비율 후보 ' + a.flatRatios.length + '개 발견(상품/옵션이 여러 개라 자동 설정 안 됨) — 아래에서 확인 후 직접 입력 필요</p>';
            html += '<pre class="pdf-snippet" style="background:#ffffff;color:#131b2b;border-color:#dde2ea;">' + escapeHtml(a.flatRatios.map(function (r2) { return (r2.productName ? '[' + r2.productName + '] ' : '') + r2.raw; }).join("\n")) + '</pre>';
          }
          a.snippets.forEach(function (s) {
            html += s.productName
              ? '<p class="cell-note" style="color:#5c6576;"><strong style="color:#131b2b;">[' + escapeHtml(s.productName) + ']</strong></p>'
              : '<p class="cell-note" style="color:#5c6576;">[공통 안내]</p>';
            html += '<pre class="pdf-snippet" style="background:#ffffff;color:#131b2b;border-color:#dde2ea;">' + escapeHtml(s.text) + '</pre>';
          });
        }
      });
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  // 신상품 옵션별로 "만기까지 유지 시" 대비 차액을 가로 막대로 보여준다.
  // 시간축 그래프 대신 결과(유불리 금액)만 바로 비교할 수 있게 단순화한 형태.
  function buildCompareBars(r) {
    var rows = r.rows, bestRow = r.bestRow;
    var diffRows = rows.filter(function (rr) { return rr.diff !== null; });
    if (!diffRows.length) return "";

    var maxAbs = Math.max.apply(null, diffRows.map(function (rr) { return Math.abs(rr.diff); })) || 1;
    var html = '<div class="report-block" style="background:#ffffff;color:#131b2b;"><h4>신상품 옵션별 유불리(만기까지 유지 대비)</h4>';
    html += '<div class="compare-bars">';
    var c = r.c;
    diffRows.forEach(function (rr) {
      var isBest = bestRow && rr === bestRow;
      var better = rr.diff >= 0;
      var halfPct = Math.min(50, Math.abs(rr.diff) / maxAbs * 50);
      var guideNote = "";
      if (rr.gapYears > 0.05 && rr.requiredReinvestRate !== null) {
        // 만기가 늦은 쪽이 바뀌면(신상품이 늦거나 빠르거나) "누가 재예치 쪽인지"도
        // 함께 바뀌어서, 부호(+/-)만으로는 어느 쪽이 유리한지 직관적으로 읽기 어렵다.
        // 필요금리가 0 이하로 나오면(=먼저 만기되는 쪽이 이미 앞서 있음) 그 사실을
        // "OO이 이미 더 유리"처럼 문장으로 바로 알려준다.
        var aheadAlready = rr.requiredReinvestRate <= 0;
        guideNote = rr.horizonDiffYears > 0
          ? ('<div class="compare-guide" style="background:#f7f9fc;color:#5c6576;border-color:#dde2ea;">이 상품 만기는 ' + formatDateUTC(rr.ownMaturityDate) + '로 기존상품 만기(' + formatDateUTC(c.maturity) + ')보다 ' + formatYears(rr.gapYears) + ' 늦습니다 — ' +
              (aheadAlready
                ? '기존상품을 만기까지 유지하기만 해도 이미 이 상품의 자체 만기 시점 금액을 넘어서 있어(그 뒤 ' + formatYears(rr.gapYears) + '을 마이너스로 재예치해도 동등), <strong style="color:#0b1f3d;">기존상품 유지가 이미 더 유리</strong>합니다.'
                : '기존상품을 만기까지 유지한 뒤 그 이후 ' + formatYears(rr.gapYears) + '간 최소 <strong style="color:#0b1f3d;">' + formatPct(rr.requiredReinvestRate) + '(연단리 기준)</strong> 이상 재예치해야 이 상품과 동등해집니다.') +
            '</div>')
          : ('<div class="compare-guide" style="background:#f7f9fc;color:#5c6576;border-color:#dde2ea;">이 상품 만기는 ' + formatDateUTC(rr.ownMaturityDate) + '로 기존상품 만기(' + formatDateUTC(c.maturity) + ')보다 ' + formatYears(rr.gapYears) + ' 빠릅니다 — ' +
              (aheadAlready
                ? '이 상품이 자체 만기 시점에 이미 기존상품을 만기까지 유지한 금액을 넘어서 있어(그 뒤 ' + formatYears(rr.gapYears) + '을 마이너스로 재예치해도 동등), <strong style="color:#0b1f3d;">이 상품이 이미 더 유리</strong>합니다.'
                : '이 상품 만기 이후 ' + formatYears(rr.gapYears) + '간 최소 <strong style="color:#0b1f3d;">' + formatPct(rr.requiredReinvestRate) + '(연단리 기준)</strong> 이상 재예치해야 기존상품 유지와 동등해집니다.') +
            '</div>');
      }
      html += '<div class="compare-row' + (isBest ? " compare-best" : "") + '"' + (isBest ? ' style="background:#f5ead0;"' : '') + '>' +
        '<div class="compare-label">' +
          '<span class="compare-name" style="color:#131b2b;">' + escapeHtml(rr.label) + (isBest ? ' <span class="badge accent">최선</span>' : '') + '</span>' +
          '<span class="compare-sub" style="color:#5c6576;">제안금리 ' + formatPct(rr.rate) + '(' + methodLabel(rr.method) + ') · 만기 시 ' + formatWon(rr.maturityAmount) + '</span>' +
        '</div>' +
        '<div class="compare-track" style="background:#f5f7fb;">' +
          '<div class="compare-zero"></div>' +
          '<div class="compare-bar ' + (better ? "better" : "worse") + '" style="' + (better ? "left:50%;width:" + halfPct : "right:50%;width:" + halfPct) + '%"></div>' +
        '</div>' +
        '<div class="compare-diff ' + (better ? "better" : "worse") + '" style="color:' + (better ? "#0ca30c" : "#d03b3b") + ';">' + formatSignedWon(rr.diff) + '</div>' +
        guideNote +
      '</div>';
    });
    html += '</div>';
    html += '<p class="chart-caption" style="color:#5c6576;">"만기까지 유지 시" 대비 차액(이 상품 만기일 기준 환산). 오른쪽(초록) = 재예치 유리 · 왼쪽(빨강) = 유지 유리.</p>';
    html += '</div>';
    return html;
  }

  function kv(label, value) {
    return '<div class="report-kv" style="color:#131b2b;border-color:#d8dae0;"><span style="color:#5c6576;">' + escapeHtml(label) + '</span><span style="color:#131b2b;">' + value + "</span></div>";
  }

  function kpiTile(label, value, sub, accent) {
    return '<div class="kpi-tile' + (accent ? ' accent' : '') + '" style="background:' + (accent ? '#f5ead0' : '#f7f9fc') + ';color:#131b2b;">' +
      '<p class="kpi-label" style="color:#5c6576;">' + escapeHtml(label) + '</p>' +
      '<p class="kpi-value" style="color:' + (accent ? '#96701e' : '#0b1f3d') + ';">' + value + '</p>' +
      (sub ? '<p class="kpi-sub" style="color:#5c6576;">' + escapeHtml(sub) + '</p>' : '') +
      '</div>';
  }

  // ---------- PDF 저장(브라우저 인쇄 대신 직접 생성) ----------
  // 기기의 "강제 다크모드"(웹사이트를 다크 테마로 표시) 기능이 브라우저의 인쇄 파이프라인
  // 자체를 가로채서, CSS로 아무리 밝게 고정해도(변수 고정, color-scheme, 인라인 스타일까지)
  // 인쇄/PDF 결과가 계속 어둡게 나오는 문제가 실제 기기에서 반복 재현됐다. 그래서 브라우저의
  // 인쇄 기능(window.print)에 기대는 대신, html2canvas로 결과 화면을 캔버스(그림)로 직접
  // 그린 뒤 jsPDF로 PDF 파일을 만들어 바로 다운로드한다 — 살아있는 페이지를 "인쇄"하는 게
  // 아니라 캔버스에 픽셀을 그려서 PDF에 넣는 방식이라, 브라우저의 다크모드 보정이 끼어들
  // 지점 자체가 없다(캔버스 그리기는 그 보정 대상이 아님).
  // jsPDF 내장 save()가 만드는 다운로드 링크는 일부 환경(예: file:// 등)에서 파일명이
  // 한글일 때 그냥 "download"로만 저장되는 경우가 있어서, blob을 직접 받아 우리가
  // 앵커를 만들어 내려받는다 — 그래야 원하는 파일명이 확실히 적용된다.
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  // 파일명은 일부러 한글을 안 쓴다 — blob 다운로드에서 한글 파일명을 쓰면 브라우저가
  // 확장자 없는 "download"라는 이름으로 저장해버리는 경우가 실제로 있었다(확인됨).
  // 영문/숫자만 쓰면 어떤 환경에서도 확장자(.pdf)까지 확실히 붙는다.
  function getReportPdfFilename() {
    var d = todayLocalDate();
    var dateStr = d.getUTCFullYear() + ("0" + (d.getUTCMonth() + 1)).slice(-2) + ("0" + d.getUTCDate()).slice(-2);
    return "withdrawal-penalty-simulation-" + dateStr + ".pdf";
  }

  // 카드/표 줄/타일 같은 단위가 페이지 경계에서 잘리지 않도록, "이 지점부터는 새 페이지로
  // 넘겨도 안전하다"고 볼 수 있는 후보 지점들의 세로 위치(컨테이너 맨 위 기준)를 모은다.
  function collectSafePageBreakOffsets(container) {
    var selector = [
      ".product-report", ".kpi-tile", ".conclusion-item", ".compare-row",
      ".report-table tr", ".report-block", ".attachment-row", ".recommend-banner"
    ].join(",");
    var containerTop = container.getBoundingClientRect().top;
    var offsets = [0];
    Array.prototype.forEach.call(container.querySelectorAll(selector), function (node) {
      var top = node.getBoundingClientRect().top - containerTop;
      if (top > 0) offsets.push(top);
    });
    offsets.sort(function (a, b) { return a - b; });
    return offsets;
  }

  // 기존상품이 여러 건이면(.product-report-divided) 화면 미리보기와 마찬가지로 상품별로
  // 항상 새 페이지에서 시작하게 한다 — collectSafePageBreakOffsets는 "잘리지만 않으면
  // 되는" 후보일 뿐이라 페이지에 자리가 남으면 다음 상품을 이어붙일 수 있는데, 상품별로
  // 반드시 새 페이지로 나눠 달라는 요청이 있어서 이건 예외 없이 강제로 끊는다.
  function collectHardPageBreakOffsets(container) {
    var containerTop = container.getBoundingClientRect().top;
    var offsets = [];
    Array.prototype.forEach.call(container.querySelectorAll(".product-report-divided"), function (node) {
      var top = node.getBoundingClientRect().top - containerTop;
      if (top > 0) offsets.push(top);
    });
    offsets.sort(function (a, b) { return a - b; });
    return offsets;
  }

  // safeOffsets 중에서 target을 넘지 않는 가장 큰 값을 찾는다(=target에 최대한 가깝게
  // 붙이되 카드 중간을 자르지 않는 지점). minOffset보다는 커야 한다(페이지가 안 줄어들게).
  function nearestSafeOffset(safeOffsets, target, minOffset) {
    var best = minOffset;
    for (var i = 0; i < safeOffsets.length; i++) {
      var v = safeOffsets[i];
      if (v > minOffset && v <= target) best = v;
      if (v > target) break;
    }
    return best;
  }

  function generateReportPdf() {
    if (typeof html2canvas === "undefined" || typeof window.jspdf === "undefined") {
      alert("PDF 생성 기능을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.");
      return;
    }
    var target = el.reportSection;
    if (!target) return;

    var originalLabel = el.printBtn.textContent;
    el.printBtn.disabled = true;
    el.printBtn.textContent = "PDF 생성 중...";

    // 폰 화면 폭(좁은 한 칸짜리 모바일 레이아웃) 그대로 캡처해서 A4 폭에 맞게 늘리면,
    // 원래 좁은 폭 때문에 세로로 아주 길었던 내용이 그대로 다 늘어나서 페이지가 수십
    // 장으로 잘게 쪼개지는 문제가 있었다(확인됨). 인쇄에 적당한 폭(A4 비율에 가까운
    // 800px)짜리 임시 복제본을 화면 밖에 만들어 그걸 캡처하면, 데스크톱 화면처럼 좀 더
    // 옆으로 넓게 자리잡아 실제 인쇄 페이지 수만큼만 나온다. 화면에 보이는 원본은 건드리지
    // 않는다(사용자가 보는 화면이 순간적으로 바뀌면 안 되므로).
    var PDF_CAPTURE_WIDTH = 800;
    var clone = target.cloneNode(true);
    clone.removeAttribute("id");
    clone.style.position = "fixed";
    clone.style.top = "0";
    clone.style.left = "-99999px";
    clone.style.width = PDF_CAPTURE_WIDTH + "px";
    clone.style.maxWidth = PDF_CAPTURE_WIDTH + "px";
    clone.style.margin = "0";
    // .no-print(예: "결과 요약 미리보기" 제목)는 원래 @media print에서만 안 보이게
    // 숨겨지던 요소인데, html2canvas는 인쇄 미디어를 안 거치고 화면에 보이는 그대로
    // 캡처해서 이 요소들이 그대로 찍혀버린다(배너의 음수 마진과 겹쳐서 겉보기 이상하게
    // 나오는 문제로 발견됨). 캡처 전에 명시적으로 지운다.
    Array.prototype.forEach.call(clone.querySelectorAll(".no-print"), function (n) { n.remove(); });
    document.body.appendChild(clone);

    // 카드 등이 잘리지 않을 안전한 페이지 분할 지점과, 상품별로 반드시 새 페이지에서
    // 시작해야 하는 강제 분할 지점을 캔버스로 그리기 전(요소가 실제 레이아웃된 상태)에
    // 미리 측정해둔다. 복제본 기준으로 측정해야 실제 캡처될 레이아웃과 일치한다.
    var safeOffsetsCss = collectSafePageBreakOffsets(clone);
    var hardOffsetsCss = collectHardPageBreakOffsets(clone);

    html2canvas(clone, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      windowWidth: PDF_CAPTURE_WIDTH
    }).then(function (canvas) {
      document.body.removeChild(clone);
      var jsPDFCtor = window.jspdf.jsPDF;
      var pdf = new jsPDFCtor({ unit: "mm", format: "a4", compress: true });
      var MARGIN_MM = 8;
      var pageWidthMm = pdf.internal.pageSize.getWidth() - MARGIN_MM * 2;
      var pageHeightMm = pdf.internal.pageSize.getHeight() - MARGIN_MM * 2;

      // 캔버스 픽셀 <-> mm 환산 비율(캔버스 전체 너비가 여백을 뺀 페이지 너비에 딱
      // 맞도록 스케일). 여백 없이 0,0부터 꽉 채우면 맨 위 글자가 살짝 잘려 보이는
      // 문제가 있어서(확인됨) 사방에 여백을 둔다.
      var pxPerMm = canvas.width / pageWidthMm;
      var pageHeightPx = pageHeightMm * pxPerMm;
      var safeOffsetsPx = safeOffsetsCss.map(function (v) { return v * (canvas.width / PDF_CAPTURE_WIDTH); });
      var hardOffsetsPx = hardOffsetsCss.map(function (v) { return v * (canvas.width / PDF_CAPTURE_WIDTH); });

      var sliceStartPx = 0;
      var firstPage = true;
      while (sliceStartPx < canvas.height - 1) {
        // 이 구간 안에 상품 경계(강제 개행)가 있으면, 안전분할과 무관하게 거기서 반드시
        // 끊는다 — 상품별로 항상 새 페이지에서 시작하게(내용이 남아도 다음 상품을
        // 이어붙이지 않는다).
        var nextHardBreak = null;
        for (var hi = 0; hi < hardOffsetsPx.length; hi++) {
          if (hardOffsetsPx[hi] > sliceStartPx) { nextHardBreak = hardOffsetsPx[hi]; break; }
        }
        var segmentEndPx = nextHardBreak !== null ? Math.min(canvas.height, nextHardBreak) : canvas.height;

        var naiveEnd = sliceStartPx + pageHeightPx;
        var sliceEndPx;
        if (naiveEnd >= segmentEndPx) {
          sliceEndPx = segmentEndPx;
        } else {
          sliceEndPx = nearestSafeOffset(safeOffsetsPx, naiveEnd, sliceStartPx + pageHeightPx * 0.5);
        }
        if (sliceEndPx <= sliceStartPx) sliceEndPx = Math.min(segmentEndPx, sliceStartPx + pageHeightPx);

        var sliceHeightPx = sliceEndPx - sliceStartPx;
        var sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeightPx;
        var ctx = sliceCanvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, sliceStartPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);

        var imgData = sliceCanvas.toDataURL("image/jpeg", 0.92);
        if (!firstPage) pdf.addPage();
        pdf.addImage(imgData, "JPEG", MARGIN_MM, MARGIN_MM, pageWidthMm, sliceHeightPx / pxPerMm);
        firstPage = false;
        sliceStartPx = sliceEndPx;
      }

      downloadBlob(pdf.output("blob"), getReportPdfFilename());
    }).catch(function (e) {
      if (clone.parentNode) document.body.removeChild(clone);
      alert("PDF 생성 중 문제가 발생했습니다: " + (e && e.message ? e.message : e));
    }).then(function () {
      el.printBtn.disabled = false;
      el.printBtn.textContent = originalLabel;
    });
  }

  // ---------- 초기화/이벤트 ----------

  function resetAll() {
    el.customerName.value = "";
    el.todayDate.value = formatDateUTC(todayLocalDate());
    el.existingProducts.innerHTML = "";
    state.products = [];
    addProduct();
    renderReport();
  }

  function bindEvents() {
    el.customerName.addEventListener("input", renderReport);
    el.todayDate.addEventListener("input", renderReport);

    el.addExistingProduct.addEventListener("click", function () {
      addProduct();
      renderReport();
    });

    el.addProductRow.addEventListener("click", function () {
      addRow();
      saveRows();
      renderRows();
      renderReport();
    });

    [el.rmName, el.rmDept, el.rmContact].forEach(function (input) {
      input.addEventListener("input", function () {
        saveRmInfo();
        renderReport();
      });
    });

    el.printBtn.addEventListener("click", function () {
      generateReportPdf();
    });

    el.resetBtn.addEventListener("click", function () {
      if (confirm("고객/기존상품 정보를 모두 지울까요? (신상품 금리 목록과 작성자 정보는 유지됩니다)")) {
        resetAll();
      }
    });
  }

  function init() {
    cacheEls();

    bindDateMask(el.todayDate, null);
    el.todayDate.value = formatDateUTC(todayLocalDate());

    state.rows = loadRows().map(function (r) {
      return { id: state.nextId++, label: r.label, years: r.years, rate: r.rate };
    });

    var rm = loadRmInfo();
    el.rmName.value = rm.name || "";
    el.rmDept.value = rm.dept || "";
    el.rmContact.value = rm.contact || "";

    renderRows();
    addProduct();
    bindEvents();
    renderReport();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
