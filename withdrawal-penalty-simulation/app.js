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

  var state = {
    rows: [], // { id, label, years, rate }
    nextId: 1
  };

  var el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    [
      "customerName", "principal", "startDate", "maturityDate", "contractRate", "todayDate",
      "periodSummary", "holdAmount", "holdAmountSuggestion", "useHoldSuggestion",
      "modeDirect", "modeRatio", "directModeFields", "ratioModeFields",
      "directCancelAmount", "directPenaltyAmount", "appliedRatePct", "ratioModeCalc",
      "cancelAmountResult", "newProductRows", "addProductRow",
      "rmName", "rmDept", "rmContact", "printBtn", "resetBtn", "reportContent"
    ].forEach(function (id) { el[id] = $(id); });
  }

  function todayISO() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function parseDateUTC(str) {
    if (!str) return null;
    var parts = str.split("-");
    if (parts.length !== 3) return null;
    var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    return isNaN(d.getTime()) ? null : d;
  }

  function addDaysUTC(date, days) {
    return new Date(date.getTime() + days * 86400000);
  }

  function addYears(date, years) {
    return addDaysUTC(date, Math.round(years * 365));
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

  function formatWon(n) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    return Math.round(n).toLocaleString("ko-KR") + "원";
  }

  function formatPct(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    return n.toFixed(digits === undefined ? 2 : digits) + "%";
  }

  function formatYears(n) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    return (Math.round(n * 100) / 100) + "년";
  }

  function numVal(input) {
    var v = parseFloat(input.value);
    return isNaN(v) ? null : v;
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
      return JSON.parse(localStorage.getItem(RM_INFO_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveRmInfo() {
    localStorage.setItem(RM_INFO_KEY, JSON.stringify({
      name: el.rmName.value.trim(),
      dept: el.rmDept.value.trim(),
      contact: el.rmContact.value.trim()
    }));
  }

  // ---------- 신상품 행 렌더링 ----------

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

  function escapeAttr(str) {
    return String(str === undefined || str === null ? "" : str).replace(/"/g, "&quot;");
  }

  function escapeHtml(str) {
    return String(str === undefined || str === null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------- 계산 ----------

  function gatherCustomer() {
    var principal = numVal(el.principal);
    var start = parseDateUTC(el.startDate.value);
    var maturity = parseDateUTC(el.maturityDate.value);
    var rate = numVal(el.contractRate);
    var today = parseDateUTC(el.todayDate.value);

    var totalYears = yearsBetween(start, maturity);
    var elapsedYears = yearsBetween(start, today);
    var remainingYears = yearsBetween(today, maturity);

    return {
      customerName: el.customerName.value.trim(),
      principal: principal, start: start, maturity: maturity, rate: rate, today: today,
      totalYears: totalYears, elapsedYears: elapsedYears, remainingYears: remainingYears,
      valid: principal !== null && start && maturity && rate !== null && today
    };
  }

  function updatePeriodSummary(c) {
    if (!c.start || !c.maturity || !c.today) {
      el.periodSummary.textContent = "";
      return;
    }
    var parts = [];
    if (c.totalYears !== null) parts.push("전체기간 " + formatYears(c.totalYears));
    if (c.elapsedYears !== null) parts.push("경과기간 " + formatYears(c.elapsedYears));
    if (c.remainingYears !== null) parts.push("잔여기간 " + formatYears(c.remainingYears));
    el.periodSummary.textContent = parts.join(" · ");
  }

  function updateHoldSuggestion(c) {
    if (c.principal === null || c.rate === null || c.totalYears === null) {
      el.holdAmountSuggestion.textContent = "-";
      return null;
    }
    var suggestion = c.principal * (1 + (c.rate / 100) * c.totalYears);
    el.holdAmountSuggestion.textContent = formatWon(suggestion) + " (원금×(1+약정금리×전체기간), 단리 추정)";
    return suggestion;
  }

  function updatePenalty(c) {
    var mode = el.modeDirect.checked ? "direct" : "ratio";
    el.directModeFields.classList.toggle("hidden", mode !== "direct");
    el.ratioModeFields.classList.toggle("hidden", mode !== "ratio");

    var cancelAmount = null;
    var penaltyAmount = null;

    if (mode === "direct") {
      cancelAmount = numVal(el.directCancelAmount);
      penaltyAmount = numVal(el.directPenaltyAmount);
    } else {
      var ratePct = numVal(el.appliedRatePct);
      if (c.principal !== null && c.rate !== null && c.elapsedYears !== null && ratePct !== null) {
        var preValue = c.principal * (1 + (c.rate / 100) * c.elapsedYears);
        cancelAmount = c.principal * (1 + (c.rate / 100) * (ratePct / 100) * c.elapsedYears);
        penaltyAmount = preValue - cancelAmount;
        el.ratioModeCalc.textContent =
          "해지시점 세전평가액(참고) " + formatWon(preValue) + " → 해지패널티 " + formatWon(penaltyAmount) + " → 해지적립금 " + formatWon(cancelAmount);
      } else {
        el.ratioModeCalc.textContent = "";
      }
    }

    el.cancelAmountResult.textContent = cancelAmount === null ? "-" : formatWon(cancelAmount);
    return { mode: mode, cancelAmount: cancelAmount, penaltyAmount: penaltyAmount };
  }

  // ---------- 결과 요약(리포트) ----------

  function renderReport() {
    var c = gatherCustomer();
    updatePeriodSummary(c);
    var holdSuggestion = updateHoldSuggestion(c);
    var penalty = updatePenalty(c);
    var holdAmount = numVal(el.holdAmount);

    if (!c.valid || penalty.cancelAmount === null) {
      el.reportContent.innerHTML = '<p class="report-empty">1~3번 정보를 입력하면 여기에 비교 결과가 표시됩니다.</p>';
      return;
    }

    var rows = state.rows.filter(function (r) {
      return r.years !== "" && r.years !== null && !isNaN(r.years) && r.rate !== "" && r.rate !== null && !isNaN(r.rate);
    }).map(function (r) {
      var maturityAmount = penalty.cancelAmount * (1 + (r.rate / 100) * r.years);
      var maturityDate = addYears(c.today, r.years);
      var diff = holdAmount === null ? null : maturityAmount - holdAmount;
      var horizonDiffYears = c.remainingYears === null ? null : r.years - c.remainingYears;
      return {
        label: r.label || (r.years + "년"), years: r.years, rate: r.rate,
        maturityDate: maturityDate, maturityAmount: maturityAmount, diff: diff, horizonDiffYears: horizonDiffYears
      };
    });

    var rm = { name: el.rmName.value.trim(), dept: el.rmDept.value.trim(), contact: el.rmContact.value.trim() };

    var html = "";
    html += '<p class="report-title">중도해지 vs 재예치 시뮬레이션' + (c.customerName ? " — " + escapeHtml(c.customerName) : "") + '</p>';
    html += '<p class="report-meta">작성일 ' + formatDateUTC(parseDateUTC(todayISO())) + ' · 해지(기준)일 ' + formatDateUTC(c.today) + '</p>';

    html += '<div class="report-block"><h3>기존상품 정보</h3>';
    html += kv("가입원금", formatWon(c.principal));
    html += kv("가입일 → 만기일", formatDateUTC(c.start) + " → " + formatDateUTC(c.maturity));
    html += kv("약정금리(연)", formatPct(c.rate));
    html += kv("전체기간 / 경과기간 / 잔여기간", formatYears(c.totalYears) + " / " + formatYears(c.elapsedYears) + " / " + formatYears(c.remainingYears));
    html += "</div>";

    html += '<div class="report-block"><h3>① 만기까지 유지 시</h3>';
    html += kv("만기 시 예상 수령액", holdAmount === null ? (holdSuggestion === null ? "-" : formatWon(holdSuggestion) + " (참고 추정치)") : formatWon(holdAmount));
    html += kv("만기일", formatDateUTC(c.maturity));
    html += "</div>";

    html += '<div class="report-block"><h3>② 중도해지 시</h3>';
    html += kv("해지방식", penalty.mode === "direct" ? "해지적립금 직접입력" : "적용이율 비율 방식");
    if (penalty.penaltyAmount !== null) html += kv("해지패널티 금액", formatWon(penalty.penaltyAmount));
    html += kv("해지적립금(재예치 원금)", formatWon(penalty.cancelAmount));
    html += "</div>";

    if (rows.length) {
      html += '<div class="report-block"><h3>③ 신상품 재예치 시 비교</h3>';
      html += '<table class="report-table"><thead><tr>' +
        '<th>기간</th><th>제안금리</th><th>재예치 만기일</th><th>만기 시 수령액</th><th>유지 대비</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        var diffCell = "-";
        if (r.diff !== null) {
          var badgeClass = r.diff >= 0 ? "better" : "worse";
          var badgeText = r.diff >= 0 ? "유리" : "불리";
          diffCell = (r.diff >= 0 ? "+" : "") + formatWon(r.diff) + ' <span class="badge ' + badgeClass + '">' + badgeText + "</span>";
        }
        html += "<tr><td>" + escapeHtml(r.label) + "</td><td>" + formatPct(r.rate) + "</td><td>" +
          formatDateUTC(r.maturityDate) + (r.horizonDiffYears !== null && Math.abs(r.horizonDiffYears) > 0.05 ? '<br><span style="font-weight:400;color:#6b7280;font-size:0.78rem;">(원 만기와 ' + formatYears(Math.abs(r.horizonDiffYears)) + (r.horizonDiffYears > 0 ? " 늦음" : " 빠름") + ")</span>" : "") +
          "</td><td>" + formatWon(r.maturityAmount) + "</td><td>" + diffCell + "</td></tr>";
      });
      html += "</tbody></table></div>";
    }

    html += '<p class="report-disclaimer">본 시뮬레이션은 입력하신 정보를 기준으로 한 단리 추정 참고자료이며, 실제 적용금리·세금·수수료 등에 따라 실수령액과 차이가 있을 수 있습니다. "유지 대비" 비교는 만기 시점이 서로 다를 수 있으므로 시점 차이를 함께 확인해주세요. 신상품 제안금리는 안내 시점 기준이며 향후 변동될 수 있습니다.</p>';

    if (rm.name || rm.dept || rm.contact) {
      html += '<p class="report-signature">' + [rm.dept, rm.name, rm.contact].filter(Boolean).join(" · ") + "</p>";
    }

    el.reportContent.innerHTML = html;
  }

  function kv(label, value) {
    return '<div class="report-kv"><span>' + escapeHtml(label) + '</span><span>' + value + "</span></div>";
  }

  // ---------- 초기화/이벤트 ----------

  function resetCustomerFields() {
    el.customerName.value = "";
    el.principal.value = "";
    el.startDate.value = "";
    el.maturityDate.value = "";
    el.contractRate.value = "";
    el.todayDate.value = todayISO();
    el.holdAmount.value = "";
    el.modeDirect.checked = true;
    el.directCancelAmount.value = "";
    el.directPenaltyAmount.value = "";
    el.appliedRatePct.value = "";
    renderReport();
  }

  function bindEvents() {
    [
      "customerName", "principal", "startDate", "maturityDate", "contractRate", "todayDate",
      "holdAmount", "directCancelAmount", "directPenaltyAmount", "appliedRatePct"
    ].forEach(function (id) {
      el[id].addEventListener("input", renderReport);
    });

    el.modeDirect.addEventListener("change", renderReport);
    el.modeRatio.addEventListener("change", renderReport);

    el.useHoldSuggestion.addEventListener("click", function () {
      var c = gatherCustomer();
      var suggestion = updateHoldSuggestion(c);
      if (suggestion !== null) {
        el.holdAmount.value = Math.round(suggestion);
        renderReport();
      }
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
      if (confirm("고객/상품 정보를 모두 지울까요? (신상품 금리 목록과 작성자 정보는 유지됩니다)")) {
        resetCustomerFields();
      }
    });
  }

  function init() {
    cacheEls();
    el.todayDate.value = todayISO();

    state.rows = loadRows().map(function (r) {
      return { id: state.nextId++, label: r.label, years: r.years, rate: r.rate };
    });

    var rm = loadRmInfo();
    el.rmName.value = rm.name || "";
    el.rmDept.value = rm.dept || "";
    el.rmContact.value = rm.contact || "";

    renderRows();
    bindEvents();
    renderReport();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
