(function () {
  "use strict";

  var PRODUCTS_KEY = "wpsim_new_products_v1";
  var RM_INFO_KEY = "wpsim_rm_info_v1";

  var DEFAULT_ROWS = [
    { label: "1년", years: 1 },
    { label: "2년", years: 2 },
    { label: "2.5년", years: 2.5 },
    { label: "3년", years: 3 },
    { label: "5년", years: 5 }
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

  // 달력 기준 개월수 더하기. 대상 월에 그 날짜가 없으면(예: 12/31 + 6개월 = 6월엔
  // 31일이 없음) 다음 달로 넘어가지 않고 그 달의 마지막 날로 맞춘다(6/30).
  function addMonthsClamped(date, months) {
    var y = date.getUTCFullYear();
    var m = date.getUTCMonth();
    var d = date.getUTCDate();
    var total = m + months;
    var newYear = y + Math.floor(total / 12);
    var newMonth = ((total % 12) + 12) % 12;
    var daysInTargetMonth = new Date(Date.UTC(newYear, newMonth + 1, 0)).getUTCDate();
    var newDay = Math.min(d, daysInTargetMonth);
    return new Date(Date.UTC(newYear, newMonth, newDay));
  }

  // 달력 기준으로 정확히 N년 뒤를 계산한다(예: 2025.12.31 + 5년 = 2030.12.31,
  // 2025.12.31 + 2.5년 = 2028.06.30). 연 단위를 개월수로 환산해 달력으로
  // 이동하므로 1/2/2.5/3/5년처럼 개월 단위로 떨어지는 기간은 항상 정확하다.
  function addYears(date, years) {
    return addMonthsClamped(date, Math.round(years * 12));
  }

  function yearsBetween(d1, d2) {
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

  function formatWonShort(n) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    var v = Math.round(n);
    var sign = v < 0 ? "-" : "";
    v = Math.abs(v);
    if (v >= 100000000) {
      var eok = v / 100000000;
      return sign + (Number.isInteger(eok) ? eok : eok.toFixed(1)) + "억";
    }
    if (v >= 10000) return sign + Math.round(v / 10000).toLocaleString("ko-KR") + "만";
    return sign + v.toLocaleString("ko-KR");
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
      return parsed;
    } catch (e) {
      return DEFAULT_ROWS.map(function (r) { return Object.assign({}, r, { rate: "" }); });
    }
  }

  function saveRows() {
    var data = state.rows.map(function (r) {
      return { label: r.label, years: r.years, rate: r.rate };
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
        '<button type="button" class="btn small danger" data-action="delete">삭제</button>';

      wrap.querySelectorAll("input").forEach(function (input) {
        input.addEventListener("input", function () {
          row[input.getAttribute("data-field")] = input.type === "number"
            ? (input.value === "" ? "" : parseFloat(input.value))
            : input.value;
          saveRows();
          renderReport();
        });
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
    state.rows.push(Object.assign({ id: state.nextId++, label: "", years: "", rate: "" }, preset || {}));
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
    return { id: state.nextId++, withdrawals: [], refs: {} };
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

    bindDateMask(refs.startDateInput, refs.maturityDateInput);
    bindDateMask(refs.maturityDateInput, null);
    [refs.principalInput, refs.contributionPrincipalInput, refs.holdAmountInput, refs.directCancelAmountInput, refs.directPenaltyAmountInput].forEach(bindAmountMask);

    [refs.labelInput, refs.principalInput, refs.contributionPrincipalInput, refs.startDateInput, refs.maturityDateInput,
      refs.contractRateInput, refs.holdAmountInput, refs.directCancelAmountInput, refs.directPenaltyAmountInput, refs.appliedRatePctInput
    ].forEach(function (input) {
      input.addEventListener("input", renderReport);
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

    renderProductWithdrawalRows(p);
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

    var totalYears = yearsBetween(start, maturity);
    var elapsedYears = yearsBetween(start, today);
    var remainingYears = yearsBetween(today, maturity);

    return {
      label: refs.labelInput.value.trim(),
      principal: principal, start: start, maturity: maturity, rate: rate, method: method, today: today,
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
    if (c.totalYears !== null) parts.push("전체기간 " + formatYears(c.totalYears));
    if (c.elapsedYears !== null) parts.push("경과기간 " + formatYears(c.elapsedYears));
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
    var holdSuggestion = holdSuggestions ? holdSuggestions[c.method] : null;
    var penalty = updatePenalty(p, c, history);
    var holdAmount = parseAmountStr(refs.holdAmountInput.value);
    var holdAmountForCompare = holdAmount === null ? holdSuggestion : holdAmount;

    var remainYrs = c.remainingYearsClamped;
    var breakEvenRate = null;
    if (holdAmountForCompare !== null && penalty.cancelAmount !== null && penalty.cancelAmount > 0 && remainYrs !== null && remainYrs > 0) {
      breakEvenRate = ((holdAmountForCompare / penalty.cancelAmount) - 1) / remainYrs * 100;
    }

    var rows = [];
    if (penalty.cancelAmount !== null && remainYrs !== null) {
      rows = state.rows.filter(function (r) {
        return r.years !== "" && r.years !== null && !isNaN(r.years) && r.rate !== "" && r.rate !== null && !isNaN(r.rate);
      }).map(function (r) {
        var maturityAmount = penalty.cancelAmount * (1 + (r.rate / 100) * remainYrs);
        var ownMaturityDate = addYears(c.today, r.years);
        var diff = holdAmountForCompare === null ? null : maturityAmount - holdAmountForCompare;
        var horizonDiffYears = r.years - remainYrs;
        return {
          label: r.label || (r.years + "년"), years: r.years, rate: r.rate,
          ownMaturityDate: ownMaturityDate, maturityAmount: maturityAmount, diff: diff, horizonDiffYears: horizonDiffYears
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

    // ---- 합계 KPI (기존상품이 2건 이상일 때만) ----
    if (multi) {
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
      html += '</div></div>';
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

  function buildProductReportSection(r, idx, multi) {
    var c = r.c, history = r.history, penalty = r.penalty, rows = r.rows, bestRow = r.bestRow;
    var holdAmountForCompare = r.holdAmountForCompare, remainYrs = r.remainYrs, breakEvenRate = r.breakEvenRate;
    var html = "";

    html += '<div class="product-report' + (multi ? " product-report-divided" : "") + '">';
    if (multi) {
      html += '<h3 class="product-report-title">기존상품 ' + (idx + 1) + (c.label ? ' — ' + escapeHtml(c.label) : '') + '</h3>';
    }

    // ---- KPI 타일 ----
    html += '<div class="kpi-row">';
    html += kpiTile("만기까지 유지 시", formatWon(holdAmountForCompare), "만기일 " + formatDateUTC(c.maturity) + (r.holdAmount === null ? " · " + methodLabel(c.method) + " 추정치" : ""), false);
    html += kpiTile("해지적립금(재예치 원금)", formatWon(penalty.cancelAmount), penalty.penaltyAmount !== null ? "해지패널티 " + formatWon(penalty.penaltyAmount) : (penalty.mode === "direct" ? "직접입력" : ""), false);
    if (breakEvenRate !== null) {
      html += kpiTile("손익분기 금리", formatPct(breakEvenRate), "신상품이 이 금리보다 높아야 재예치가 유리(" + formatDateUTC(c.maturity) + " 기준)", false);
    }
    if (bestRow && bestRow.diff !== null) {
      if (bestRow.diff > 0) {
        html += kpiTile("추천: 재예치", escapeHtml(bestRow.label), "만기유지 대비 " + formatSignedWon(bestRow.diff), true);
      } else {
        html += kpiTile("추천: 만기까지 유지", "현 상품 보유", "재예치 최선(" + escapeHtml(bestRow.label) + ") 대비 " + formatSignedWon(-bestRow.diff) + " 더 유리", false);
      }
    } else if (bestRow) {
      html += kpiTile("최선 재예치 옵션", escapeHtml(bestRow.label), "", false);
    } else {
      html += kpiTile("추천", "-", "3번에 신상품 금리를 입력하세요", false);
    }
    html += '</div>';

    // ---- 비교 그래프 ----
    if (rows.length && holdAmountForCompare !== null && history && remainYrs > 0) {
      var diffRows = rows.filter(function (rr) { return rr.diff !== null; });
      if (diffRows.length) {
        var productLines = diffRows.map(function (rr) {
          return { label: rr.label, startVal: penalty.cancelAmount, endVal: rr.maturityAmount };
        });
        var svg = buildLineChartSvg(history.balanceToday, holdAmountForCompare, c.method, c.rate, remainYrs, productLines, c.maturity);
        if (svg) {
          html += '<div class="report-block"><h4>오늘 → 만기일(' + formatDateUTC(c.maturity) + ') 예상 잔액 추이</h4>';
          html += '<div class="line-chart-container">' + svg + '</div>';
          html += '<p class="chart-caption">회색 점선 = 만기까지 유지(오늘 실제 잔액에서 시작) · 파란 실선 = 해지 후 재예치(해지적립금 ' + formatWon(penalty.cancelAmount) + '에서 시작, 선 끝 라벨 = 상품명)</p>';
          html += '</div>';
        }
      }
    }

    // ---- 상세 정보 ----
    html += '<div class="report-block"><h4>기존상품 정보</h4>';
    html += kv("현재 적립금(명세일자 기준)", formatWon(c.principal));
    if (c.contributionPrincipal !== null) {
      html += kv("납입원금(참고)", formatWon(c.contributionPrincipal));
    } else if (history && history.netPrincipalEstimated) {
      html += kv("납입원금(추정)", formatWon(history.netPrincipal));
    }
    html += kv("명세일자 → 만기일", formatDateUTC(c.start) + " → " + formatDateUTC(c.maturity));
    html += kv("약정금리(연) / 이자계산방식", formatPct(c.rate) + " / " + methodLabel(c.method));
    html += kv("전체기간 / 경과기간 / 잔여기간", formatYears(c.totalYears) + " / " + formatYears(c.elapsedYears) + " / " + formatYears(c.remainingYears));
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

    if (rows.length) {
      html += '<div class="report-block"><h4>신상품 재예치 상세 비교 (이 상품 만기일 기준 환산)</h4>';
      html += '<div class="table-scroll"><table class="report-table"><thead><tr>' +
        '<th>신상품</th><th>제안금리</th><th>상품 자체 만기일</th><th>이 상품 만기일 기준 수령액</th><th>유지 대비</th></tr></thead><tbody>';
      rows.forEach(function (rr) {
        var isBest = bestRow && rr === bestRow;
        var diffCell = "-";
        if (rr.diff !== null) {
          var badgeClass = rr.diff >= 0 ? "better" : "worse";
          var badgeText = rr.diff >= 0 ? "유리" : "불리";
          diffCell = formatSignedWon(rr.diff) + ' <span class="badge ' + badgeClass + '">' + badgeText + "</span>";
        }
        var horizonNote = "";
        if (Math.abs(rr.horizonDiffYears) > 0.05) {
          horizonNote = '<br><span class="cell-note">(상품기간이 잔여기간보다 ' + formatYears(Math.abs(rr.horizonDiffYears)) + (rr.horizonDiffYears > 0 ? " 김 — 만기 후 동일금리 재투자 가정" : " 짧음 — 이후 별도 재예치 필요") + ')</span>';
        }
        html += '<tr' + (isBest ? ' class="best-row"' : '') + '><td>' + escapeHtml(rr.label) + "</td><td>" + formatPct(rr.rate) + "</td><td>" +
          formatDateUTC(rr.ownMaturityDate) + horizonNote +
          "</td><td>" + formatWon(rr.maturityAmount) + "</td><td>" + diffCell + "</td></tr>";
      });
      html += "</tbody></table></div></div>";
    }

    html += '</div>';
    return html;
  }

  // 오늘(t=0) → 만기일(t=remainYrs)까지, "유지"는 곡선(선택한 이자계산방식),
  // 각 신상품 재예치 옵션은 단리라 정확히 직선이므로 시작/끝 두 점으로 그린다.
  function buildLineChartSvg(startMaintain, endMaintain, method, ratePct, remainYrs, productLines, maturityDate) {
    if (!isFinite(startMaintain) || !isFinite(endMaintain) || remainYrs <= 0) return "";
    var r = ratePct / 100;
    var SAMPLES = 16;
    var maintainPts = [];
    for (var i = 0; i <= SAMPLES; i++) {
      var t = (remainYrs * i) / SAMPLES;
      maintainPts.push({ t: t, v: startMaintain * growthFactor(method, r, t) });
    }
    maintainPts[maintainPts.length - 1].v = endMaintain;

    var allVals = maintainPts.map(function (p) { return p.v; });
    productLines.forEach(function (pl) { allVals.push(pl.startVal, pl.endVal); });
    var yMin = Math.min.apply(null, allVals);
    var yMax = Math.max.apply(null, allVals);
    var pad = (yMax - yMin) * 0.12 || Math.abs(yMax) * 0.02 || 1;
    yMin -= pad;
    yMax += pad;

    var W = 640, H = 280, padL = 60, padR = 16, padT = 14, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    function xPix(t) { return padL + (t / remainYrs) * plotW; }
    function yPix(v) { return padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH; }
    function pathFor(pts) {
      return pts.map(function (p, i) { return (i === 0 ? "M" : "L") + xPix(p.t).toFixed(1) + "," + yPix(p.v).toFixed(1); }).join(" ");
    }

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="line-chart-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="만기까지 유지와 재예치 시나리오 잔액 추이 비교">';

    var GRID = 4;
    for (var g = 0; g <= GRID; g++) {
      var gv = yMin + ((yMax - yMin) * g) / GRID;
      var gy = yPix(gv);
      svg += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '" class="lc-grid" />';
      svg += '<text x="' + (padL - 8) + '" y="' + (gy + 3).toFixed(1) + '" class="lc-axis-label" text-anchor="end">' + formatWonShort(gv) + '</text>';
    }
    svg += '<text x="' + padL + '" y="' + (H - 6) + '" class="lc-axis-label">오늘</text>';
    svg += '<text x="' + (W - padR) + '" y="' + (H - 6) + '" class="lc-axis-label" text-anchor="end">' + formatDateUTC(maturityDate) + '</text>';

    svg += '<path d="' + pathFor(maintainPts) + '" class="lc-line lc-line-maintain" />';
    svg += '<circle cx="' + xPix(0).toFixed(1) + '" cy="' + yPix(startMaintain).toFixed(1) + '" r="3" class="lc-dot lc-dot-maintain" />';
    svg += '<circle cx="' + xPix(remainYrs).toFixed(1) + '" cy="' + yPix(endMaintain).toFixed(1) + '" r="3" class="lc-dot lc-dot-maintain" />';

    // 끝점 라벨들이 서로 겹치지 않도록, y좌표 기준으로 정렬한 뒤 최소 간격을 확보한다.
    // (선/점은 실제 값 위치에 그대로 두고, 텍스트 라벨만 세로로 살짝씩 밀어낸다.)
    var labelEntries = [{ key: "__maintain__", label: "유지", y: yPix(endMaintain) }];
    productLines.forEach(function (pl, idx) {
      labelEntries.push({ key: "p" + idx, label: pl.label, y: yPix(pl.endVal) });
    });
    labelEntries.sort(function (a, b) { return a.y - b.y; });
    var MIN_GAP = 11;
    for (var li = 1; li < labelEntries.length; li++) {
      if (labelEntries[li].y - labelEntries[li - 1].y < MIN_GAP) {
        labelEntries[li].y = labelEntries[li - 1].y + MIN_GAP;
      }
    }
    var overflow = labelEntries[labelEntries.length - 1].y - (H - 6);
    if (overflow > 0) {
      labelEntries.forEach(function (le) { le.y -= overflow; });
    }
    var labelYByKey = {};
    labelEntries.forEach(function (le) { labelYByKey[le.key] = le.y; });

    svg += '<text x="' + (xPix(remainYrs) - 6).toFixed(1) + '" y="' + (labelYByKey.__maintain__ + 3.5).toFixed(1) + '" class="lc-end-label lc-end-label-maintain" text-anchor="end">유지</text>';

    productLines.forEach(function (pl, idx) {
      var pts = [{ t: 0, v: pl.startVal }, { t: remainYrs, v: pl.endVal }];
      svg += '<path d="' + pathFor(pts) + '" class="lc-line lc-line-product" />';
      svg += '<circle cx="' + xPix(remainYrs).toFixed(1) + '" cy="' + yPix(pl.endVal).toFixed(1) + '" r="3" class="lc-dot lc-dot-product" />';
      svg += '<text x="' + (xPix(remainYrs) - 6).toFixed(1) + '" y="' + (labelYByKey["p" + idx] + 3.5).toFixed(1) + '" class="lc-end-label lc-end-label-product" text-anchor="end">' + escapeHtml(pl.label) + '</text>';
    });

    svg += '</svg>';
    return svg;
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
