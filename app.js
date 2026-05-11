async function getJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${path}`);
    }

    // 暴力破解法：先拿純文字，把不合法的 NaN 換成 null 再解析
    let text = await res.text();
    text = text.replace(/:\s*NaN/g, ': null')
        .replace(/,\s*NaN/g, ', null')
        .replace(/\[\s*NaN/g, '[ null');

    try {
        return JSON.parse(text);
    } catch (err) {
        console.error(`解析 ${path} 失敗，檔案可能嚴重損壞:`, err);
        throw err;
    }
}

function renderCards(categories) {
    const cards = document.getElementById("cards");
    cards.innerHTML = "";
    categories.forEach((c) => {
        const div = document.createElement("div");
        div.className = "card";
        div.innerHTML = `
      <h3>${c.label}</h3>
      <div class="kv">來源 CSV: ${c.sourceCsv}</div>
      <div class="kv">列數: ${c.rows}</div>
      <div class="kv">欄位數: ${c.columns}</div>
      <div class="kv">起始: ${c.startTime || "-"}</div>
      <div class="kv">結束: ${c.endTime || "-"}</div>
    `;
        cards.appendChild(div);
    });
}

function toFlatText(row, cols) {
    return cols.map((c) => String(row[c] ?? "")).join(" ").toLowerCase();
}

function parseTime(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    const s = String(value).trim();
    if (!s) return null;

    // 1. 如果本來就是 Epoch (數字)
    if (/^\d+$/.test(s)) {
        const n = Number(s);
        return s.length <= 10 ? new Date(n * 1000) : new Date(n);
    }

    // 2. 暴力拆解 YYYY-MM-DD HH:mm:ss，強制當作 UTC，避免瀏覽器自作聰明
    const m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[\sT](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z)?$/);
    if (m) {
        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10) - 1;
        const date = parseInt(m[3], 10);
        const hours = parseInt(m[4], 10);
        const minutes = parseInt(m[5], 10);
        const seconds = m[6] ? parseInt(m[6], 10) : 0;
        return new Date(Date.UTC(year, month, date, hours, minutes, seconds));
    }

    // fallback
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

function formatTaiwanTime(d) {
    if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return "";
    // 強制加上 8 小時 (台灣時間 UTC+8) 的毫秒數
    const twDate = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    // 全部透過 getUTC 取值，完全切斷系統時區干擾
    return `${twDate.getUTCFullYear()}-${pad(twDate.getUTCMonth() + 1)}-${pad(twDate.getUTCDate())} ${pad(twDate.getUTCHours())}:${pad(twDate.getUTCMinutes())}:${pad(twDate.getUTCSeconds())}`;
}

function parseOptionalNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const n = Number(value);
    if (Number.isFinite(n)) return n;

    const s = String(value).trim();
    if (!s) return null;

    // Accept values that start with a number and have units, e.g. "1.000000 °/s".
    const m = s.match(/^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
    if (!m) return null;

    const parsed = Number(m[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalDateTime(value) {
    if (!value) return null;
    return parseTime(value);
}

function parsePowerPairText(raw) {
    if (raw === null || raw === undefined) return { v: null, ma: null };
    const s = String(raw).trim();
    if (!s) return { v: null, ma: null };

    const mv = s.match(/([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*V\b/);
    const mma = s.match(/([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*mA\b/);
    const v = mv ? Number(mv[1]) : null;
    const ma = mma ? Number(mma[1]) : null;

    if (Number.isFinite(v) || Number.isFinite(ma)) {
        return {
            v: Number.isFinite(v) ? v : null,
            ma: Number.isFinite(ma) ? ma : null,
        };
    }

    const nums = s.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
    if (nums.length >= 2) {
        const n0 = Number(nums[0]);
        const n1 = Number(nums[1]);
        return {
            v: Number.isFinite(n0) ? n0 : null,
            ma: Number.isFinite(n1) ? n1 : null,
        };
    }

    return { v: null, ma: null };
}

function enrichAdcs1PowerColumns(payload, categoryMeta) {
    const label = categoryMeta?.label || payload?.label || "";
    if (!/ADCS\s*1\s*Beacon/i.test(label)) return payload;

    const rows = payload.previewRows || [];
    const columns = new Set(payload.columns || []);
    const pairs = [
        { base: "PWR 3V", vCol: "PWR 3V (V)", mCol: "PWR 3V (mA)" },
        { base: "PWR 5V", vCol: "PWR 5V (V)", mCol: "PWR 5V (mA)" },
    ];

    for (const p of pairs) {
        columns.add(p.vCol);
        columns.add(p.mCol);

        for (const row of rows) {
            const curV = parseOptionalNumber(row[p.vCol]);
            const curM = parseOptionalNumber(row[p.mCol]);
            const needV = curV === null;
            const needM = curM === null;
            if (!needV && !needM) continue;

            const parsed = parsePowerPairText(row[p.base]);
            if (needV && Number.isFinite(parsed.v)) row[p.vCol] = parsed.v;
            if (needM && Number.isFinite(parsed.ma)) row[p.mCol] = parsed.ma;
        }
    }

    payload.columns = Array.from(columns);
    return payload;
}

function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
}

function median(values) {
    if (!values.length) return NaN;
    const s = [...values].sort((a, b) => a - b);
    return quantile(s, 0.5);
}

function getLocalConfig() {
    return window.LOCAL_DASHBOARD_CONFIG || {};
}

function getFilterConfig(localConfig) {
    const defaults = {
        enabled: true,
        minSeriesPoints: 6,
        iqrQ1: 0.25,
        iqrQ3: 0.75,
        iqrK: 3.0,
        minAfterIqrPoints: 6,
        madK: 6.0,
        fallbackMultiplier: 4.0,
        requireSignFlip: true,
    };
    return {
        ...defaults,
        ...(localConfig.spikeFilter || {}),
    };
}

function getViewConfig(localConfig) {
    const defaults = {
        hideSourceId: true,
        tablePreviewLimit: 200,
        preferredMetricKeywords: [
            "Vol (V)",
            "Temp",
            "PWR 5V (V)",
            "PWR 3V (V)",
            "Cur (mA)",
            "ADCS_TMP",
            "MAG_X",
            "RATE (deg/s)_X",
        ],
    };
    return {
        ...defaults,
        ...(localConfig.view || {}),
    };
}

function getRangeConfig(localConfig) {
    const defaults = {
        yMin: null,
        yMax: null,
        timeStart: "",
        timeEnd: "",
    };
    return {
        ...defaults,
        ...(localConfig.range || {}),
    };
}

function parseRangeObject(rangeObj) {
    const range = rangeObj || {};
    return {
        yMin: parseOptionalNumber(range.yMin),
        yMax: parseOptionalNumber(range.yMax),
        timeStart: parseOptionalDateTime(range.timeStart),
        timeEnd: parseOptionalDateTime(range.timeEnd),
    };
}

function mergeRange(baseRange, overrideRange) {
    return {
        yMin: overrideRange.yMin !== null ? overrideRange.yMin : baseRange.yMin,
        yMax: overrideRange.yMax !== null ? overrideRange.yMax : baseRange.yMax,
        timeStart: overrideRange.timeStart || baseRange.timeStart,
        timeEnd: overrideRange.timeEnd || baseRange.timeEnd,
    };
}

function findCategoryOverride(localConfig, categoryMeta) {
    const byCategory = localConfig.rangeByCategory || {};
    const keys = [categoryMeta.label, categoryMeta.key, categoryMeta.file].filter(Boolean);
    for (const key of keys) {
        if (byCategory[key]) return byCategory[key];
    }
    return null;
}

function resolveDisplayRange(localConfig, categoryMeta, metricCol) {
    const globalRange = parseRangeObject(getRangeConfig(localConfig));
    const byMetric = localConfig.rangeByMetric || {};
    const metricRange = parseRangeObject(byMetric[metricCol]);

    const categoryOverride = findCategoryOverride(localConfig, categoryMeta);
    const categoryAllRange = parseRangeObject(categoryOverride && categoryOverride.__all__);
    const categoryMetricRange = parseRangeObject(categoryOverride && categoryOverride[metricCol]);

    let merged = mergeRange(globalRange, metricRange);
    merged = mergeRange(merged, categoryAllRange);
    merged = mergeRange(merged, categoryMetricRange);
    return merged;
}

function resolveValueFilterRules(localConfig, categoryMeta) {
    const byCategory = localConfig.valueFiltersByCategory || {};
    const keys = [categoryMeta.label, categoryMeta.key, categoryMeta.file].filter(Boolean);
    for (const key of keys) {
        if (byCategory[key]) return byCategory[key];
    }
    return {};
}

function shouldShowAverageLine(metricCol) {
    if (!metricCol) return false;
    return /(\bV\)|Wh|mA|mW|Cur|Energy|PWR|Temp|°C|RATE|IMU|GYRO|ACC|ACCEL)/i.test(metricCol);
}

function formatAverageValue(value) {
    if (!Number.isFinite(value)) return "-";
    return value.toFixed(3);
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function hasOnlyAllowedBits(value, allowedPowers) {
    if (!isPositiveInteger(value) || !Array.isArray(allowedPowers) || !allowedPowers.length) {
        return false;
    }

    let mask = 0;
    for (const p of allowedPowers) {
        if (!Number.isInteger(p) || p < 0 || p > 30) continue;
        mask |= (1 << p);
    }
    if (mask === 0) return false;
    return (value & ~mask) === 0;
}

function hasRequiredBits(value, requiredPowers) {
    if (!Number.isFinite(value) || !Array.isArray(requiredPowers) || !requiredPowers.length) {
        return true;
    }

    return requiredPowers.every((p) => Number.isInteger(p) && p >= 0 && p <= 30 && (value & (1 << p)) !== 0);
}

function matchColumnValueRule(rawValue, rule) {
    if (!rule || typeof rule !== "object") return true;

    const mode = rule.mode || "allowList";
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return false;

    if (Number.isFinite(Number(rule.minValue)) && value < Number(rule.minValue)) return false;
    if (Number.isFinite(Number(rule.maxValue)) && value > Number(rule.maxValue)) return false;

    if (mode === "allowList") {
        const allow = Array.isArray(rule.allowedValues) ? rule.allowedValues : [];
        return allow.includes(value);
    }

    if (mode === "bitmask") {
        const allow = Array.isArray(rule.allowedValues) ? rule.allowedValues : [];
        if (allow.includes(value)) return true;

        const allowedPowers = Array.isArray(rule.allowedBitPowers) ? rule.allowedBitPowers : [];
        if (!allowedPowers.length) return false;

        const requiredPowers = Array.isArray(rule.requiredBitPowers) ? rule.requiredBitPowers : [];

        if (rule.allowCombinations === false) {
            return requiredPowers.every((p) => Number.isInteger(p) && p >= 0 && p <= 30 && (value & (1 << p)) !== 0)
                && allowedPowers.some((p) => Number.isInteger(p) && p >= 0 && p <= 30 && value === (1 << p));
        }

        return hasOnlyAllowedBits(value, allowedPowers) && hasRequiredBits(value, requiredPowers);
    }

    return true;
}

function applyConfiguredValueFilters(rows, rules, activeMetric) {
    const entries = Object.entries(rules || {}).filter(([, v]) => v && typeof v === "object");
    if (!entries.length) return rows;

    return rows.filter((row) => {
        for (const [col, rule] of entries) {
            const applyToAllMetrics = rule.applyToAllMetrics === true;
            if (!applyToAllMetrics && activeMetric !== col) {
                continue;
            }
            if (!matchColumnValueRule(row[col], rule)) {
                return false;
            }
        }
        return true;
    });
}

function inferNumericColumns(payload) {
    const rows = payload.previewRows || [];
    const cols = payload.columns || [];
    const numericCols = [];

    const minRequiredCount = Math.max(5, Math.floor(rows.length * 0.05));

    cols.forEach((col) => {
        if (col === "來源ID" || col === "網站時間(UTC)" || col === "封包時間(UTC)" || col === "Callsign") return;

        let numericCount = 0;
        let nonNullCount = 0;

        for (const row of rows) {
            const v = row[col];
            if (v === null || v === "" || v === undefined || String(v).trim() === "") continue;
            if (typeof v === "number" && Number.isNaN(v)) continue;

            nonNullCount += 1;
            const n = parseOptionalNumber(v);
            if (Number.isFinite(n)) {
                numericCount += 1;
            }
        }

        if (nonNullCount > 0 && numericCount >= minRequiredCount && (numericCount / nonNullCount) >= 0.8) {
            numericCols.push(col);
        }
    });

    return numericCols;
}

function pickDefaultMetric(numericCols, viewCfg) {
    if (!numericCols.length) return "";

    const keywords = (viewCfg.preferredMetricKeywords || []).map((k) => String(k).toLowerCase());
    for (const keyword of keywords) {
        const found = numericCols.find((c) => c.toLowerCase().includes(keyword));
        if (found) return found;
    }

    return numericCols[0];
}

function pickCategoryMetric(numericCols, viewCfg, categoryMeta) {
    const categoryKeywords = (viewCfg.preferredMetricKeywordsByCategory || {})[categoryMeta?.label]
        || (viewCfg.preferredMetricKeywordsByCategory || {})[categoryMeta?.key]
        || (viewCfg.preferredMetricKeywordsByCategory || {})[categoryMeta?.file]
        || [];
    const mergedCfg = {
        ...viewCfg,
        preferredMetricKeywords: [...categoryKeywords, ...(viewCfg.preferredMetricKeywords || [])],
    };
    return pickDefaultMetric(numericCols, mergedCfg);
}

function removeUnitlessDuplicates(cols) {
    const withUnits = new Set(cols.filter((c) => /\s+\([^\)]+\)\s*$/.test(c)));
    return cols.filter((col) => {
        if (/\s+\([^\)]+\)\s*$/.test(col)) return true;
        for (const unitCol of withUnits) {
            if (unitCol.startsWith(`${col} (`)) return false;
        }
        return true;
    });
}

function buildSeries(payload, metricCol, sourceRows) {
    const tcol = payload.timeColumn;
    if (!tcol) return [];

    const rows = sourceRows || payload.previewRows || [];
    const series = [];

    for (const row of rows) {
        const t = parseTime(row[tcol]);
        const y = parseOptionalNumber(row[metricCol]);
        if (!t || y === null) continue;
        series.push({ t, y, row });
    }

    series.sort((a, b) => a.t - b.t);
    return series;
}

function applyRangeToSeries(series, range) {
    return series.filter((p) => {
        if (range.timeStart && p.t < range.timeStart) return false;
        if (range.timeEnd && p.t > range.timeEnd) return false;
        if (range.yMin !== null && p.y < range.yMin) return false;
        if (range.yMax !== null && p.y > range.yMax) return false;
        return true;
    });
}

function filterSpikes(series, cfg) {
    if (!cfg.enabled || series.length < cfg.minSeriesPoints) {
        return { filtered: series, removed: 0 };
    }

    const ys = series.map((p) => p.y).sort((a, b) => a - b);
    const q1 = quantile(ys, cfg.iqrQ1);
    const q3 = quantile(ys, cfg.iqrQ3);
    const iqr = q3 - q1;
    const low = q1 - cfg.iqrK * iqr;
    const high = q3 + cfg.iqrK * iqr;

    let iqrFiltered = series.filter((p) => p.y >= low && p.y <= high);
    if (iqr <= 0) {
        iqrFiltered = [...series];
    }

    if (iqrFiltered.length < cfg.minAfterIqrPoints) {
        return { filtered: iqrFiltered, removed: series.length - iqrFiltered.length };
    }

    const diffs = [];
    for (let i = 1; i < iqrFiltered.length; i += 1) {
        diffs.push(Math.abs(iqrFiltered[i].y - iqrFiltered[i - 1].y));
    }

    const medDiff = median(diffs);
    const absDev = diffs.map((d) => Math.abs(d - medDiff));
    const mad = median(absDev);
    const threshold = Number.isFinite(mad) && mad > 0
        ? medDiff + cfg.madK * mad
        : Math.max(medDiff * cfg.fallbackMultiplier, 0.000001);

    const keep = new Array(iqrFiltered.length).fill(true);
    for (let i = 1; i < iqrFiltered.length - 1; i += 1) {
        const y0 = iqrFiltered[i - 1].y;
        const y1 = iqrFiltered[i].y;
        const y2 = iqrFiltered[i + 1].y;
        const d1 = Math.abs(y1 - y0);
        const d2 = Math.abs(y2 - y1);
        const signFlip = (y1 - y0) * (y2 - y1) < 0;
        const isSpike = cfg.requireSignFlip
            ? (signFlip && d1 > threshold && d2 > threshold)
            : (d1 > threshold && d2 > threshold);
        if (isSpike) {
            keep[i] = false;
        }
    }

    const filtered = iqrFiltered.filter((_, i) => keep[i]);
    return { filtered, removed: series.length - filtered.length };
}

function filterRowsForTable(rows, payload, keyword, metricCol, range) {
    const cols = payload.columns || [];
    const tcol = payload.timeColumn;

    return rows.filter((r) => {
        if (keyword && !toFlatText(r, cols).includes(keyword.toLowerCase())) {
            return false;
        }

        if (tcol) {
            const t = parseTime(r[tcol]);
            if (range.timeStart && (!t || t < range.timeStart)) return false;
            if (range.timeEnd && (!t || t > range.timeEnd)) return false;
        }

        if (metricCol) {
            const y = parseOptionalNumber(r[metricCol]);
            if (y === null) return false;

            if (range.yMin !== null && y < range.yMin) return false;
            if (range.yMax !== null && y > range.yMax) return false;
        }

        return true;
    });
}

function renderTable(payload, categoryMeta, sourceRows, keyword, metricCol, range, viewCfg) {
    const table = document.getElementById("dataTable");
    const tableMeta = document.getElementById("tableMeta");
    const displayLabel = categoryMeta?.label || payload.label || "目前分類";
    const baseCols = payload.columns || [];
    const cols = viewCfg.hideSourceId ? baseCols.filter((c) => c !== "來源ID") : baseCols;
    const rows = sourceRows || payload.previewRows || [];

    const filtered = filterRowsForTable(rows, payload, keyword, metricCol, range);
    const limited = filtered.slice(0, viewCfg.tablePreviewLimit);

    tableMeta.textContent = `${displayLabel} | 顯示 ${limited.length} / ${filtered.length} 列（範圍內）`;

    // 我們順便把表格標題的 (UTC) 拿掉，避免誤會
    const thead = `<thead><tr>${cols.map((c) => {
        let colName = c;
        if (c === "網站時間(UTC)") colName = "網站時間(台灣)";
        if (c === "封包時間(UTC)") colName = "封包時間(台灣)";
        return `<th>${colName}</th>`;
    }).join("")}</tr></thead>`;

    const tbody = `<tbody>${limited
        .map((r) => {
            return `<tr>${cols.map((c) => {
                let val = r[c] ?? "";
                
                // 攔截時間欄位，強制轉換成台灣時間
                if ((c === "網站時間(UTC)" || c === "封包時間(UTC)" || c === payload.timeColumn) && val) {
                    const parsedDate = parseTime(val);
                    if (parsedDate) {
                        val = formatTaiwanTime(parsedDate);
                    }
                }
                
                return `<td>${val}</td>`;
            }).join("")}</tr>`;
        })
        .join("")}</tbody>`;
        
    table.innerHTML = thead + tbody;
}

function renderChart(chart, categoryMeta, payload, sourceRows, metricCol, filterCfg, range) {
    const chartMeta = document.getElementById("chartMeta");
    const displayLabel = categoryMeta?.label || payload.label || "目前分類";
    const series = buildSeries(payload, metricCol, sourceRows);

    if (!series.length) {
        chart.data.labels = [];
        chart.data.datasets = [
            {
                label: "",
                data: [],
                borderColor: "#46f0c5",
                backgroundColor: "rgba(70,240,197,0.16)",
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.18,
            },
        ];
        chart.update();
        chartMeta.textContent = "沒有可畫的時間序列資料";
        return;
    }

    const ranged = applyRangeToSeries(series, range);
    if (!ranged.length) {
        chart.data.labels = [];
        chart.data.datasets = [
            {
                label: "",
                data: [],
                borderColor: "#46f0c5",
                backgroundColor: "rgba(70,240,197,0.16)",
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.18,
            },
        ];
        chart.update();
        chartMeta.textContent = "本地設定範圍內沒有資料";
        return;
    }

    const processed = filterSpikes(ranged, filterCfg);
    // 更新這裡：使用 formatTaiwanTime 而不是 toISOString()
    const labels = processed.filtered.map((p) => formatTaiwanTime(p.t));
    const values = processed.filtered.map((p) => p.y);
    const showAverage = shouldShowAverageLine(metricCol);
    const averageValue = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
    const averageSeries = showAverage ? values.map(() => averageValue) : [];

    chart.data.labels = labels;
    chart.data.datasets = [
        {
            label: `${displayLabel} - ${metricCol}`,
            data: values,
            borderColor: "#46f0c5",
            backgroundColor: "rgba(70,240,197,0.16)",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.18,
        },
    ];

    if (showAverage && Number.isFinite(averageValue)) {
        chart.data.datasets.push({
            label: `${metricCol} 平均 ${formatAverageValue(averageValue)}`,
            data: averageSeries,
            borderColor: "#ffb347",
            backgroundColor: "rgba(255,179,71,0.12)",
            borderDash: [8, 6],
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
            fill: false,
        });
    }

    chart.options.scales.y = {
        min: range.yMin !== null ? range.yMin : undefined,
        max: range.yMax !== null ? range.yMax : undefined,
    };
    chart.update();

    const averageText = showAverage && Number.isFinite(averageValue) ? ` | 平均 ${formatAverageValue(averageValue)}` : "";
    chartMeta.textContent = `${displayLabel} | ${metricCol} | ${labels.length} 點 | 過濾移除 ${processed.removed} 點${averageText}`;
}

function renderRangeMeta(range, categoryMeta, metricCol) {
    const rangeMeta = document.getElementById("rangeMeta");
    if (!rangeMeta) return;
    const yMinText = range.yMin === null ? "-inf" : String(range.yMin);
    const yMaxText = range.yMax === null ? "+inf" : String(range.yMax);
    
    // 更新這裡：使用 formatTaiwanTime 處理範圍顯示
    const tStartText = range.timeStart ? formatTaiwanTime(range.timeStart) : "earliest";
    const tEndText = range.timeEnd ? formatTaiwanTime(range.timeEnd) : "latest";
    rangeMeta.textContent = `${categoryMeta.label} | ${metricCol || "未選欄位"} | Y=[${yMinText}, ${yMaxText}] | Time=[${tStartText} ~ ${tEndText}]`;
}

async function main() {
    const metaEl = document.getElementById("metaGenerated");
    const categorySelect = document.getElementById("categorySelect");
    const searchInput = document.getElementById("searchInput");
    const metricSelect = document.getElementById("metricSelect");

    const localConfig = getLocalConfig();
    const filterCfg = getFilterConfig(localConfig);
    const viewCfg = getViewConfig(localConfig);

    const index = await getJson("data/index.json");
    const categories = index.categories || [];

    if (!categories.length) {
        metaEl.textContent = "找不到可顯示資料，先執行 make web-data";
        return;
    }

    metaEl.textContent = `資料更新時間(台灣時間): ${index.generatedAtUtc}`;
    renderCards(categories);

    categories.forEach((c) => {
        const option = document.createElement("option");
        option.value = c.file;
        option.textContent = c.label;
        categorySelect.appendChild(option);
    });

    const ctx = document.getElementById("lineChart").getContext("2d");
    const chart = new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "",
                    data: [],
                    borderColor: "#46f0c5",
                    backgroundColor: "rgba(70,240,197,0.16)",
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.18,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false,
            },
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: 8,
                        color: "#89a6b5",
                    },
                    grid: {
                        color: "#2a383f",
                    },
                },
                y: {
                    ticks: {
                        color: "#89a6b5",
                    },
                    grid: {
                        color: "#2a383f",
                    },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: "#e7f7f2",
                    },
                },
                tooltip: {
                    enabled: true,
                    mode: "index",
                    intersect: false,
                    callbacks: {
                        // 更新這裡：把提示標題改成台灣時間
                        title(items) {
                            if (!items || !items.length) return "";
                            return `時間(台灣): ${items[0].label}`;
                        },
                        label(context) {
                            const label = context.dataset?.label || "數值";
                            const value = Number(context.raw);
                            const text = Number.isFinite(value) ? value.toFixed(6) : String(context.raw ?? "");
                            return `${label}: ${text}`;
                        },
                    },
                },
            },
        },
    });

    let currentPayload = null;
    let currentCategoryMeta = categories[0];

    function refreshAll() {
        if (!currentPayload) return;
        const metric = metricSelect.value;
        const range = resolveDisplayRange(localConfig, currentCategoryMeta, metric);
        const valueRules = resolveValueFilterRules(localConfig, currentCategoryMeta);
        const baseRows = currentPayload.previewRows || [];
        const filteredByConfigRows = applyConfiguredValueFilters(baseRows, valueRules, metric);

        renderRangeMeta(range, currentCategoryMeta, metric);
        renderTable(currentPayload, currentCategoryMeta, filteredByConfigRows, searchInput.value.trim(), metric, range, viewCfg);

        if (metric) {
            renderChart(chart, currentCategoryMeta, currentPayload, filteredByConfigRows, metric, filterCfg, range);
        }
    }

    async function refreshCategory() {
        const f = categorySelect.value;
        currentCategoryMeta = categories.find((c) => c.file === f) || categories[0];

        try {
            currentPayload = await getJson(`data/${f}`);
            currentPayload = enrichAdcs1PowerColumns(currentPayload, currentCategoryMeta);
        } catch (err) {
            console.error(err);
            metricSelect.innerHTML = `<option value="">資料載入失敗</option>`;
            const chartMeta = document.getElementById("chartMeta");
            if (chartMeta) chartMeta.textContent = `載入 ${f} 失敗，檔案內容含有不合法的 NaN，請檢查。`;
            currentPayload = null;
            return;
        }

        const numericCols = removeUnitlessDuplicates(inferNumericColumns(currentPayload));
        metricSelect.innerHTML = "";
        numericCols.forEach((col) => {
            const option = document.createElement("option");
            option.value = col;
            option.textContent = col;
            metricSelect.appendChild(option);
        });

        if (!numericCols.length) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "無可繪製數值欄位";
            metricSelect.appendChild(option);
        } else {
            metricSelect.value = pickCategoryMetric(numericCols, viewCfg, currentCategoryMeta);
        }

        refreshAll();
    }

    categorySelect.addEventListener("change", refreshCategory);
    searchInput.addEventListener("input", refreshAll);
    metricSelect.addEventListener("change", refreshAll);

    await refreshCategory();
}

main().catch((err) => {
    const metaEl = document.getElementById("metaGenerated");
    metaEl.textContent = `載入失敗: ${err.message}`;
});
