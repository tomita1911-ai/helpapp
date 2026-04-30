// ========================================
// ヘルプ管理アプリ - メインスクリプト
// ========================================

(function () {
  'use strict';

  // --- データ管理 ---
  const STORAGE_KEYS = {
    members: 'help_members',
    records: 'help_records',
    draft: 'help_draft',
  };

  function loadData(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || [];
    } catch {
      return [];
    }
  }

  function saveData(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function getMembers() {
    return loadData(STORAGE_KEYS.members);
  }

  function setMembers(list) {
    saveData(STORAGE_KEYS.members, list);
  }

  function getRecords() {
    return loadData(STORAGE_KEYS.records);
  }

  function setRecords(list) {
    saveData(STORAGE_KEYS.records, list);
  }

  // --- トースト通知 ---
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2200);
  }

  // --- タブ切り替え ---
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

        // タブ切り替え時にデータ更新
        const tab = btn.dataset.tab;
        if (tab === 'history') renderHistory();
        if (tab === 'stats') renderStats();
        if (tab === 'settings') renderSettings();
      });
    });
  }

  // --- 日付を今日にセット ---
  function initDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('parse-date').value = today;
  }

  // --- 下書き保存（テキストエリア・日付） ---
  function saveDraft() {
    const text = document.getElementById('outlook-text').value;
    const date = document.getElementById('parse-date').value;
    if (text) {
      localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify({ text, date }));
    } else {
      localStorage.removeItem(STORAGE_KEYS.draft);
    }
  }

  function loadDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(STORAGE_KEYS.draft));
      if (!draft) return;
      if (draft.text) document.getElementById('outlook-text').value = draft.text;
      if (draft.date) document.getElementById('parse-date').value = draft.date;
    } catch {}
  }

  function clearDraft() {
    localStorage.removeItem(STORAGE_KEYS.draft);
  }

  // ========================================
  // Outlookテキスト解析
  // ========================================
  function parseOutlookText(text, members) {
    const results = [];
    const lines = text.split('\n');
    let currentPerson = null;

    // メンバー名のマッチ用（「さん」付きと無しの両方に対応）
    const memberNames = members.map(m => m.replace(/さん$/, ''));

    // 漢字の表記ゆれマップ
    const KANJI_VARIANTS = [
      ['舘', '館', '舘'], ['斉', '斎', '齊', '齋'], ['澤', '沢'], ['濱', '浜'],
      ['邊', '辺', '邉'], ['髙', '高'], ['﨑', '崎', '嵜', '碕'], ['廣', '広'],
      ['國', '国'], ['藏', '蔵'], ['條', '条'], ['櫻', '桜'],
      ['渡', '渡'], ['辻', '辻'], ['吉', '𠮷'],
    ];

    function normalize(str) {
      let s = str;
      for (const group of KANJI_VARIANTS) {
        const first = group[0];
        for (let i = 1; i < group.length; i++) {
          s = s.replaceAll(group[i], first);
        }
      }
      return s;
    }

    const normalizedMembers = memberNames.map(n => normalize(n));

    function findMemberName(str) {
      // 「さん」を除去してから検索
      const cleaned = str.replace(/さん$/, '').trim();
      const normStr = normalize(cleaned);

      // 完全一致を最優先（長い名前から）
      const indices = memberNames.map((_, i) => i).sort((a, b) => memberNames[b].length - memberNames[a].length);

      // まず完全一致を試行
      for (const i of indices) {
        if (normStr === normalizedMembers[i]) return memberNames[i];
      }
      // 次に部分一致（括弧内に名前+余計なテキストがある場合）
      for (const i of indices) {
        if (normStr.includes(normalizedMembers[i])) {
          // 名前が括弧の内容の大部分を占めているかチェック
          // 短すぎるマッチ（1文字）で長い文字列にマッチするのを防止
          const nameLen = normalizedMembers[i].length;
          if (nameLen >= 2 || normStr.length <= nameLen + 2) {
            return memberNames[i];
          }
        }
      }
      return null;
    }

    // 括弧内がメンバー名として妥当かチェック
    function isBracketContentLikelyName(inner) {
      // 明らかに名前ではないパターンを除外
      // 長すぎる（10文字超）→ 説明文の可能性が高い
      if (inner.length > 10) return false;
      // 英数字のみ（型番等）
      if (/^[a-zA-Z0-9\s]+$/.test(inner)) return false;
      // 「〜から」「〜より」等の文章的パターン
      if (/から|より|まで|ため|について|による/.test(inner)) return false;
      return true;
    }

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // セクションヘッダー判定（名前だけの行）
      const cleanedLine = line.replace(/さん$/, '').trim();
      const normCleaned = normalize(cleanedLine);
      const memberIdx = normalizedMembers.indexOf(normCleaned);
      if (memberIdx !== -1 && cleanedLine.length <= memberNames[memberIdx].length + 2) {
        currentPerson = memberNames[memberIdx];
        continue;
      }

      // 括弧内の名前を検出
      // セクションの人 = ヘルプに行った人（応援者）
      // 括弧内の人 = ヘルプを依頼した人
      if (currentPerson) {
        const bracketMatches = line.match(/[（(]([^）)]+)[）)]/g);
        if (bracketMatches) {
          for (const bracket of bracketMatches) {
            const inner = bracket.replace(/[（()）)]/g, '').trim();

            // 名前らしいかフィルタリング
            if (!isBracketContentLikelyName(inner)) continue;

            const helpee = findMemberName(inner);
            if (helpee && helpee !== currentPerson) {
              const { facility, product } = extractFacilityAndProduct(line);
              results.push({
                helper: currentPerson,   // セクション = ヘルプに行った人
                helpee: helpee,          // 括弧内 = ヘルプを依頼した人
                facility: facility,
                product: product,
              });
            }
          }
        }
      }
    }

    return results;
  }

  function extractFacilityAndProduct(line) {
    // 時間部分を段階的に除去
    let cleaned = line
      .replace(/^\s*\d{1,2}:\d{2}[〜~～]\d{1,2}:\d{2}\s*/, '')  // 12:00〜12:30
      .replace(/^\s*\d{1,2}:\d{2}\s*/, '')                        // 9:00
      .replace(/^\s*\d{3,4}\s*/, '')                               // 0900
      .replace(/^[oO][cC]\s*/, '')                                 // OC
      .replace(/[（(][^）)]+[）)]/g, '')                           // 括弧部分を除去
      .trim();

    // 全角・半角スペースやタブで分割
    const parts = cleaned.split(/[\s　\t]+/).filter(Boolean);

    // parts[0] = 施設名, parts[1以降] = 製品名
    const facility = parts[0] || '';
    const product = parts.slice(1).join(' ') || '';

    return { facility, product };
  }

  // --- 解析ボタン ---
  function initParse() {
    document.getElementById('parse-btn').addEventListener('click', () => {
      const text = document.getElementById('outlook-text').value.trim();

      if (!text) {
        showToast('テキストを貼り付けてください');
        return;
      }

      const date = document.getElementById('parse-date').value;
      if (!date) {
        showToast('日付を入力してください');
        return;
      }

      const members = getMembers();
      if (members.length === 0) {
        showToast('先に設定タブでメンバーを登録してください');
        return;
      }

      const results = parseOutlookText(text, members);

      if (results.length === 0) {
        showToast('ヘルプが検出されませんでした');
        document.getElementById('parse-result').style.display = 'none';
        return;
      }

      // 解析結果を表示
      renderParseResults(results, date);
    });

    document.getElementById('save-parsed-btn').addEventListener('click', () => {
      saveParsedResults();
    });

    // 下書き自動保存
    document.getElementById('outlook-text').addEventListener('input', saveDraft);
    document.getElementById('parse-date').addEventListener('change', saveDraft);
  }

  let pendingDate = '';

  function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function renderParseResults(results, date) {
    pendingDate = date;

    const container = document.getElementById('parse-list');
    container.innerHTML = '';

    const countEl = document.createElement('div');
    countEl.className = 'parse-count';
    countEl.textContent = `${results.length}件検出（チェックを外した行は保存されません）`;
    container.appendChild(countEl);

    const members = getMembers();
    const memberOptions = members.map(m => `<option value="${escapeAttr(m)}">${m}</option>`).join('');

    for (const r of results) {
      const div = document.createElement('div');
      div.className = 'parse-item';
      div.innerHTML = `
        <div class="parse-row">
          <input type="checkbox" class="parse-check" checked>
          <select class="parse-helper">${memberOptions}</select>
          <span class="parse-arrow">→</span>
          <select class="parse-helpee">${memberOptions}</select>
        </div>
        <input type="text" class="parse-facility" value="${escapeAttr(r.facility)}" placeholder="施設名">
        <input type="text" class="parse-product" value="${escapeAttr(r.product)}" placeholder="製品名">
      `;
      div.querySelector('.parse-helper').value = r.helper;
      div.querySelector('.parse-helpee').value = r.helpee;
      container.appendChild(div);
    }

    document.getElementById('parse-result').style.display = 'block';
  }

  function saveParsedResults() {
    const items = document.querySelectorAll('#parse-list .parse-item');
    if (items.length === 0) return;

    const records = getRecords();
    let saved = 0;
    items.forEach(item => {
      if (!item.querySelector('.parse-check').checked) return;
      records.push({
        id: Date.now() + Math.random(),
        date: pendingDate,
        helper: item.querySelector('.parse-helper').value,
        helpee: item.querySelector('.parse-helpee').value,
        facility: item.querySelector('.parse-facility').value,
        product: item.querySelector('.parse-product').value,
      });
      saved++;
    });

    if (saved === 0) {
      showToast('保存する項目がありません');
      return;
    }

    setRecords(records);
    showToast(`${saved}件のヘルプを保存しました`);
    pendingDate = '';
    document.getElementById('outlook-text').value = '';
    document.getElementById('parse-result').style.display = 'none';
    clearDraft();
  }

  // ========================================
  // 履歴タブ
  // ========================================
  function renderHistory() {
    const records = getRecords();
    const memberFilter = document.getElementById('filter-member').value;
    const monthFilter = document.getElementById('filter-month').value;

    let filtered = records;
    if (memberFilter) {
      filtered = filtered.filter(r => r.helper === memberFilter || r.helpee === memberFilter);
    }
    if (monthFilter) {
      filtered = filtered.filter(r => r.date && r.date.startsWith(monthFilter));
    }

    // 日付の新しい順にソート
    filtered.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const container = document.getElementById('history-list');
    const emptyMsg = document.getElementById('history-empty');
    container.innerHTML = '';

    if (filtered.length === 0) {
      emptyMsg.style.display = 'block';
      return;
    }
    emptyMsg.style.display = 'none';

    for (const r of filtered) {
      const div = document.createElement('div');
      div.className = 'history-item';
      renderHistoryItemView(div, r);
      container.appendChild(div);
    }

    // フィルター更新
    updateHistoryFilters();
  }

  function renderHistoryItemView(div, r) {
    div.innerHTML = `
      <div class="history-actions">
        <button class="history-edit-btn">編集</button>
        <button class="delete-btn">&times;</button>
      </div>
      <div class="history-date">${formatDate(r.date)}</div>
      <div class="history-main">${r.helper} → ${r.helpee} のヘルプ</div>
      <div class="history-detail">${r.facility || ''}${r.product ? '　' + r.product : ''}</div>
    `;
    div.querySelector('.history-edit-btn').addEventListener('click', () => {
      renderHistoryItemEdit(div, r);
    });
    div.querySelector('.delete-btn').addEventListener('click', () => {
      if (!confirm('この履歴を削除しますか？')) return;
      const recs = getRecords().filter(rec => rec.id !== r.id);
      setRecords(recs);
      renderHistory();
      showToast('削除しました');
    });
  }

  function renderHistoryItemEdit(div, r) {
    const members = getMembers();
    const memberOptions = members.map(m => `<option value="${escapeAttr(m)}">${m}</option>`).join('');
    div.innerHTML = `
      <input type="date" class="edit-date" value="${r.date || ''}">
      <div class="edit-row">
        <select class="edit-helper">${memberOptions}</select>
        <span class="parse-arrow">→</span>
        <select class="edit-helpee">${memberOptions}</select>
      </div>
      <input type="text" class="edit-facility" value="${escapeAttr(r.facility)}" placeholder="施設名">
      <input type="text" class="edit-product" value="${escapeAttr(r.product)}" placeholder="製品名">
      <div class="edit-buttons">
        <button class="btn-edit-save">保存</button>
        <button class="btn-edit-cancel">キャンセル</button>
      </div>
    `;
    div.querySelector('.edit-helper').value = r.helper;
    div.querySelector('.edit-helpee').value = r.helpee;

    div.querySelector('.btn-edit-save').addEventListener('click', () => {
      const updated = {
        ...r,
        date: div.querySelector('.edit-date').value,
        helper: div.querySelector('.edit-helper').value,
        helpee: div.querySelector('.edit-helpee').value,
        facility: div.querySelector('.edit-facility').value,
        product: div.querySelector('.edit-product').value,
      };
      const recs = getRecords().map(rec => rec.id === r.id ? updated : rec);
      setRecords(recs);
      renderHistory();
      showToast('更新しました');
    });
    div.querySelector('.btn-edit-cancel').addEventListener('click', () => {
      renderHistoryItemView(div, r);
    });
  }

  function updateHistoryFilters() {
    const records = getRecords();
    const members = new Set();
    const months = new Set();

    for (const r of records) {
      if (r.helper) members.add(r.helper);
      if (r.helpee) members.add(r.helpee);
      if (r.date) months.add(r.date.substring(0, 7));
    }

    updateSelectOptions('filter-member', [...members].sort(), '全メンバー');
    updateSelectOptions('filter-month', [...months].sort().reverse(), '全期間', m => {
      const [y, mo] = m.split('-');
      return `${y}年${parseInt(mo)}月`;
    });
  }

  function initHistoryFilters() {
    document.getElementById('filter-member').addEventListener('change', renderHistory);
    document.getElementById('filter-month').addEventListener('change', renderHistory);
  }

  // ========================================
  // グラフ描画
  // ========================================
  function drawBarChart(canvasId, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const entries = data.length > 0 ? data : [];
    const barHeight = Math.max(30, entries.length > 0 ? 30 : 0);
    const padding = { top: 20, bottom: 20, left: 150, right: 40 };
    const chartHeight = entries.length * barHeight + padding.top + padding.bottom;
    const chartWidth = Math.max(300, window.innerWidth - 40);

    canvas.width = chartWidth;
    canvas.height = Math.max(200, chartHeight);

    if (entries.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('データがありません', chartWidth / 2, canvas.height / 2);
      return;
    }

    const maxCount = Math.max(...entries.map(e => e[1].length), 1);
    const barWidth = (chartWidth - padding.left - padding.right) / Math.max(maxCount, 1);

    // Y軸ラベル（メンバー名）
    ctx.fillStyle = '#334155';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i < entries.length; i++) {
      const y = padding.top + i * barHeight + barHeight / 2;
      const name = entries[i][0].length > 12 ? entries[i][0].substring(0, 12) + '…' : entries[i][0];
      ctx.fillText(name, padding.left - 10, y + 5);
    }

    // 棒グラフ
    ctx.fillStyle = '#3b82f6';
    for (let i = 0; i < entries.length; i++) {
      const count = entries[i][1].length;
      const x = padding.left;
      const y = padding.top + i * barHeight + 5;
      const width = (count / maxCount) * (chartWidth - padding.left - padding.right);
      ctx.fillRect(x, y, width, barHeight - 10);

      // 数字表示
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(count, padding.left + width + 8, y + 18);
    }

    // X軸
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, chartHeight - padding.bottom);
    ctx.lineTo(chartWidth - padding.right, chartHeight - padding.bottom);
    ctx.stroke();
  }

  function drawCombinedBarChart(canvasId, helperData, helpeeData) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // データをMapに変換
    const helperMap = new Map(helperData.map(([n, recs]) => [n, recs.length]));
    const helpeeMap = new Map(helpeeData.map(([n, recs]) => [n, recs.length]));

    // メンバー名の和集合
    const allNames = new Set([...helperMap.keys(), ...helpeeMap.keys()]);
    let entries = [...allNames].map(name => ({
      name,
      helperCount: helperMap.get(name) || 0,
      helpeeCount: helpeeMap.get(name) || 0,
    }));

    // 合計回数の降順、同数なら名前順
    entries.sort((a, b) =>
      (b.helperCount + b.helpeeCount) - (a.helperCount + a.helpeeCount)
      || a.name.localeCompare(b.name, 'ja')
    );

    // レイアウト
    const groupHeight = 40;
    const barHeight = 14;
    const barGap = 2;
    const padding = { top: 16, bottom: 24, left: 110, right: 60 };
    const chartWidth = Math.max(320, window.innerWidth - 40);
    const chartHeight = entries.length * groupHeight + padding.top + padding.bottom;

    canvas.width = chartWidth;
    canvas.height = Math.max(160, chartHeight);

    // 空データ処理
    if (entries.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('データがありません', chartWidth / 2, canvas.height / 2);
      return;
    }

    // 共通スケール（helper/helpee両方の最大値）
    const maxCount = Math.max(
      1,
      ...entries.map(e => Math.max(e.helperCount, e.helpeeCount))
    );

    const innerWidth = chartWidth - padding.left - padding.right;

    // メンバー名（Y軸ラベル）
    ctx.fillStyle = '#334155';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < entries.length; i++) {
      const groupY = padding.top + i * groupHeight;
      const labelY = groupY + groupHeight / 2;
      const name = entries[i].name.length > 10
        ? entries[i].name.substring(0, 10) + '…'
        : entries[i].name;
      ctx.fillText(name, padding.left - 10, labelY);
    }

    // 棒2本ずつ描画
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const groupY = padding.top + i * groupHeight;
      const groupCenter = groupY + groupHeight / 2;
      const helperY = groupCenter - barHeight - barGap / 2;
      const helpeeY = groupCenter + barGap / 2;

      // 応援（青）
      const helperWidth = (e.helperCount / maxCount) * innerWidth;
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(padding.left, helperY, helperWidth, barHeight);

      // 依頼（赤）
      const helpeeWidth = (e.helpeeCount / maxCount) * innerWidth;
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(padding.left, helpeeY, helpeeWidth, barHeight);

      // 数字ラベル
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.helperCount, padding.left + helperWidth + 6, helperY + barHeight / 2);
      ctx.fillText(e.helpeeCount, padding.left + helpeeWidth + 6, helpeeY + barHeight / 2);
    }

    // 軸線
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, canvas.height - padding.bottom);
    ctx.lineTo(chartWidth - padding.right, canvas.height - padding.bottom);
    ctx.stroke();
  }

  // ========================================
  // 集計タブ
  // ========================================
  function renderStats() {
    const records = getRecords();
    const monthFilter = document.getElementById('stats-month').value;

    let filtered = records;
    if (monthFilter) {
      filtered = filtered.filter(r => r.date && r.date.startsWith(monthFilter));
    }

    // 月別サマリー
    renderStatsSummary(filtered, monthFilter);

    // ヘルプした回数（応援者別）
    const helperData = countByWithRecords(filtered, 'helper');
    renderStatsTable('stats-helper', helperData, '応援者', '回数', 'helper');

    // ヘルプされた回数（依頼者別）
    const helpeeData = countByWithRecords(filtered, 'helpee');
    renderStatsTable('stats-helpee', helpeeData, '依頼者', '回数', 'helpee');

    // 統合グラフ
    drawCombinedBarChart('chart-combined', helperData, helpeeData);

    // 月フィルター更新
    const months = new Set();
    for (const r of records) {
      if (r.date) months.add(r.date.substring(0, 7));
    }
    updateSelectOptions('stats-month', [...months].sort().reverse(), '全期間', m => {
      const [y, mo] = m.split('-');
      return `${y}年${parseInt(mo)}月`;
    });
  }

  function generateCSV(helperData, helpeeData, monthLabel) {
    const lines = [];

    lines.push('応援者別ヘルプ統計');
    lines.push(`期間,${monthLabel}`);
    lines.push('メンバー,回数');

    for (const [name, records] of helperData) {
      lines.push(`"${name}",${records.length}`);
    }

    lines.push('');
    lines.push('依頼者別ヘルプ統計');
    lines.push(`期間,${monthLabel}`);
    lines.push('メンバー,回数');

    for (const [name, records] of helpeeData) {
      lines.push(`"${name}",${records.length}`);
    }

    return lines.join('\n');
  }

  function downloadCSV() {
    const records = getRecords();
    const monthFilter = document.getElementById('stats-month').value;

    let filtered = records;
    if (monthFilter) {
      filtered = filtered.filter(r => r.date && r.date.startsWith(monthFilter));
    }

    const monthLabel = monthFilter
      ? (() => { const [y, mo] = monthFilter.split('-'); return `${y}年${parseInt(mo)}月`; })()
      : '全期間';

    const helperData = countByWithRecords(filtered, 'helper');
    const helpeeData = countByWithRecords(filtered, 'helpee');

    const csv = generateCSV(helperData, helpeeData, monthLabel);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `help-report_${new Date().toISOString().substring(0, 10)}.csv`;
    a.click();

    showToast('CSVファイルをダウンロードしました');
  }

  function downloadPDF() {
    const records = getRecords();
    const monthFilter = document.getElementById('stats-month').value;

    let filtered = records;
    if (monthFilter) {
      filtered = filtered.filter(r => r.date && r.date.startsWith(monthFilter));
    }

    const monthLabel = monthFilter
      ? (() => { const [y, mo] = monthFilter.split('-'); return `${y}年${parseInt(mo)}月`; })()
      : '全期間';

    // html2canvasでDOM全体をキャプチャしてPDF化
    if (typeof html2canvas === 'undefined' || typeof jsPDF === 'undefined') {
      showToast('PDFライブラリが読み込まれていません');
      return;
    }

    // 集計タブのコンテナをキャプチャ
    const statsTab = document.getElementById('tab-stats');
    if (!statsTab) {
      showToast('集計データが見つかりません');
      return;
    }

    // キャンバス要素の高さを調整して、全内容がキャプチャされるようにする
    const originalHeight = statsTab.style.height;
    statsTab.style.height = 'auto';

    html2canvas(statsTab, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    }).then(canvas => {
      statsTab.style.height = originalHeight;

      const imgData = canvas.toDataURL('image/png');
      const imgWidth = 210; // A4幅（mm）
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageHeight = 297; // A4高さ（mm）
      let heightLeft = imgHeight;
      let position = 0;

      // 最初のページ
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // 必要に応じてページを追加
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`help-report_${new Date().toISOString().substring(0, 10)}.pdf`);
      showToast('PDFファイルをダウンロードしました');
    }).catch(error => {
      statsTab.style.height = originalHeight;
      console.error('PDF生成エラー:', error);
      showToast('PDFの生成に失敗しました');
    });
  }

  function generateExcelData(helperData, helpeeData, monthLabel) {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJSライブラリが読み込まれていません');
    }

    // Sheet1: 応援者別
    const helperSheetData = [
      ['応援者別ヘルプ統計'],
      ['期間', monthLabel],
      [],
      ['メンバー', '回数'],
    ];

    for (const [name, records] of helperData) {
      helperSheetData.push([name, records.length]);
    }

    // Sheet2: 依頼者別
    const helpeeSheetData = [
      ['依頼者別ヘルプ統計'],
      ['期間', monthLabel],
      [],
      ['メンバー', '回数'],
    ];

    for (const [name, records] of helpeeData) {
      helpeeSheetData.push([name, records.length]);
    }

    // ワークシート生成
    const ws1 = XLSX.utils.aoa_to_sheet(helperSheetData);
    const ws2 = XLSX.utils.aoa_to_sheet(helpeeSheetData);

    // セル幅の自動調整
    ws1['!cols'] = [{wch: 20}, {wch: 10}];
    ws2['!cols'] = [{wch: 20}, {wch: 10}];

    // ワークブック生成
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, '応援者別');
    XLSX.utils.book_append_sheet(wb, ws2, '依頼者別');

    return wb;
  }

  function downloadExcel() {
    const records = getRecords();
    const monthFilter = document.getElementById('stats-month').value;

    let filtered = records;
    if (monthFilter) {
      filtered = filtered.filter(r => r.date && r.date.startsWith(monthFilter));
    }

    const monthLabel = monthFilter
      ? (() => { const [y, mo] = monthFilter.split('-'); return `${y}年${parseInt(mo)}月`; })()
      : '全期間';

    try {
      const helperData = countByWithRecords(filtered, 'helper');
      const helpeeData = countByWithRecords(filtered, 'helpee');

      const wb = generateExcelData(helperData, helpeeData, monthLabel);
      const filename = `help-report_${new Date().toISOString().substring(0, 10)}.xlsx`;

      XLSX.writeFile(wb, filename);
      showToast('Excelファイルをダウンロードしました');
    } catch (error) {
      console.error('Excel生成エラー:', error);
      showToast('Excelの生成に失敗しました');
    }
  }

  function renderStatsSummary(filtered, monthFilter) {
    const container = document.getElementById('stats-summary');
    if (!container) return;

    const title = monthFilter
      ? (() => { const [y, mo] = monthFilter.split('-'); return `${y}年${parseInt(mo)}月`; })()
      : '全期間';

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="summary-title">${title}</div>
        <p class="empty-msg">データなし</p>
      `;
      return;
    }

    // 稼働日数
    const dateSet = new Set();
    for (const r of filtered) {
      if (r.date) dateSet.add(r.date);
    }

    container.innerHTML = `
      <div class="summary-title">${title}</div>
      <div class="summary-grid">
        <div class="summary-cell">
          <div class="summary-num">${filtered.length}</div>
          <div class="summary-label">ヘルプ総数</div>
        </div>
        <div class="summary-cell">
          <div class="summary-num">${dateSet.size}</div>
          <div class="summary-label">稼働日数</div>
        </div>
      </div>
    `;
  }

  function countByWithRecords(records, field) {
    const groups = {};
    for (const r of records) {
      const key = r[field] || '(不明)';
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }

  function renderStatsTable(containerId, data, labelHeader, countHeader, field) {
    const container = document.getElementById(containerId);
    if (data.length === 0) {
      container.innerHTML = '<p class="empty-msg">データなし</p>';
      return;
    }

    const maxCount = Math.max(...data.map(d => d[1].length));
    container.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'stats-table';
    table.innerHTML = `<thead><tr><th>${labelHeader}</th><th style="text-align:right">${countHeader}</th></tr></thead>`;
    const tbody = document.createElement('tbody');

    for (const [name, recs] of data) {
      const count = recs.length;
      const barWidth = Math.max(4, (count / maxCount) * 80);

      // メイン行
      const tr = document.createElement('tr');
      tr.className = 'stats-row-clickable';
      tr.innerHTML = `
        <td><span class="stats-bar" style="width:${barWidth}px"></span>${name} <span class="expand-icon">&#9660;</span></td>
        <td>${count}</td>
      `;
      tbody.appendChild(tr);

      // 詳細行（初期非表示）
      const detailTr = document.createElement('tr');
      detailTr.className = 'stats-detail-row';
      detailTr.style.display = 'none';

      let detailHtml = '<td colspan="2"><div class="stats-detail-list">';
      const sorted = [...recs].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      for (const r of sorted) {
        const dateStr = formatDate(r.date);
        const prodStr = r.product ? '　' + r.product : '';
        if (field === 'helper') {
          detailHtml += `<div class="stats-detail-item">${dateStr}　→ ${r.helpee}　${r.facility || ''}${prodStr}</div>`;
        } else if (field === 'helpee') {
          detailHtml += `<div class="stats-detail-item">${dateStr}　← ${r.helper}　${r.facility || ''}${prodStr}</div>`;
        } else {
          detailHtml += `<div class="stats-detail-item">${dateStr}　${r.helper} → ${r.helpee}${prodStr}</div>`;
        }
      }
      detailHtml += '</div></td>';
      detailTr.innerHTML = detailHtml;
      tbody.appendChild(detailTr);

      // クリックで開閉
      tr.addEventListener('click', () => {
        const isOpen = detailTr.style.display !== 'none';
        detailTr.style.display = isOpen ? 'none' : 'table-row';
        tr.classList.toggle('expanded', !isOpen);
      });
    }

    table.appendChild(tbody);
    container.appendChild(table);
  }

  function initStatsFilter() {
    document.getElementById('stats-month').addEventListener('change', renderStats);
  }

  // ========================================
  // 設定タブ
  // ========================================
  function renderSettings() {
    renderMemberList();
  }

  function renderMemberList() {
    const members = getMembers();
    const ul = document.getElementById('member-list');
    ul.innerHTML = '';

    for (const name of members) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${name}</span><button class="delete-btn" data-name="${name}">&times;</button>`;
      ul.appendChild(li);
    }

    ul.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.name;
        const updated = getMembers().filter(m => m !== name);
        setMembers(updated);
        renderMemberList();
        showToast(`${name} を削除しました`);
      });
    });
  }

  function initExportButtons() {
    const csvBtn = document.getElementById('export-csv-btn');
    const excelBtn = document.getElementById('export-excel-btn');
    const pdfBtn = document.getElementById('export-pdf-btn');

    if (csvBtn) {
      csvBtn.addEventListener('click', downloadCSV);
    }
    if (excelBtn) {
      excelBtn.addEventListener('click', downloadExcel);
    }
    if (pdfBtn) {
      pdfBtn.addEventListener('click', downloadPDF);
    }
  }

  function initSettings() {
    // メンバー追加
    document.getElementById('add-member-btn').addEventListener('click', () => {
      const input = document.getElementById('new-member');
      const name = input.value.trim().replace(/さん$/, '');
      if (!name) return;

      const members = getMembers();
      if (members.includes(name)) {
        showToast('既に登録されています');
        return;
      }
      members.push(name);
      setMembers(members);
      input.value = '';
      renderMemberList();
      showToast(`${name} を追加しました`);
    });

    // Enterキーでも追加
    document.getElementById('new-member').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('add-member-btn').click();
      }
    });

    // データエクスポート
    document.getElementById('export-btn').addEventListener('click', () => {
      const data = {
        members: getMembers(),
        records: getRecords(),
        exportDate: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ヘルプ管理_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('エクスポートしました');
    });

    // データインポート
    document.getElementById('import-btn').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.members) setMembers(data.members);
          if (data.records) setRecords(data.records);
          renderSettings();
          showToast('インポートしました');
        } catch {
          showToast('ファイル形式が正しくありません');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // 全データ削除
    document.getElementById('clear-btn').addEventListener('click', () => {
      if (confirm('全てのデータを削除しますか？この操作は取り消せません。')) {
        localStorage.removeItem(STORAGE_KEYS.members);
        localStorage.removeItem(STORAGE_KEYS.records);
        localStorage.removeItem(STORAGE_KEYS.draft);
        document.getElementById('outlook-text').value = '';
        renderSettings();
        showToast('全データを削除しました');
      }
    });
  }

  // ========================================
  // ユーティリティ
  // ========================================
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${y}年${parseInt(m)}月${parseInt(d)}日`;
  }

  function updateSelectOptions(selectId, values, defaultLabel, formatter) {
    const select = document.getElementById(selectId);
    const currentValue = select.value;
    select.innerHTML = `<option value="">${defaultLabel}</option>`;
    for (const v of values) {
      const label = formatter ? formatter(v) : v;
      select.innerHTML += `<option value="${v}">${label}</option>`;
    }
    select.value = currentValue;
  }

  // ========================================
  // 初期化
  // ========================================
  function init() {
    initTabs();
    initDate();
    initParse();
    loadDraft();
    initHistoryFilters();
    initStatsFilter();
    initExportButtons();
    initSettings();
    renderSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
