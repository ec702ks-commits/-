(function () {
  "use strict";

  var PRODUCTS_KEY = "wpsim_new_products_v1";
  var RM_INFO_KEY = "wpsim_rm_info_v1";

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
      "rmName", "rmDept", "rmContact", "printBtn", "resetBtn", "reportContent"
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

  function computeHistory(c, events) {
    if (c.principal === null || c.rate === null || !c.start || !c.today) return null;
    var r = c.rate / 100;
    var validEvents = events
      .filter(function (e) { return e.date.getTime() >= c.start.getTime() && e.date.getTime() <= c.today.getTime(); })
      .sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });

    // "잔액"은 입력한 현재 적립금에서 출발해 그대로 굴린다.
    // "순원금"(패널티 계산 시 원금/이자를 나누는 기준)은:
    // - 납입원금(선택)을 입력했으면 그 값을 그대로 사용(정확).
    // - 입력하지 않았으면 명세일자~오늘 경과기간만큼 적립금을 거꾸로
    //   할인해서 순원금을 보수적으로 추정한다(연단리/연복리/월복리에
    //   따라 할인 계산식이 달라진다). 납입원금을 입력하면 이 추정치보다
    //   항상 우선 적용된다.
    var netPrincipalEstimated = false;
    var netPrincipalBase;
    if (c.contributionPrincipal !== null) {
      netPrincipalBase = c.contributionPrincipal;
    } else {
      var elapsedForEstimate = Math.max(0, c.elapsedYears || 0);
      netPrincipalBase = c.principal / growthFactor(c.method, r, elapsedForEstimate);
      netPrincipalEstimated = true;
    }

    var balance = c.principal;
    var netPrincipal = netPrincipalBase;
    var segStart = c.start;

    validEvents.forEach(function (e) {
      var segYears = Math.max(0, yearsBetween(segStart, e.date) || 0);
      balance = Math.max(0, balance * growthFactor(c.method, r, segYears) - e.amount);
      netPrincipal = Math.max(0, netPrincipal - e.amount);
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
        '<p class="hint">당사 시스템에서 나오는 해지패널티 계산 자료를 첨부하면 아래 계산기 항목(적립금·날짜·금리 등)을 자동으로 인식해서 채워줍니다. 이미지(스크린샷, 사진) 또는 엑셀 파일(.xlsx/.xls/.csv)을 지원하며, 여러 개 첨부할 수 있습니다. 파일은 서버로 전송되지 않고 이 화면 안에서만 처리됩니다. 자동으로 채워진 값은 아래에서 언제든 직접 수정할 수 있습니다.</p>' +
        '<input type="file" accept="image/*,.xlsx,.xls,.csv" data-field="attachmentFile" />' +
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
      bindDateMask(dateInput, null);
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
      var file = refs.attachmentFileInput.files && refs.attachmentFileInput.files[0];
      refs.attachmentFileInput.value = "";
      if (!file) return;

      if (/^image\//.test(file.type)) {
        var reader = new FileReader();
        reader.onload = function () {
          p.attachments.push({ id: state.nextId++, kind: "image", name: file.name, dataUrl: reader.result });
          renderProductAttachments(p);
          renderReport();
        };
        reader.readAsDataURL(file);
        return;
      }

      if (/\.(xlsx|xls|csv)$/i.test(file.name)) {
        if (typeof XLSX === "undefined") {
          alert("엑셀을 읽는 기능을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.");
          return;
        }
        parseSpreadsheetFile(file, function (err, sheets) {
          if (err || !sheets || !sheets.length) {
            alert("이 파일을 열 수 없습니다. 비밀번호가 걸려 있거나 지원하지 않는 형식일 수 있습니다.");
            return;
          }

          // 1) "헤더 한 줄 + 상품별 데이터행" 표 형식 먼저 시도(당사 시스템 다건 조회 자료 등).
          //    행이 여러 개면 첫 행은 이 카드에, 나머지는 새 상품카드를 자동으로 추가해 채운다.
          var tableRecords = extractTableRecordsFromSheets(sheets);
          if (tableRecords.length) {
            var targets = tableRecords.map(function (rec, idx) {
              var targetProduct = idx === 0 ? p : addProduct();
              var applied = applyTableRecordToProduct(targetProduct, rec);
              updateProductPenaltyModeUI(targetProduct);
              return { product: targetProduct, applied: applied };
            });
            targets[0].product.attachments.push({ id: state.nextId++, kind: "excel", name: file.name, sheets: sheets, appliedFields: targets[0].applied });
            renderProductAttachments(targets[0].product);
            targets.forEach(function (t, idx) {
              renderAutofillSummary(t.product, t.applied, file.name, targets.length, idx);
            });
            updateProductChrome();
            renderReport();
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
        });
        return;
      }

      alert("이미지(스크린샷, 사진) 또는 엑셀 파일(.xlsx/.xls/.csv)만 첨부할 수 있습니다.");
    });

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
        : '<img class="attachment-thumb" src="' + a.dataUrl + '" alt="' + escapeAttr(a.name) + '" />';
      var appliedCount = (a.appliedFields && a.appliedFields.length) || 0;
      var nameHtml = a.kind === "excel"
        ? escapeHtml(a.name) + '<span class="attachment-meta">' + a.sheets.length + '개 시트 · ' + a.sheets.reduce(function (s, sh) { return s + sh.rows.length; }, 0) + '행 인식됨' +
          (appliedCount ? ' · ' + appliedCount + '개 항목 자동입력됨' : '') + '</span>'
        : escapeHtml(a.name);
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
    { field: "maturityDate", type: "date", displayLabel: "만기일", headers: ["만기일자", "만기일"] },
    { field: "principal", type: "amount", displayLabel: "현재 적립금", headers: ["적립금", "현재적립금", "평가금액"] },
    { field: "contributionPrincipal", type: "amount", displayLabel: "납입원금", headers: ["납입원금", "납입원본", "가입원금"] },
    { field: "contractRate", type: "rate", displayLabel: "약정금리(명세 적용이율)", headers: ["명세적용이율", "적용이율", "약정금리", "계약금리", "적용금리"] },
    { field: "directCancelAmount", type: "amount", displayLabel: "해지적립금(해지환급금)", headers: ["해지환급금", "해지적립금", "해지후적립금", "재예치가능금액"] },
    { field: "directPenaltyAmount", type: "amount", displayLabel: "해지패널티 금액", headers: ["중도해지페널티", "중도해지패널티", "해지패널티", "해지패널티금액", "패널티"] }
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
    return null;
  }

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
          records.push(rec);
        }
        break; // 시트당 표 하나만 처리
      }
    });
    return records;
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
    delete extracted.asOfDate;

    var applied = applyExtractedFields(targetProduct, extracted);

    targetProduct.principalAsOfDate = asOfDateValue;
    if (asOfDateValue) {
      applied.push({ field: "asOfDate", label: "적립금기준일자(경과이자 계산 기준, 화면에는 표시 안 됨)", display: asOfDateValue });
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

  function renderAutofillSummary(p, applied, fileName, totalRecords, recordIndex) {
    var box = p.refs.autofillSummaryEl;
    if (!box) return;
    var multiNote = "";
    if (totalRecords && totalRecords > 1) {
      multiNote = '<p class="autofill-multi-note">이 파일에서 상품 정보 ' + totalRecords + '건을 인식했습니다. 이 카드에는 ' + (recordIndex + 1) + '번째 항목을 채웠습니다' +
        (recordIndex === 0 ? ' (나머지 ' + (totalRecords - 1) + '건은 새 상품카드로 자동 추가되었습니다).' : '.') + '</p>';
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

    var html = '<div class="table-scroll"><table class="report-table attachment-excel-table"><tbody>';
    sheet.rows.forEach(function (row) {
      html += "<tr>";
      row.forEach(function (cell, ci) {
        if (dropCols[ci]) return;
        html += (wideCols[ci] ? '<td class="col-wide">' : "<td>") + escapeHtml(cell === null || cell === undefined ? "" : cell) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    if (sheet.truncated) {
      html += '<p class="cell-note">(내용이 많아 앞부분만 표시했습니다. 전체 내용은 원본 파일을 확인해주세요.)</p>';
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

    ["simple", "compoundYear", "compoundMonth"].forEach(function (m) {
      var cForMethod = Object.assign({}, c, { method: m });
      var hForMethod = computeHistory(cForMethod, events);
      var base = hForMethod ? hForMethod.balanceToday : c.principal;
      results[m] = base * growthFactor(m, c.rate / 100, t);
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
      cancelAmount = parseAmountStr(refs.directCancelAmountInput.value);
      penaltyAmount = parseAmountStr(refs.directPenaltyAmountInput.value);
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
      refs.historySummaryEl.textContent =
        (history.hasEvents ? "인출 이력 " + history.events.length + "건 반영 · 인출총액 " + formatWon(history.withdrawnTotal) + " · " : "") +
        "오늘 기준 실제 잔액(세전, 추정) " + formatWon(history.balanceToday) + breakdown;
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
    var html = '<div class="report-block conclusion-summary"><h3>결론: 명세별 추천</h3>';
    html += '<div class="conclusion-list">';
    validResults.forEach(function (r, idx) {
      var c = r.c, bestRow = r.bestRow;
      var name = escapeHtml(c.label || "기존상품 " + (idx + 1));
      var verdict, diffText, cls;
      if (bestRow && bestRow.diff !== null) {
        if (bestRow.diff > 0) {
          verdict = "재예치(" + escapeHtml(bestRow.label) + ")";
          diffText = formatSignedWon(bestRow.diff) + " 더 유리";
          cls = "better";
        } else {
          verdict = "유지";
          diffText = formatSignedWon(-bestRow.diff) + " 더 유리";
          cls = "hold";
        }
      } else {
        verdict = "-";
        diffText = "신상품 금리 입력 필요";
        cls = "neutral";
      }
      html += '<div class="conclusion-item">' +
        '<div class="conclusion-item-top">' +
          '<span class="conclusion-num">' + (idx + 1) + '</span>' +
          '<span class="conclusion-title">' + name + '</span>' +
          '<span class="badge ' + cls + '">' + verdict + '</span>' +
        '</div>' +
        '<div class="conclusion-item-diff ' + cls + '">' + diffText + '</div>' +
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
      html += '<div class="breakdown-row">' +
        '<span class="breakdown-name">' + (idx + 1) + '. ' + name + '</span>' +
        '<span class="breakdown-vals">' +
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
    html += '<div class="report-banner">';
    html += '<p class="report-banner-eyebrow">퇴직연금 상품 제안서' + (multi ? " · 기존상품 " + validResults.length + "건" : "") + '</p>';
    html += '<p class="report-title">중도해지 · 재예치 시뮬레이션' + (customerName ? " — " + escapeHtml(customerName) : "") + '</p>';
    html += '<p class="report-meta">작성일 ' + formatDateUTC(todayLocalDate()) + (todayVal ? ' · 해지(기준)일 ' + formatDateUTC(todayVal) : '') + '</p>';
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
      html += '<div class="report-block"><h3>기존상품 ' + validResults.length + '건 합계</h3>';
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

    html += '<p class="report-disclaimer">본 시뮬레이션은 입력하신 정보를 기준으로 한 추정 참고자료이며, 실제 적용금리·세금·수수료 등에 따라 실수령액과 차이가 있을 수 있습니다. 신상품 재예치 금액은 각 기존상품 만기일까지의 잔여기간에 제안금리(단리)를 적용해 환산한 값이며, 상품 자체 만기가 그보다 짧거나 길 경우 이후 재투자 조건은 별도로 확인이 필요합니다. 신상품 제안금리는 안내 시점 기준이며 향후 변동될 수 있습니다.' +
      (validResults.some(function (r) { return r.history && r.history.hasEvents; }) ? ' 중간인출 이력은 인출액이 원금에서 먼저 차감된 것으로 보수적으로 가정해 계산했으며, 정확한 금액은 상품사 확인이 필요합니다.' : '') +
      (validResults.some(function (r) { return r.history && r.history.netPrincipalEstimated; }) ? ' 납입원금을 별도로 입력하지 않은 상품은 현재 적립금을 경과기간만큼 할인해 순원금을 추정했습니다. 정확한 납입원금을 입력하시면 더 정확한 패널티 계산이 가능합니다.' : '') +
      '</p>';

    if (rm.name || rm.dept || rm.contact) {
      html += '<p class="report-signature">' + [rm.dept, rm.name, rm.contact].filter(Boolean).join(" · ") + "</p>";
    }

    el.reportContent.innerHTML = html;
  }

  // 상품별 리포트에서 가장 먼저 보여줄 "그래서 어떻게 할지" 결론 배너.
  function buildRecommendBanner(r) {
    var bestRow = r.bestRow;
    if (bestRow && bestRow.diff !== null) {
      if (bestRow.diff > 0) {
        return '<div class="recommend-banner recommend-switch">' +
          '<p class="recommend-eyebrow">이 명세, 이렇게 하세요</p>' +
          '<p class="recommend-headline">중도해지 후 <strong>' + escapeHtml(bestRow.label) + '</strong> 재예치 추천</p>' +
          '<p class="recommend-detail">만기까지 유지 대비 <strong>' + formatSignedWon(bestRow.diff) + '</strong> 더 유리 (제안금리 ' + formatPct(bestRow.rate) + ', ' + methodLabel(bestRow.method) + ')</p>' +
          '</div>';
      }
      return '<div class="recommend-banner recommend-hold">' +
        '<p class="recommend-eyebrow">이 명세, 이렇게 하세요</p>' +
        '<p class="recommend-headline">만기까지 <strong>유지</strong> 추천</p>' +
        '<p class="recommend-detail">재예치 최선안(' + escapeHtml(bestRow.label) + ') 대비 <strong>' + formatSignedWon(-bestRow.diff) + '</strong> 더 유리</p>' +
        '</div>';
    }
    if (bestRow) {
      return '<div class="recommend-banner recommend-neutral">' +
        '<p class="recommend-eyebrow">이 명세, 이렇게 하세요</p>' +
        '<p class="recommend-headline">최선 재예치 옵션: <strong>' + escapeHtml(bestRow.label) + '</strong></p>' +
        '<p class="recommend-detail">만기까지 유지 시 예상 수령액을 입력하면 정확한 유불리를 비교해드립니다</p>' +
        '</div>';
    }
    return '<div class="recommend-banner recommend-neutral">' +
      '<p class="recommend-eyebrow">이 명세, 이렇게 하세요</p>' +
      '<p class="recommend-headline">신상품 제안금리를 입력하면 추천이 표시됩니다</p>' +
      '</div>';
  }

  function buildProductReportSection(r, idx, multi) {
    var c = r.c, history = r.history, penalty = r.penalty, rows = r.rows, bestRow = r.bestRow;
    var holdAmountForCompare = r.holdAmountForCompare, breakEvenRate = r.breakEvenRate;
    var html = "";

    html += '<div class="product-report' + (multi ? " product-report-divided" : "") + '">';
    if (multi) {
      html += '<h3 class="product-report-title">기존상품 ' + (idx + 1) + (c.label ? ' — ' + escapeHtml(c.label) : '') + '</h3>';
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
    html += '<div class="report-block"><h4>기존상품 정보</h4>';
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

    html += '<div class="report-block"><h4>중도해지 시</h4>';
    html += kv("해지방식", penalty.mode === "direct" ? "해지적립금 직접입력" : "적용이율 비율 방식");
    if (penalty.penaltyAmount !== null) html += kv("해지패널티 금액", formatWon(penalty.penaltyAmount));
    html += kv("해지적립금(재예치 원금)", formatWon(penalty.cancelAmount));
    html += "</div>";

    if (r.product.attachments && r.product.attachments.length) {
      html += '<div class="report-block"><h4>첨부: 해지패널티 계산 자료</h4>';
      r.product.attachments.forEach(function (a) {
        if (a.kind === "excel") {
          a.sheets.forEach(function (sheet) {
            if (a.sheets.length > 1) {
              html += '<p class="cell-note"><strong>' + escapeHtml(a.name) + '</strong> — 시트: ' + escapeHtml(sheet.name) + '</p>';
            } else {
              html += '<p class="cell-note">' + escapeHtml(a.name) + '</p>';
            }
            html += renderSheetTableHtml(sheet);
          });
        } else {
          html += '<img class="attachment-print-image" src="' + a.dataUrl + '" alt="해지패널티 계산 자료" />';
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
    var html = '<div class="report-block"><h4>신상품 옵션별 유불리(만기까지 유지 대비)</h4>';
    html += '<div class="compare-bars">';
    var c = r.c;
    diffRows.forEach(function (rr) {
      var isBest = bestRow && rr === bestRow;
      var better = rr.diff >= 0;
      var halfPct = Math.min(50, Math.abs(rr.diff) / maxAbs * 50);
      var guideNote = "";
      if (rr.gapYears > 0.05 && rr.requiredReinvestRate !== null) {
        guideNote = rr.horizonDiffYears > 0
          ? '<div class="compare-guide">이 상품 만기는 ' + formatDateUTC(rr.ownMaturityDate) + '로 기존상품 만기(' + formatDateUTC(c.maturity) + ')보다 ' + formatYears(rr.gapYears) + ' 늦습니다 — 기존상품을 만기까지 유지한 뒤 그 이후 ' + formatYears(rr.gapYears) + '간 최소 <strong>' + formatPct(rr.requiredReinvestRate) + '</strong> 이상 재예치해야 이 상품과 동등해집니다.</div>'
          : '<div class="compare-guide">이 상품 만기는 ' + formatDateUTC(rr.ownMaturityDate) + '로 기존상품 만기(' + formatDateUTC(c.maturity) + ')보다 ' + formatYears(rr.gapYears) + ' 빠릅니다 — 이 상품 만기 이후 ' + formatYears(rr.gapYears) + '간 최소 <strong>' + formatPct(rr.requiredReinvestRate) + '</strong> 이상 재예치해야 기존상품 유지와 동등해집니다.</div>';
      }
      html += '<div class="compare-row' + (isBest ? " compare-best" : "") + '">' +
        '<div class="compare-label">' +
          '<span class="compare-name">' + escapeHtml(rr.label) + (isBest ? ' <span class="badge accent">최선</span>' : '') + '</span>' +
          '<span class="compare-sub">제안금리 ' + formatPct(rr.rate) + '(' + methodLabel(rr.method) + ') · 만기 시 ' + formatWon(rr.maturityAmount) + '</span>' +
        '</div>' +
        '<div class="compare-track">' +
          '<div class="compare-zero"></div>' +
          '<div class="compare-bar ' + (better ? "better" : "worse") + '" style="' + (better ? "left:50%;width:" + halfPct : "right:50%;width:" + halfPct) + '%"></div>' +
        '</div>' +
        '<div class="compare-diff ' + (better ? "better" : "worse") + '">' + formatSignedWon(rr.diff) + '</div>' +
        guideNote +
      '</div>';
    });
    html += '</div>';
    html += '<p class="chart-caption">"만기까지 유지 시" 대비 차액(이 상품 만기일 기준 환산). 오른쪽(초록) = 재예치 유리 · 왼쪽(빨강) = 유지 유리.</p>';
    html += '</div>';
    return html;
  }

  function kv(label, value) {
    return '<div class="report-kv"><span>' + escapeHtml(label) + '</span><span>' + value + "</span></div>";
  }

  function kpiTile(label, value, sub, accent) {
    return '<div class="kpi-tile' + (accent ? ' accent' : '') + '">' +
      '<p class="kpi-label">' + escapeHtml(label) + '</p>' +
      '<p class="kpi-value">' + value + '</p>' +
      (sub ? '<p class="kpi-sub">' + escapeHtml(sub) + '</p>' : '') +
      '</div>';
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
      window.print();
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
