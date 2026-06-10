// support.sheet – har.js
// Ausgelagert aus har.html

if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
    }

    let HAR_RULES = [];
    let allHarRows = [];

    fetch('./data/har-rules.json').then(r => r.json()).then(d => {
      HAR_RULES = d.rules || [];
    }).catch(() => {});

    const AUTH_PATTERNS = [
      'login.microsoftonline.com','login.microsoft.com','login.live.com',
      'oauth2','msal','token','auth','sso','saml','signin','authorize',
      'access_token','id_token','refresh_token','graph.microsoft.com/v1.0/me'
    ];

    function isAuth(url) {
      const u = url.toLowerCase();
      return AUTH_PATTERNS.some(p => u.includes(p));
    }

    function fmtUrl(url) {
      try { const u = new URL(url); return u.hostname + u.pathname.slice(0,60) + (u.pathname.length>60?'…':''); }
      catch { return url.slice(0,80); }
    }

    function fmtTime(s) {
      return new Date(s).toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    }

    function statusCls(s) {
      if (s === 401) return 'status-401';
      if (s === 0)   return 'status-0';
      if (s >= 500)  return 'status-5xx';
      if (s >= 400)  return 'status-4xx';
      return 'status-ok';
    }

    // ── Upload ────────────────────────────────────────────
    const zone  = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); });
    input.addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });

    function setProgress(v) { document.getElementById('progress-fill').style.width = v + '%'; }

    function processFile(file) {
      zone.style.opacity = '0.5';
      document.getElementById('progress-wrap').style.display = '';
      setProgress(10);
      const reader = new FileReader();
      reader.onload = e => {
        setProgress(40);
        setTimeout(() => {
          try {
            const har = JSON.parse(e.target.result);
            setProgress(80);
            analyze(har, file.name);
            setProgress(100);
            setTimeout(() => {
              document.getElementById('progress-wrap').style.display = 'none';
              zone.classList.add('done');
              zone.querySelector('.upload-text').textContent = '✅ ' + file.name;
              zone.style.opacity = '1';
            }, 300);
          } catch(err) {
            alert('Fehler beim Lesen: ' + err.message);
            zone.style.opacity = '1';
            document.getElementById('progress-wrap').style.display = 'none';
          }
        }, 50);
      };
      reader.readAsText(file);
    }

    // ── Known noise patterns to filter from performance metrics ──
    const TELEMETRY_DOMAINS = [
      'events.data.microsoft.com', 'browser.events.data.microsoft.com',
      'eu-office.events.data.microsoft.com', 'self.events.data.microsoft.com',
      'watson.telemetry.microsoft.com', 'vortex.data.microsoft.com',
    ];
    const LONGPOLL_PATTERNS = [
      'substrate.office.com/todob2/api/v1/realtime',
      '/realtime', '/longpoll', '/comet', '/push',
    ];

    function isTelemetry(url) {
      return TELEMETRY_DOMAINS.some(d => url.includes(d));
    }
    function isLongPoll(url, dur, status) {
      // WebSocket upgrades or long-running connections are not real slow requests
      if (status === 101) return true;
      return LONGPOLL_PATTERNS.some(p => url.includes(p)) && dur > 10000;
    }
    function isNoise(url, dur, status) {
      return isTelemetry(url) || isLongPoll(url, dur, status);
    }

    function analyze(har, filename) {
      const entries = har.log?.entries || [];
      let errors = [], authReqs = [], cookies = new Map();
      let first401Time = null;

      allHarRows = [];

      entries.forEach(en => {
        const url    = en.request?.url || '';
        const status = en.response?.status || 0;
        const time   = en.startedDateTime || '';
        const dur    = Math.round(en.time || 0);
        const size   = en.response?.content?.size || 0;
        const noise  = isNoise(url, dur, status);

        (en.response?.cookies || []).forEach(c => {
          cookies.set(c.name, { domain: c.domain || fmtUrl(url).split('/')[0], expires: c.expires || 'Session', secure: !!c.secure });
        });

        allHarRows.push({ url, status, method: en.request?.method || '', time, dur, size, noise });

        // Only count real errors – not telemetry noise
        if (!noise && (status === 401 || status === 403 || status >= 500 || status === 0)) {
          errors.push({ url, status, time, dur });
          if (status === 401 && !first401Time) first401Time = time;
        }
        if (isAuth(url)) authReqs.push({ url, status, time, dur });
      });

      // Stats – exclude noise from meaningful metrics
      const realRows    = allHarRows.filter(r => !r.noise);
      const telemetryN  = allHarRows.filter(r => isTelemetry(r.url)).length;
      const longPollN   = allHarRows.filter(r => isLongPoll(r.url, r.dur, r.status)).length;
      const total       = entries.length;
      const err401      = errors.filter(e => e.status === 401).length;
      const err4xx      = errors.filter(e => e.status >= 400 && e.status < 500).length;
      const err5xx      = errors.filter(e => e.status >= 500).length;
      const netErr      = errors.filter(e => e.status === 0).length;
      // Slow = real requests > 3s, excluding longpoll/websocket
      const slowReqs    = realRows.filter(r => r.dur > 3000 && r.status !== 101).length;
      const telemetryPct = Math.round(telemetryN / total * 100);

      const grid = document.getElementById('stats-grid');
      grid.replaceChildren();
      [
        ['📊 Requests gesamt', total, ''],
        ['📡 Telemetrie', `${telemetryN} (${telemetryPct}%)`, telemetryPct > 30 ? 'warn' : ''],
        ['🔑 Auth-Requests', authReqs.length, authReqs.length > 0 ? 'good' : ''],
        ['🔴 401 Errors', err401, err401 > 0 ? 'bad' : 'good'],
        ['🟠 4xx Fehler', err4xx, err4xx > 0 ? 'warn' : 'good'],
        ['🔴 5xx Fehler', err5xx, err5xx > 0 ? 'bad' : 'good'],
        ['🌐 Netzwerkfehler', netErr, netErr > 0 ? 'warn' : ''],
        ['🐢 Langsam >3s', slowReqs, slowReqs > 0 ? 'warn' : ''],
      ].forEach(([label, value, cls]) => {
        const item = document.createElement('div');
        item.className = 'sys-item' + (cls === 'bad' ? ' item-bad' : cls === 'warn' ? ' item-warn' : cls === 'good' ? ' item-good' : '');
        const lbl = document.createElement('div'); lbl.className = 'sys-label'; lbl.textContent = label;
        const val = document.createElement('div'); val.className = 'sys-value' + (cls ? ' ' + cls : ''); val.textContent = value;
        item.appendChild(lbl); item.appendChild(val);
        grid.appendChild(item);
      });

      const findings = runHarRules(allHarRows, errors, authReqs, first401Time, cookies, telemetryPct);
      document.getElementById('findings-count').textContent = findings.length;
      renderHarFindings(findings);

      document.getElementById('auth-count').textContent = authReqs.length;
      renderSimpleTable('auth-table', authReqs);

      document.getElementById('errors-count').textContent = errors.length;
      document.getElementById('errors-section').style.display = errors.length ? '' : 'none';
      renderSimpleTable('error-table', errors);

      document.getElementById('all-count').textContent = allHarRows.length + ' Requests';
      renderAllTable(allHarRows);

      document.getElementById('results-section').style.display = '';
      setTimeout(() => document.getElementById('results-section').scrollIntoView({ behavior:'smooth', block:'start' }), 150);
    }

    function runHarRules(rows, errors, authReqs, first401Time, cookies, telemetryPct) {
      const results = [];
      const realRows = rows.filter(r => !r.noise);

      // Built-in rules
      const err401 = errors.filter(e => e.status === 401);
      const authAfter401 = authReqs.filter(r => first401Time && r.time > first401Time);

      if (err401.length > 0 && authAfter401.length === 0) {
        results.push({
          severity: 'critical', title: 'Kein Token-Refresh nach 401 erkannt',
          count: err401.length,
          desc: 'Nach dem ersten 401-Fehler wurde kein erneuter Auth-Request an login.microsoftonline.com gefunden. Der Refresh-Token ist möglicherweise abgelaufen oder MSAL kann nicht auf den Token-Cache zugreifen.',
          recs: [{ text:'Browser-Cache und Cookies vollständig leeren', type:'fix', risk:'low' }, { text:'Inkognito-Fenster testen', type:'diagnose', risk:'low' }, { text:'MSAL Token Cache prüfen', type:'diagnose', risk:'low' }]
        });
      }

      const failedAuth = authReqs.filter(r => r.status >= 400);
      if (failedAuth.length > 0) {
        results.push({
          severity: 'error', title: `${failedAuth.length} fehlgeschlagene Auth-Requests`,
          count: failedAuth.length,
          desc: 'Auth-Endpunkte antworten mit Fehlern. Deutet auf ungültige Tokens, falsche Tenant-Konfiguration oder gesperrte App-Registrierung hin.',
          recs: [{ text:'Benutzer abmelden und neu anmelden', type:'fix', risk:'low' }, { text:'App-Registrierung in Entra prüfen', type:'diagnose', risk:'low' }]
        });
      }

      // Auth loop detection
      if (err401.length >= 3 && failedAuth.length >= 3) {
        results.push({
          severity: 'critical', title: 'Authentifizierungs-Schleife erkannt',
          count: err401.length + failedAuth.length,
          desc: 'Mehrere 401-Fehler gefolgt von fehlgeschlagenen Token-Anfragen. Klassische Auth-Loop: Token wird angefordert, aber sofort abgelehnt.',
          recs: [{ text:'Browser-Cache vollständig leeren', type:'fix', risk:'low' }, { text:'Systemzeit prüfen', cmd:'w32tm /query /status', type:'diagnose', risk:'low' }]
        });
      }

      // Network errors
      const netErrors = errors.filter(e => e.status === 0);
      if (netErrors.length > 0) {
        results.push({
          severity: 'warning', title: `${netErrors.length} Netzwerkfehler (Status 0)`,
          count: netErrors.length,
          desc: 'Requests mit Status 0 deuten auf CORS-Fehler, abgebrochene Verbindungen oder Netzwerkunterbrechungen hin.',
          recs: [{ text:'CORS-Konfiguration der App prüfen', type:'diagnose', risk:'low' }, { text:'Netzwerkverbindung prüfen', type:'diagnose', risk:'low' }]
        });
      }

      // Slow auth
      const slowAuth = authReqs.filter(r => r.dur > 3000);
      if (slowAuth.length > 0) {
        results.push({
          severity: 'warning', title: 'Langsame Auth-Endpunkte',
          count: slowAuth.length,
          desc: `${slowAuth.length} Auth-Requests dauerten länger als 3 Sekunden. Kann zu Timeouts und trägen App-Starts führen.`,
          recs: [{ text:'Netzwerkverbindung zu login.microsoftonline.com testen', cmd:'Test-NetConnection login.microsoftonline.com -Port 443', type:'diagnose', risk:'low' }, { text:'Proxy/VPN prüfen', type:'diagnose', risk:'low' }]
        });
      }

      // Large payloads
      const largeReqs = rows.filter(r => r.size > 1048576);
      if (largeReqs.length >= 3) {
        results.push({
          severity: 'info', title: `${largeReqs.length} sehr große Anfragen (>1MB)`,
          count: largeReqs.length,
          desc: 'Mehrere Anfragen übertragen mehr als 1MB. Kann Performance-Probleme verursachen, besonders über VPN.',
          recs: [{ text:'Große Anfragen identifizieren', type:'diagnose', risk:'low' }]
        });
      }

      // Token gap
      if (authReqs.length >= 2) {
        for (let i = 1; i < authReqs.length; i++) {
          const diff = (new Date(authReqs[i].time) - new Date(authReqs[i-1].time)) / 60000;
          if (diff > 60) {
            results.push({
              severity: 'warning', title: 'Lange Lücke zwischen Auth-Requests',
              count: 1,
              desc: `${Math.round(diff)} Minuten ohne Token-Renewal. Access Tokens laufen nach 60-75 Min ab – fehlendes Silent-Renewal deutet auf ein MSAL-Problem hin.`,
              recs: [{ text:'MSAL Silent Token Renewal prüfen', type:'diagnose', risk:'low' }, { text:'Token Lifetime Policy prüfen', type:'diagnose', risk:'low' }]
            });
            break;
          }
        }
      }

      // ── JSON Rules from har-rules.json ───────────────────
      HAR_RULES.forEach(rule => {
        // urlPattern404: specific URL pattern returning 404
        if (rule.check === 'urlPattern404' && rule.urlPattern) {
          const re = new RegExp(rule.urlPattern, 'i');
          const matched = errors.filter(e => e.status === 404 && re.test(e.url));
          if (matched.length > 0) {
            results.push({
              severity: rule.severity, title: rule.name, count: matched.length,
              desc: rule.description, recs: rule.recommendations || []
            });
          }
        }

        // telemetryFlood
        if (rule.check === 'telemetryFlood' && telemetryPct > (rule.telemetryThreshold || 30)) {
          results.push({
            severity: rule.severity, title: rule.name + ` (${telemetryPct}%)`, count: 0,
            desc: rule.description, recs: rule.recommendations || []
          });
        }

        // substrateLongPoll
        if (rule.check === 'substrateLongPoll') {
          const n = rows.filter(r => r.url.includes('substrate.office.com') && r.dur > 10000).length;
          if (n >= (rule.minCount || 10)) {
            results.push({
              severity: rule.severity, title: rule.name + ` (${n}×)`, count: n,
              desc: rule.description, recs: rule.recommendations || []
            });
          }
        }

        // websocketLongDuration
        if (rule.check === 'websocketLongDuration') {
          const n = rows.filter(r => r.status === 101).length;
          if (n > 0) {
            results.push({
              severity: rule.severity, title: rule.name + ` (${n} Verbindung${n>1?'en':''})`, count: n,
              desc: rule.description, recs: rule.recommendations || []
            });
          }
        }
      });

      if (!results.length) {
        results.push({ severity:'info', title:'✅ Keine kritischen Probleme gefunden', count:0, desc:'Keine Auth-Fehler oder kritische Muster erkannt.', recs:[] });
      }

      const ord = { critical:0, error:1, warning:2, info:3 };
      return results.sort((a,b) => (ord[a.severity]||3)-(ord[b.severity]||3));
    }

    function renderHarFindings(findings) {
      const container = document.getElementById('findings');
      container.replaceChildren();
      findings.forEach(f => {
        const card = document.createElement('div');
        card.className = 'finding-card'; card.dataset.sev = f.severity;
        const header = document.createElement('div'); header.className = 'finding-header';
        const sevPill = document.createElement('span'); sevPill.className = 'sev-pill sev-'+f.severity; sevPill.textContent = f.severity;
        const title = document.createElement('span'); title.className = 'finding-title'; title.textContent = f.title;
        const expand = document.createElement('span'); expand.className = 'finding-expand'; expand.textContent = '▼';
        header.appendChild(sevPill); header.appendChild(title); header.appendChild(expand);
        header.addEventListener('click', () => { const body=header.nextElementSibling; expand.classList.toggle('open',body.classList.toggle('open')); });
        const body = document.createElement('div'); body.className = 'finding-body';
        if (f.severity === 'critical' || f.severity === 'error') { body.classList.add('open'); expand.classList.add('open'); }
        const desc = document.createElement('p'); desc.className = 'finding-desc'; desc.textContent = f.desc;
        body.appendChild(desc);
        if (f.recs?.length) {
          const recList = document.createElement('div'); recList.className = 'rec-list';
          f.recs.forEach(rec => {
            const item = document.createElement('div'); item.className = 'rec-item';
            const tr = document.createElement('div'); tr.className = 'rec-text-row';
            const arrow = document.createElement('span'); arrow.className = 'rec-arrow'; arrow.textContent = '→';
            const text = document.createElement('span'); text.className = 'rec-text'; text.textContent = rec.text;
            tr.appendChild(arrow); tr.appendChild(text); item.appendChild(tr);
            if (rec.cmd) {
              const cr = document.createElement('div'); cr.className = 'rec-cmd-row';
              const ce = document.createElement('code'); ce.className = 'rec-cmd'; ce.textContent = rec.cmd.length>80?rec.cmd.substring(0,80)+'…':rec.cmd; ce.title=rec.cmd;
              const cb = document.createElement('button'); cb.className='rec-copy-btn'; cb.textContent='📋 Kopieren';
              cb.addEventListener('click',()=>{navigator.clipboard?.writeText(rec.cmd).then(()=>{cb.textContent='✓ Kopiert';cb.classList.add('copied');setTimeout(()=>{cb.textContent='📋 Kopieren';cb.classList.remove('copied');},1500);});});
              cr.appendChild(ce); cr.appendChild(cb); item.appendChild(cr);
            }
            recList.appendChild(item);
          });
          body.appendChild(recList);
        }
        card.appendChild(header); card.appendChild(body);
        container.appendChild(card);
      });
    }

    function renderSimpleTable(tbodyId, rows) {
      const tbody = document.getElementById(tbodyId);
      const frag = document.createDocumentFragment();
      if (!rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td'); td.colSpan = 4; td.textContent = 'Keine Einträge'; td.style.cssText = 'text-align:center;color:var(--dim);padding:24px';
        tr.appendChild(td); frag.appendChild(tr);
      } else {
        rows.slice(0,200).forEach(r => {
          const tr = document.createElement('tr');
          [
            { text: fmtTime(r.time), mono:true },
            { html: `<span class="${statusCls(r.status)}">${r.status}</span>` },
            { text: fmtUrl(r.url), cls:'url-cell' },
            { text: r.dur + 'ms', mono:true },
          ].forEach(cell => {
            const td = document.createElement('td');
            if (cell.html) { td.innerHTML = cell.html; }
            else { td.textContent = cell.text; if (cell.mono) td.style.fontFamily='var(--font-mono)'; if (cell.cls) td.className=cell.cls; }
            tr.appendChild(td);
          });
          frag.appendChild(tr);
        });
      }
      tbody.replaceChildren(frag);
    }

    function renderAllTable(rows) {
      const tbody = document.getElementById('all-table');
      const frag = document.createDocumentFragment();
      rows.slice(0,1000).forEach(r => {
        const tr = document.createElement('tr');
        if (r.noise) tr.style.opacity = '0.45';
        [
          { text: fmtTime(r.time), mono:true },
          { html: `<span class="${statusCls(r.status)}">${r.status}</span>` },
          { text: r.method, mono:true },
          { text: fmtUrl(r.url), cls:'url-cell' },
          { text: (r.size/1024).toFixed(1)+'KB', mono:true },
          { text: r.dur+'ms', mono:true },
        ].forEach(cell => {
          const td = document.createElement('td');
          if (cell.html) { td.innerHTML = cell.html; }
          else { td.textContent = cell.text||''; if (cell.mono) td.style.fontFamily='var(--font-mono)'; if (cell.cls) td.className=cell.cls; }
          tr.appendChild(td);
        });
        frag.appendChild(tr);
      });
      tbody.replaceChildren(frag);
    }

    function filterAll() {
      const q = document.getElementById('search-input').value.toLowerCase();
      const filtered = q ? allHarRows.filter(r => r.url.toLowerCase().includes(q) || String(r.status).includes(q)) : allHarRows;
      document.getElementById('all-count').textContent = filtered.length + ' Requests';
      renderAllTable(filtered);
    }

    function toggleAllTable() {
      const wrap = document.getElementById('all-table-wrap');
      const icon = document.getElementById('all-table-icon');
      const hidden = wrap.style.display === 'none';
      wrap.style.display = hidden ? '' : 'none';
      icon.style.transform = hidden ? '' : 'rotate(-90deg)';
    }
    // ── Export Findings ───────────────────────────────────
    function exportHarFindings() {
      if (!allHarRows.length) return;
      const errors   = allHarRows.filter(r => r.status === 401 || r.status === 403 || r.status >= 500 || r.status === 0);
      const authReqs = allHarRows.filter(r => {
        const AUTH_P = ['login.microsoftonline.com','login.microsoft.com','oauth2','msal','token','auth','signin','authorize'];
        const u = r.url.toLowerCase();
        return AUTH_P.some(p => u.includes(p));
      });

      const findings = document.getElementById('findings');
      const findingTitles = findings ? [...findings.querySelectorAll('.finding-title')].map(el => el.textContent) : [];

      const payload = {
        exportedAt: new Date().toISOString(),
        summary: {
          totalRequests: allHarRows.length,
          authRequests:  authReqs.length,
          errors401:     allHarRows.filter(r => r.status === 401).length,
          errors4xx:     allHarRows.filter(r => r.status >= 400 && r.status < 500).length,
          errors5xx:     allHarRows.filter(r => r.status >= 500).length,
          networkErrors: allHarRows.filter(r => r.status === 0).length,
          slowRequests:  allHarRows.filter(r => r.dur > 3000).length,
        },
        findings: findingTitles,
        topErrors: errors.slice(0,20).map(r => ({
          time:   r.time,
          status: r.status,
          url:    r.url,
          dur:    r.dur + 'ms',
        })),
        topAuthRequests: authReqs.slice(0,20).map(r => ({
          time:   r.time,
          status: r.status,
          url:    r.url,
          dur:    r.dur + 'ms',
        })),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `har-findings-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('export-findings-btn')?.addEventListener('click', exportHarFindings);
    });
