// support.sheet – entra.js
// Ausgelagert aus entra.html

if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
    }

    let RULES        = [];
    let allRows      = [];
    let loadedFiles  = [];
    let activeFilter = 'all';

    fetch('./data/entra-rules.json').then(r => r.json()).then(d => {
      RULES = d.rules || [];
    }).catch(() => {});

    // ── Einheitliche Upload-Zone ──────────────────────────
    const dropZone  = document.getElementById('entra-drop-zone');
    const fileInput = document.getElementById('entra-file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.classList.remove('drag');
      [...e.dataTransfer.files].filter(f => f.name.endsWith('.csv')).forEach(readFile);
    });
    fileInput.addEventListener('change', e => {
      [...e.target.files].forEach(readFile);
      e.target.value = '';
    });

    function detectType(filename) {
      const f = filename.toLowerCase();
      if (f.includes('noninteractive'))  return { label: '🤖 Non-Interactive', color: '#60a5fa' };
      if (f.includes('interactive'))     return { label: '👤 Interactive',     color: '#7c8cf8' };
      if (f.includes('application'))     return { label: '⚙️ Application',     color: '#e8b339' };
      if (f.includes('msi'))             return { label: '🔑 MSI/Managed ID',  color: '#4ade80' };
      if (f.includes('authdetails'))     return { label: '🔍 Auth Details',     color: '#f472b6' };
      return { label: '📋 Sign-In Log', color: '#94a3b8' };
    }

    function readFile(file) {
      // Skip duplicates
      if (loadedFiles.some(f => f.name === file.name && f.size === file.size)) return;

      const reader = new FileReader();
      reader.onload = e => {
        const rows = parseCSV(e.target.result);
        if (!rows.length) return;
        const type = detectType(file.name);
        loadedFiles.push({ name: file.name, size: file.size, rows, type });
        updateFileList();
        updateAnalyzeBtn();
      };
      reader.readAsText(file, 'UTF-8');
    }

    function updateFileList() {
      const listEl = document.getElementById('entra-file-list');
      listEl.style.display = loadedFiles.length ? '' : 'none';
      listEl.replaceChildren();
      loadedFiles.forEach((f, idx) => {
        const item = document.createElement('div');
        item.className = 'entra-file-item';

        const typeTag = document.createElement('span');
        typeTag.className = 'entra-file-type';
        typeTag.textContent = f.type.label;
        typeTag.style.borderColor = f.type.color + '55';
        typeTag.style.color = f.type.color;

        const name = document.createElement('span');
        name.className = 'entra-file-name';
        name.textContent = f.name;

        const count = document.createElement('span');
        count.className = 'entra-file-count';
        count.textContent = f.rows.length.toLocaleString('de-DE') + ' Zeilen';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'entra-file-remove';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
          loadedFiles.splice(idx, 1);
          updateFileList();
          updateAnalyzeBtn();
        });

        item.appendChild(typeTag);
        item.appendChild(name);
        item.appendChild(count);
        item.appendChild(removeBtn);
        listEl.appendChild(item);
      });
    }

    function updateAnalyzeBtn() {
      const total    = loadedFiles.reduce((s, f) => s + f.rows.length, 0);
      const btn      = document.getElementById('analyze-btn');
      const hint     = document.getElementById('total-rows-hint');
      const clearBtn = document.getElementById('clear-btn');
      btn.disabled   = total === 0;
      hint.textContent = total > 0 ? `${total.toLocaleString('de-DE')} Einträge aus ${loadedFiles.length} Datei${loadedFiles.length > 1 ? 'en' : ''}` : '';
      clearBtn.style.display = total > 0 ? '' : 'none';
      // Drop zone feedback
      dropZone.classList.toggle('has-files', loadedFiles.length > 0);
    }

    function clearAll() {
      loadedFiles = [];
      updateFileList();
      updateAnalyzeBtn();
      document.getElementById('results-section').style.display = 'none';
    }

    function analyzeAll() {
      allRows = loadedFiles.flatMap(f => f.rows);
      if (!allRows.length) return;
      renderResults(allRows, `${allRows.length.toLocaleString('de-DE')} Einträge`);
    }

    // ── CSV Parser ────────────────────────────────────────
    function parseCSV(text) {
      // Handle BOM
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) return [];

      const headers = parseCSVLine(lines[0]);
      return lines.slice(1).map(line => {
        const vals = parseCSVLine(line);
        const obj = {};
        headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || '').trim(); });
        return obj;
      }).filter(r => Object.values(r).some(v => v));
    }

    function parseCSVLine(line) {
      const result = [];
      let cur = '', inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
          else inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
          result.push(cur); cur = '';
        } else cur += ch;
      }
      result.push(cur);
      return result;
    }

    // ── Field mapping (German column names) ──────────────
    function getField(row, ...keys) {
      for (const k of keys) if (row[k] !== undefined) return row[k] || '';
      return '';
    }
    const F = {
      date:    r => getField(r, 'Datum (UTC)', 'Datum'),
      status:  r => getField(r, 'Status'),
      code:    r => getField(r, 'Code des Anmeldefehlers'),
      reason:  r => getField(r, 'Fehlerursache'),
      user:    r => getField(r, 'Benutzer', 'Benutzername', 'Dienstprinzipalname'),
      app:     r => getField(r, 'Anwendung'),
      resource:r => getField(r, 'Ressource'),
      ca:      r => getField(r, 'Bedingter Zugriff'),
      mfa:     r => getField(r, 'Ergebnis der Multi-Faktor-Authentifizierung'),
      ip:      r => getField(r, 'IP-Adresse'),
      location:r => getField(r, 'Standort'),
    };

    // ── Render Results ────────────────────────────────────
    function renderResults(rows, filename) {
      activeFilter = 'all';

      const total    = rows.length;
      const errors   = rows.filter(r => F.status(r) === 'Fehler');
      const interrupts = rows.filter(r => F.status(r) === 'Unterbrochen');
      const success  = rows.filter(r => F.status(r) === 'Erfolg');

      // Overview grid
      const grid = document.getElementById('overview-grid');
      grid.replaceChildren();
      const items = [
        ['📋 Einträge gesamt', total, ''],
        ['✅ Erfolgreich',      success.length, 'good'],
        ['❌ Fehler',           errors.length,   errors.length > 0 ? 'bad' : 'good'],
        ['⚠️ Unterbrochen',    interrupts.length, interrupts.length > 0 ? 'warn' : ''],
        ['📅 Von', (F.date(rows[rows.length-1]) || '–').substring(0,10), ''],
        ['📅 Bis', (F.date(rows[0]) || '–').substring(0,10), ''],
      ];
      items.forEach(([label, value, cls]) => {
        const item = document.createElement('div');
        item.className = 'sys-item' + (cls === 'bad' ? ' item-bad' : cls === 'warn' ? ' item-warn' : cls === 'good' ? ' item-good' : '');
        const lbl = document.createElement('div'); lbl.className = 'sys-label'; lbl.textContent = label;
        const val = document.createElement('div'); val.className = 'sys-value' + (cls ? ' ' + cls : ''); val.textContent = value;
        item.appendChild(lbl); item.appendChild(val);
        grid.appendChild(item);
      });

      // Filter pills
      renderFilterPills(rows);

      // Findings
      const findings = analyzeSignIns(rows);
      document.getElementById('findings-count').textContent = findings.length;
      document.getElementById('findings-section').style.display = findings.length ? '' : 'none';
      renderFindings(findings);

      // Table
      renderTable(rows);
      document.getElementById('row-count').textContent = rows.length + ' Einträge';

      // Show results – scroll to TOP of results, not table
      document.getElementById('results-section').style.display = '';
      setTimeout(() => {
        document.getElementById('results-section').scrollIntoView({ behavior:'smooth', block:'start' });
      }, 100);
    }

    // ── Filter Pills ──────────────────────────────────────
    function renderFilterPills(rows) {
      const pills = document.getElementById('status-pills');
      pills.replaceChildren();
      const counts = {
        all:       rows.length,
        Fehler:    rows.filter(r => F.status(r) === 'Fehler').length,
        Unterbrochen: rows.filter(r => F.status(r) === 'Unterbrochen').length,
        Erfolg:    rows.filter(r => F.status(r) === 'Erfolg').length,
      };
      const defs = [
        { key:'all',          label: counts.all + ' Alle',          cls:'pill-all' },
        { key:'Fehler',       label: counts.Fehler + ' Fehler',     cls:'pill-error' },
        { key:'Unterbrochen', label: counts.Unterbrochen + ' Unterbrochen', cls:'pill-interrupt' },
        { key:'Erfolg',       label: counts.Erfolg + ' Erfolgreich', cls:'pill-success' },
      ];
      defs.forEach(({key, label, cls}) => {
        const n = key === 'all' ? counts.all : counts[key];
        if (key !== 'all' && n === 0) return;
        const btn = document.createElement('button');
        btn.className = 'event-filter-pill ' + cls + (activeFilter === key ? ' active' : '');
        btn.textContent = label;
        btn.addEventListener('click', () => {
          activeFilter = key;
          pills.querySelectorAll('.event-filter-pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const filtered = key === 'all' ? allRows : allRows.filter(r => F.status(r) === key);
          renderTable(filtered);
          document.getElementById('row-count').textContent = filtered.length + ' Einträge';
          document.getElementById('search-input').value = '';
        });
        pills.appendChild(btn);
      });
    }

    // ── Analyze Sign-Ins ──────────────────────────────────
    function analyzeSignIns(rows) {
      const results = [];
      const errors  = rows.filter(r => F.status(r) === 'Fehler' || F.status(r) === 'Unterbrochen');

      RULES.forEach(rule => {
        // Standard error code matching
        if (rule.errorCodes) {
          const matched = errors.filter(r => rule.errorCodes.includes(F.code(r)));
          if (!matched.length) return;
          const statusFilter = rule.statusFilter || [];
          const relevant = statusFilter.length ? matched.filter(r => statusFilter.includes(F.status(r))) : matched;
          if (!relevant.length) return;

          // Count by user for summary
          const users = [...new Set(relevant.map(r => F.user(r)).filter(Boolean))];
          const apps  = [...new Set(relevant.map(r => F.app(r)).filter(Boolean))];
          results.push({ rule, count: relevant.length, users, apps, rows: relevant.slice(0,5) });
          return;
        }

        // Group by user
        if (rule.type === 'groupByUser') {
          const target = (rule.statusFilter||[]).length
            ? errors.filter(r => rule.statusFilter.includes(F.status(r)))
            : errors;
          const groups = {};
          target.forEach(r => {
            const u = F.user(r);
            if (u) groups[u] = (groups[u]||0) + 1;
          });
          const top = Object.entries(groups).sort((a,b)=>b[1]-a[1])[0];
          if (!top || top[1] < rule.minCount) return;
          results.push({ rule, count: top[1], users: [top[0]], apps: [], summary: `${top[0]}: ${top[1]}× fehlgeschlagen` });
          return;
        }

        // Group by app
        if (rule.type === 'groupByApp') {
          const target = (rule.statusFilter||[]).length
            ? errors.filter(r => rule.statusFilter.includes(F.status(r)))
            : errors;
          const groups = {};
          target.forEach(r => {
            const a = F.app(r);
            if (a) groups[a] = (groups[a]||0) + 1;
          });
          const top = Object.entries(groups).sort((a,b)=>b[1]-a[1])[0];
          if (!top || top[1] < rule.minCount) return;
          results.push({ rule, count: top[1], users: [], apps: [top[0]], summary: `${top[0]}: ${top[1]}× Fehler` });
        }
      });

      // Sort by severity
      const ord = { critical:0, error:1, warning:2, info:3 };
      return results.sort((a,b) => (ord[a.rule.severity]||3) - (ord[b.rule.severity]||3));
    }

    // ── Render Findings ───────────────────────────────────
    function renderFindings(findings) {
      const container = document.getElementById('findings');
      container.replaceChildren();

      findings.forEach(({rule, count, users, apps, summary}) => {
        const card = document.createElement('div');
        card.className = 'finding-card'; card.dataset.sev = rule.severity;

        const header = document.createElement('div');
        header.className = 'finding-header';
        const sevPill = document.createElement('span');
        sevPill.className = 'sev-pill sev-' + rule.severity;
        sevPill.textContent = rule.severity;
        const title = document.createElement('span');
        title.className = 'finding-title';
        title.textContent = rule.name;
        const cnt = document.createElement('span');
        cnt.className = 'finding-count';
        cnt.textContent = count + '× erkannt';
        const expand = document.createElement('span');
        expand.className = 'finding-expand'; expand.textContent = '▼';

        header.appendChild(sevPill); header.appendChild(title);
        header.appendChild(cnt); header.appendChild(expand);
        header.addEventListener('click', () => {
          const body = header.nextElementSibling;
          expand.classList.toggle('open', body.classList.toggle('open'));
        });

        const body = document.createElement('div');
        body.className = 'finding-body';
        // Auto-open critical/error
        if (rule.severity === 'critical' || rule.severity === 'error') {
          body.classList.add('open'); expand.classList.add('open');
        }

        const desc = document.createElement('p');
        desc.className = 'finding-desc';
        desc.textContent = rule.description;
        body.appendChild(desc);

        // Affected users/apps
        if (users.length || apps.length) {
          const affected = document.createElement('div');
          affected.className = 'finding-sub-title';
          affected.textContent = 'Betroffen';
          affected.style.cssText = 'font-size:.7rem;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 6px';
          body.appendChild(affected);
          if (users.length) {
            const u = document.createElement('div');
            u.style.cssText = 'font-size:.78rem;color:var(--muted);margin-bottom:4px';
            u.textContent = '👤 ' + users.slice(0,5).join(', ') + (users.length > 5 ? ` +${users.length-5}` : '');
            body.appendChild(u);
          }
          if (apps.length) {
            const a = document.createElement('div');
            a.style.cssText = 'font-size:.78rem;color:var(--muted);margin-bottom:4px';
            a.textContent = '📱 ' + apps.slice(0,5).join(', ') + (apps.length > 5 ? ` +${apps.length-5}` : '');
            body.appendChild(a);
          }
        }

        // Recommendations
        if (rule.recommendations?.length) {
          const recTitle = document.createElement('div');
          recTitle.style.cssText = 'font-size:.7rem;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin:12px 0 6px';
          recTitle.textContent = 'Empfehlungen';
          body.appendChild(recTitle);
          const recList = document.createElement('div');
          recList.className = 'rec-list';
          rule.recommendations.forEach(rec => {
            const item = document.createElement('div'); item.className = 'rec-item';
            const textRow = document.createElement('div'); textRow.className = 'rec-text-row';
            const arrow = document.createElement('span'); arrow.className = 'rec-arrow'; arrow.textContent = '→';
            const text  = document.createElement('span'); text.className  = 'rec-text';  text.textContent = rec.text;
            const badges = document.createElement('div'); badges.className = 'rec-badges';
            if (rec.type) { const b=document.createElement('span'); b.className='rec-badge rec-type--'+rec.type; b.textContent=rec.type==='diagnose'?'Diagnose':rec.type==='fix'?'Fix':'Wartung'; badges.appendChild(b); }
            if (rec.risk) { const b=document.createElement('span'); b.className='rec-badge rec-risk--'+rec.risk; b.textContent=rec.risk==='low'?'Niedrig':rec.risk==='medium'?'Mittel':'Hoch'; badges.appendChild(b); }
            textRow.appendChild(arrow); textRow.appendChild(text); textRow.appendChild(badges);
            item.appendChild(textRow);
            if (rec.cmd) {
              const cmdRow = document.createElement('div'); cmdRow.className = 'rec-cmd-row';
              const cmdEl = document.createElement('code'); cmdEl.className = 'rec-cmd'; cmdEl.textContent = rec.cmd.length>80?rec.cmd.substring(0,80)+'…':rec.cmd; cmdEl.title=rec.cmd;
              const copyBtn = document.createElement('button'); copyBtn.className='rec-copy-btn'; copyBtn.textContent='📋 Kopieren';
              copyBtn.addEventListener('click', () => { navigator.clipboard?.writeText(rec.cmd).then(() => { copyBtn.textContent='✓ Kopiert'; copyBtn.classList.add('copied'); setTimeout(()=>{copyBtn.textContent='📋 Kopieren';copyBtn.classList.remove('copied');},1500); }); });
              cmdRow.appendChild(cmdEl); cmdRow.appendChild(copyBtn); item.appendChild(cmdRow);
            }
            recList.appendChild(item);
          });
          body.appendChild(recList);
        }

        card.appendChild(header); card.appendChild(body);
        container.appendChild(card);
      });
    }

    // ── Render Table ──────────────────────────────────────
    function renderTable(rows) {
      const tbody = document.getElementById('sign-in-table');
      const frag  = document.createDocumentFragment();
      rows.slice(0, 500).forEach(r => {
        const tr = document.createElement('tr');
        const status = F.status(r);
        const statusCls = status === 'Fehler' ? 'status-error' : status === 'Unterbrochen' ? 'status-interrupt' : 'status-success';
        const code = F.code(r);

        [
          { text: (F.date(r)||'').replace('T',' ').substring(0,19), mono:true },
          { html: `<span class="${statusCls}">${status}</span>` },
          { html: code && code !== '0' ? `<span class="err-code">${code}</span>` : '' },
          { text: F.user(r), muted:true },
          { text: F.app(r),  muted:true },
          { text: F.resource(r), muted:true },
          { text: (F.reason(r)||'').substring(0,80), muted:true },
        ].forEach(cell => {
          const td = document.createElement('td');
          if (cell.html !== undefined) { td.innerHTML = cell.html; }
          else {
            td.textContent = cell.text || '';
            if (cell.mono) td.style.fontFamily = 'var(--font-mono)';
            if (cell.muted) td.style.color = 'var(--muted)';
          }
          tr.appendChild(td);
        });
        frag.appendChild(tr);
      });
      tbody.replaceChildren(frag);
    }

    // ── Filter Table ──────────────────────────────────────
    function filterTable() {
      const q   = document.getElementById('search-input').value.toLowerCase().trim();
      const lvl = activeFilter !== 'all' ? activeFilter : null;
      let filtered = allRows;
      if (lvl) filtered = filtered.filter(r => F.status(r) === lvl);
      if (q)   filtered = filtered.filter(r =>
        F.user(r).toLowerCase().includes(q) || F.app(r).toLowerCase().includes(q) ||
        F.code(r).includes(q) || F.reason(r).toLowerCase().includes(q)
      );
      renderTable(filtered);
      document.getElementById('row-count').textContent = filtered.length + ' Einträge';
    }

    function toggleTable() {
      const wrap = document.getElementById('table-wrap');
      const icon = document.getElementById('table-icon');
      const hidden = wrap.style.display === 'none';
      wrap.style.display = hidden ? '' : 'none';
      icon.style.transform = hidden ? '' : 'rotate(-90deg)';
    }
    // ── Export Findings ───────────────────────────────────
    function exportFindings() {
      if (!allRows.length) return;
      const findings = analyzeSignIns(allRows);
      const errors   = allRows.filter(r => F.status(r) === 'Fehler');
      const interrupts = allRows.filter(r => F.status(r) === 'Unterbrochen');

      const payload = {
        exportedAt:  new Date().toISOString(),
        source:      `${loadedFiles.map(f=>f.name).join(', ')}`,
        totalRows:   allRows.length,
        summary: {
          total:       allRows.length,
          errors:      errors.length,
          interrupted: interrupts.length,
          success:     allRows.length - errors.length - interrupts.length,
        },
        findings: findings.map(f => ({
          severity:  f.rule.severity,
          name:      f.rule.name,
          category:  f.rule.category,
          count:     f.count,
          users:     f.users || [],
          apps:      f.apps  || [],
          description: f.rule.description,
          recommendations: (f.rule.recommendations || []).map(r =>
            `[${r.type||''}/${r.risk||''}] ${r.text}${r.cmd ? ' → ' + r.cmd : ''}`
          ),
        })),
        errorCodes: (() => {
          const codes = {};
          errors.forEach(r => {
            const c = F.code(r);
            if (c && c !== '0') codes[c] = (codes[c]||0) + 1;
          });
          return Object.entries(codes).sort((a,b)=>b[1]-a[1]).map(([code,count])=>({code,count}));
        })(),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `entra-findings-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('export-findings-btn')?.addEventListener('click', exportFindings);
    });
