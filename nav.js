// ============================================================
// AdminSheet – Shared Navigation v2
// ============================================================
(function() {
  const PAGES = [
    { id:'index',    href:'index.html',    label:'Windows',      icon:'⚡', color:'#7c8cf8', desc:'228 Befehle · 21 Kategorien' },
    { id:'exchange', href:'exchange.html', label:'Exchange',     icon:'📧', color:'#e8b339', desc:'On-Prem & Exchange Online' },
    { id:'forti',    href:'forti.html',    label:'Fortinet',     icon:'🔥', color:'#fb7124', desc:'FG · FMG · FAZ' },
    { id:'scripts',  href:'scripts.html',  label:'PS Scripts',   icon:'💚', color:'#4ade80', desc:'Fertige .ps1 Skripte' },
    {
      id:'analyzer', label:'Analyzer', icon:'📋', color:'#e8b339', group:true,
      children: [
        { id:'eventlog', href:'eventlog.html', label:'Log Analyzer',   icon:'📋', color:'#e8b339', desc:'Windows Event Logs analysieren' },
        { id:'entra',    href:'entra.html',    label:'Entra Analyzer', icon:'🔐', color:'#7c8cf8', desc:'Sign-In Logs analysieren' },
        { id:'har',      href:'har.html',      label:'HAR Analyzer',   icon:'🌐', color:'#60a5fa', desc:'Browser Sessions analysieren' },
      ]
    },
    { id:'mitmachen',href:'mitmachen.html',label:'Mitmachen',    icon:'🤝', color:'#a78bfa', desc:'Ideen & Befehle einreichen' },
    { id:'tools',     href:'tools.html',     label:'support.tools', icon:'⚙️',  color:'#94a3b8', desc:'App installieren · Offline · Einstellungen', tools:true },
  ];

  const currentFile = location.pathname.split('/').pop() || 'index.html';

  // Flache Liste aller Seiten (inkl. Kinder aus Gruppen)
  const ALL_PAGES = PAGES.flatMap(p => p.group ? p.children : [p]);
  const currentPage = ALL_PAGES.find(p => p.href === currentFile) || ALL_PAGES[0];
  const currentId   = currentPage.id;

  // Gruppen-ID für Tab-Highlighting
  const currentGroupId = (() => {
    for (const p of PAGES) {
      if (p.group && p.children.some(c => c.id === currentId)) return p.id;
    }
    return currentId;
  })();

  // Body-Klasse für seitenspezifisches Styling (z.B. H1-Farbe)
  document.body.classList.add(`page-${currentId}`);

  // ── CSS ───────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    /* Logo dropdown */
    .as-logo-wrap { position:relative; display:flex; align-items:center; gap:10px; cursor:pointer; user-select:none; text-decoration:none; flex-shrink:0; }
    .as-logo-wrap .logo-icon { border-color:${currentPage.color}4d !important; background:${currentPage.color}1a !important; transition:border-color .15s; }
    .as-logo-wrap:hover .logo-icon { border-color:${currentPage.color}99 !important; }
    .as-logo-text span { color:${currentPage.color} !important; }
    .as-chevron { font-size:10px; color:var(--dim,#555a70); margin-left:2px; transition:transform .2s; flex-shrink:0; }
    .as-logo-wrap.open .as-chevron { transform:rotate(180deg); }

    .as-dropdown {
      display:none; position:absolute; top:calc(100% + 10px); left:0; z-index:500;
      background:#1a1d2e; border:1px solid #343860; border-radius:14px;
      padding:8px; min-width:240px; box-shadow:0 16px 48px rgba(0,0,0,.6);
    }
    .as-logo-wrap.open .as-dropdown { display:block; animation:asDropIn .15s ease; }
    @keyframes asDropIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }

    .as-dd-item { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:9px; text-decoration:none; color:#8890aa; transition:all .12s; }
    .as-dd-item:hover { background:rgba(255,255,255,.05); color:#e0e4f0; }
    .as-dd-item.active .as-dd-label { font-weight:700; }
    .as-dd-icon { width:30px; height:30px; border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:15px; flex-shrink:0; }
    .as-dd-info { display:flex; flex-direction:column; gap:1px; }
    .as-dd-label { font-size:.84rem; line-height:1; color:#e0e4f0; }
    .as-dd-desc  { font-size:.7rem; color:#555a70; }
    .as-dd-dot   { width:6px; height:6px; border-radius:50%; margin-left:auto; flex-shrink:0; }
    .as-dd-div   { height:1px; background:#2a2d3e; margin:6px 4px; }

    /* Tab bar */
    .as-tab-bar {
      position:sticky; top:58px; z-index:99;
      background:rgba(15,17,23,.95); backdrop-filter:blur(12px);
      border-bottom:1px solid #2a2d3e;
      padding:0 24px; display:flex; align-items:center; gap:2px;
      overflow:visible;
      scrollbar-width:none;
    }
    .as-tab-bar::-webkit-scrollbar { display:none; }
    .as-tab {
      display:flex; align-items:center; gap:6px;
      padding:10px 14px; font-family:inherit; font-size:.8rem; font-weight:600;
      color:#8890aa; border:none; background:none; cursor:pointer;
      text-decoration:none; border-bottom:2px solid transparent;
      margin-bottom:-1px; white-space:nowrap; transition:color .15s, border-color .15s;
    }
    .as-tab:hover { color:#e0e4f0; }
    .as-tab.active { color:var(--as-tab-color,#7c8cf8); border-bottom-color:var(--as-tab-color,#7c8cf8); }
    .as-tab-icon { font-size:14px; }
    .as-tab--tools { color:var(--dim,#555a70); font-size:.72rem; }
    .as-tab--tools.active { color:#94a3b8; border-bottom-color:#94a3b8; }
    .as-tab--tools:hover  { color:var(--text,#e0e4f0); }

    /* Update bar */
    .as-update-bar {
      position:fixed; top:0; left:0; right:0; z-index:1000;
      background:#1a1d2e; border-bottom:1px solid rgba(74,222,128,.3);
      padding:10px 20px; display:flex; align-items:center; justify-content:center; gap:12px;
      transform:translateY(-100%); transition:transform .3s ease; font-size:.82rem;
    }
    .as-update-bar.show { transform:translateY(0); }
    body.has-update header { top:42px; }
    body.has-update .as-tab-bar { top:100px; }
    .as-update-btn {
      display:flex; align-items:center; gap:6px; padding:6px 16px; border-radius:8px;
      background:rgba(74,222,128,.12); border:1px solid rgba(74,222,128,.35);
      color:#4ade80; font-family:inherit; font-size:.8rem; font-weight:600;
      cursor:pointer; transition:all .15s;
    }
    .as-update-btn:hover { background:rgba(74,222,128,.22); }
    .as-update-dismiss { background:none; border:none; color:#555a70; font-size:16px; cursor:pointer; padding:0 4px; }
    .as-update-dismiss:hover { color:#8890aa; }

    /* Update check button */
    /* Gruppen-Tab */
    .as-tab-group { position:relative; display:inline-flex; }
    .as-tab--group { cursor:pointer; border:none; background:none; font-family:var(--font-ui,inherit); display:flex; align-items:center; gap:5px; padding:0; }
    .as-group-chevron { font-size:.6rem; color:var(--dim,#555a70); transition:transform .2s; margin-left:2px; }
    .as-tab-group.open .as-group-chevron { transform:rotate(180deg); }
    .as-subtab-menu {
      display:none; position:absolute; top:calc(100% + 8px); left:0;
      z-index:600; background:#1a1d2e; border:1px solid #343860; border-radius:10px;
      padding:6px; min-width:190px; box-shadow:0 16px 40px rgba(0,0,0,.6);
    }
    .as-tab-group.open .as-subtab-menu { display:block; }
    .as-subtab { display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:7px; text-decoration:none; color:#8890aa; font-size:.82rem; font-weight:600; transition:all .12s; white-space:nowrap; }
    .as-subtab:hover { background:rgba(255,255,255,.05); color:#e0e4f0; }
    .as-subtab.active { color:var(--as-tab-color,#7c8cf8); background:color-mix(in srgb, var(--as-tab-color,#7c8cf8) 12%, transparent); }
    .as-dd-group-label { font-size:.65rem; font-weight:700; color:#555a70; text-transform:uppercase; letter-spacing:.08em; padding:8px 12px 4px; }
    .as-dd-item--child { padding-left:20px; }

    .as-refresh-btn {
      display:flex; align-items:center; justify-content:center;
      width:32px; height:32px; border-radius:8px; flex-shrink:0;
      border:1px solid #2a2d3e; background:#1a1d2e;
      color:#555a70; font-size:16px; cursor:pointer; transition:all .15s;
      line-height:1;
    }
    .as-refresh-btn:hover { color:#e0e4f0; border-color:#343860; }
    .as-refresh-btn.checking { animation:as-spin .8s linear infinite; color:#fbbf24; border-color:rgba(251,191,36,.4); }
    .as-refresh-btn.updated  { color:#4ade80; border-color:rgba(74,222,128,.4); }
    @keyframes as-spin { to { transform:rotate(360deg); } }

    /* Scroll to top */
    .as-scroll-top {
      position:fixed; bottom:32px; right:calc((100vw - 1200px) / 4); z-index:400;
      width:64px; height:64px; border-radius:14px;
      background:#21253a; border:1px solid #343860;
      color:#8890aa; font-size:26px; cursor:pointer; line-height:1; padding-bottom:3px;
      display:flex; align-items:center; justify-content:center;
      opacity:0; transform:translateY(12px);
      transition:opacity .25s, transform .25s, background .15s, color .15s, border-color .15s;
      pointer-events:none;
    }
    .as-scroll-top.visible { opacity:1; transform:translateY(0); pointer-events:all; }
    .as-scroll-top:hover { background:#1a1d2e; color:#e0e4f0; border-color:${currentPage.color}; }
  `;
  document.head.appendChild(style);

  // ── Logo Icon + Label dynamisch setzen ───────────────────
  const logoIconEl  = document.getElementById('as-logo-icon');
  const logoLabelEl = document.getElementById('as-logo-label');
  if (logoIconEl)  logoIconEl.textContent = currentPage.icon;
  if (logoLabelEl) {
    // "support" bleibt, nur der farbige Span ändert sich
    const suffix = currentPage.id === 'index' ? '.sheet'
                 : currentPage.id === 'exchange' ? '.exchange'
                 : currentPage.id === 'forti' ? '.forti'
                 : currentPage.id === 'scripts' ? '.scripts'
                 : currentPage.id === 'eventlog' ? '.analyzer'
                 : currentPage.id === 'entra' ? '.entra'
                 : currentPage.id === 'har' ? '.har'
                 : currentPage.id === 'mitmachen' ? '.mitmachen'
                 : '.tools';
    logoLabelEl.textContent = 'support';
    const span = document.createElement('span');
    span.textContent = suffix;
    logoLabelEl.appendChild(span);
  }

  // ── LOGO DROPDOWN ─────────────────────────────────────────
  // Find logo element – works for all pages
  const logoEl = document.querySelector('.logo, .as-logo-wrap');
  if (logoEl && !logoEl.classList.contains('as-logo-wrap')) {
    logoEl.classList.add('as-logo-wrap');

    // Add chevron
    const chev = document.createElement('span');
    chev.className = 'as-chevron';
    chev.textContent = '▾';
    logoEl.appendChild(chev);

    // Build dropdown
    const dd = document.createElement('div');
    dd.className = 'as-dropdown';
    PAGES.forEach((p, i) => {
      // Divider before last item
      if (p.id === 'mitmachen') {
        const div = document.createElement('div');
        div.className = 'as-dd-div';
        dd.appendChild(div);
      }

      if (p.group) {
        // Group header
        const groupLabel = document.createElement('div');
        groupLabel.className = 'as-dd-group-label';
        groupLabel.textContent = p.icon + ' ' + p.label;
        dd.appendChild(groupLabel);

        // Children
        p.children.forEach(child => {
          const a = document.createElement('a');
          a.className = 'as-dd-item as-dd-item--child' + (child.id === currentId ? ' active' : '');
          a.href = child.href;
          a.innerHTML = `
            <div class="as-dd-icon" style="background:${child.color}1a">${child.icon}</div>
            <div class="as-dd-info">
              <span class="as-dd-label" style="color:${child.id === currentId ? child.color : ''}">${child.label}</span>
              <span class="as-dd-desc">${child.desc}</span>
            </div>
            ${child.id === currentId ? `<div class="as-dd-dot" style="background:${child.color}"></div>` : ''}
          `;
          dd.appendChild(a);
        });
        return;
      }

      const a = document.createElement('a');
      a.className = 'as-dd-item' + (p.id === currentId ? ' active' : '');
      a.href = p.href;
      a.innerHTML = `
        <div class="as-dd-icon" style="background:${p.color}1a">${p.icon}</div>
        <div class="as-dd-info">
          <span class="as-dd-label" style="color:${p.id === currentId ? p.color : ''}">${p.label}</span>
          <span class="as-dd-desc">${p.desc}</span>
        </div>
        ${p.id === currentId ? `<div class="as-dd-dot" style="background:${p.color}"></div>` : ''}
      `;
      dd.appendChild(a);
    });
    logoEl.appendChild(dd);

    // Dynamische Befehlszähler aus JSON nachladen
    const COUNT_SOURCES = [
      { id: 'index',    url: './data/commands.json',          label: (n, c) => `${n} Befehle · ${c} Kategorien` },
      { id: 'exchange', url: './data/exchange-commands.json', label: (n)    => `${n} Befehle · On-Prem & EXO` },
      { id: 'forti',    url: './data/forti-commands.json',    label: (n)    => `${n} Befehle · FG · FMG · FAZ` },
    ];

    COUNT_SOURCES.forEach(({ id, url, label }) => {
      fetch(url)
        .then(r => r.json())
        .then(data => {
          const cmds = Array.isArray(data) ? data : (data.commands || []);
          const n    = cmds.length;
          const cats = new Set(cmds.map(c => c.tags?.[0]).filter(Boolean)).size;
          // Desc-Text im Dropdown aktualisieren
          const descEl = dd.querySelector(`.as-dd-item[href="${id === 'index' ? 'index.html' : id + '.html'}"] .as-dd-desc`);
          if (descEl) descEl.textContent = label(n, cats);
        })
        .catch(() => {}); // Fehler still ignorieren – hardcoded Fallback bleibt
    });

    // Toggle dropdown on logo click (not on child links)
    logoEl.addEventListener('click', e => {
      if (e.target.closest('a.as-dd-item')) return;
      e.preventDefault();
      logoEl.classList.toggle('open');
    });
    document.addEventListener('click', e => {
      if (!logoEl.contains(e.target)) logoEl.classList.remove('open');
    });
  }

  // ── TAB BAR ───────────────────────────────────────────────
  const header = document.querySelector('header');
  if (header && !document.querySelector('.as-tab-bar')) {
    const tabBar = document.createElement('nav');
    tabBar.className = 'as-tab-bar';
    tabBar.setAttribute('aria-label', 'Seitennavigation');

    PAGES.forEach(p => {
      if (p.tools) {
        const spacer = document.createElement('div');
        spacer.style.cssText = 'flex:1';
        tabBar.appendChild(spacer);
      }

      if (p.group) {
        // Gruppen-Tab mit Dropdown
        const isActiveGroup = p.children.some(c => c.id === currentId);
        const activeChild   = p.children.find(c => c.id === currentId);
        const groupColor    = activeChild ? activeChild.color : p.color;

        const wrap = document.createElement('div');
        wrap.className = 'as-tab-group' + (isActiveGroup ? ' active' : '');
        wrap.style.setProperty('--as-tab-color', groupColor);

        const groupTab = document.createElement('button');
        groupTab.className = 'as-tab as-tab--group' + (isActiveGroup ? ' active' : '');
        groupTab.style.setProperty('--as-tab-color', groupColor);
        groupTab.innerHTML = `<span class="as-tab-icon">${activeChild ? activeChild.icon : p.icon}</span>${activeChild ? activeChild.label : p.label} <span class="as-group-chevron">▾</span>`;

        const subMenu = document.createElement('div');
        subMenu.className = 'as-subtab-menu';

        p.children.forEach(child => {
          const sub = document.createElement('a');
          sub.className = 'as-subtab' + (child.id === currentId ? ' active' : '');
          sub.href = child.href;
          sub.style.setProperty('--as-tab-color', child.color);
          sub.innerHTML = `<span class="as-tab-icon">${child.icon}</span>${child.label}`;
          subMenu.appendChild(sub);
        });

        wrap.appendChild(groupTab);
        wrap.appendChild(subMenu);

        // Toggle subtab menu
        groupTab.addEventListener('click', e => {
          e.stopPropagation();
          const isOpen = wrap.classList.toggle('open');
          document.querySelectorAll('.as-tab-group').forEach(g => { if (g !== wrap) g.classList.remove('open'); });
        });
        document.addEventListener('click', e => {
          if (!wrap.contains(e.target)) wrap.classList.remove('open');
        });

        tabBar.appendChild(wrap);
        return;
      }

      const a = document.createElement('a');
      a.className = 'as-tab' + (p.id === currentId ? ' active' : '') + (p.tools ? ' as-tab--tools' : '');
      a.href = p.href;
      a.style.setProperty('--as-tab-color', p.color);
      a.innerHTML = `<span class="as-tab-icon">${p.icon}</span>${p.label}`;
      tabBar.appendChild(a);
    });

    header.insertAdjacentElement('afterend', tabBar);

    const hero = document.querySelector('.hero');
    if (hero) {
      const pt = parseInt(window.getComputedStyle(hero).paddingTop);
      if (pt > 20) hero.style.paddingTop = (pt - 20) + 'px';
    }
  }

  // ── CLEAN OLD NAV LINKS ───────────────────────────────────
  // Remove individual page links from header-right (tabs replace them)
  // But do NOT remove the logo or pill/counter
  const headerRight = document.querySelector('.header-right');
  if (headerRight) {
    headerRight.querySelectorAll('a.nav-link, a[class="nav-link"]').forEach(a => a.remove());
    headerRight.querySelectorAll('.nav-sep').forEach(s => s.remove());
  }

  // ── REFRESH / UPDATE CHECK BUTTON ────────────────────────
  if (headerRight && 'serviceWorker' in navigator) {
    const btn = document.createElement('button');
    btn.className = 'as-refresh-btn';
    btn.title = 'Auf Updates prüfen';
    btn.innerHTML = '↻';
    // Insert BEFORE first child (pill)
    headerRight.insertBefore(btn, headerRight.firstChild);

    btn.addEventListener('click', () => checkUpdate(true));
    setTimeout(() => checkUpdate(false), 2500);
  }

  // ── PROFIL-STATUS ─────────────────────────────────────────
  if (headerRight) {
    const profileLink = document.createElement('a');
    profileLink.href      = 'tools.html';
    profileLink.className = 'as-profile-status';
    profileLink.title     = 'Einstellungen / support.tools';

    const dot = document.createElement('span');
    dot.className = 'as-profile-dot';

    const label = document.createElement('span');
    label.id = 'as-profile-label';

    profileLink.appendChild(dot);
    profileLink.appendChild(label);
    // Insert BEFORE refresh btn (→ leftmost in header-right)
    headerRight.insertBefore(profileLink, headerRight.firstChild);

    // Initaler Status + globale Update-Funktion
    window.updateProfileStatus = function() {
      try {
        const raw = localStorage.getItem('supportsheet_settings');
        const hasProfile = raw && (() => {
          const s = JSON.parse(raw);
          return !!(s.defaultDomain || s.defaultServer || s.defaultUsername || s.preferredTags?.length);
        })();
        profileLink.classList.toggle('saved', !!hasProfile);
        label.textContent = hasProfile ? 'Profil gespeichert' : 'Profil nicht gespeichert';
      } catch {
        label.textContent = 'Profil nicht gespeichert';
      }
    };
    window.updateProfileStatus();
  }

  async function checkUpdate(manual) {
    const btn = document.querySelector('.as-refresh-btn');
    if (!btn || !navigator.serviceWorker.controller) return;
    btn.classList.add('checking');
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
      await new Promise(r => setTimeout(r, 1500));
      btn.classList.remove('checking');
      if (reg.waiting) {
        btn.classList.add('updated');
        btn.innerHTML = '↻';
        btn.title = 'Update verfügbar – klicken zum Installieren';
        document.querySelector('.as-update-bar')?.classList.add('show');
        btn.onclick = () => { reg.waiting.postMessage({ type:'SKIP_WAITING' }); };
      } else {
        if (manual) {
          btn.classList.add('updated');
          btn.innerHTML = '✓';
          btn.title = 'Aktuell';
          setTimeout(() => { btn.classList.remove('updated'); btn.innerHTML = '↻'; btn.title = 'Auf Updates prüfen'; }, 2500);
        }
      }
    } catch {
      btn.classList.remove('checking');
    }
  }

  // ── CTRL+K SEARCH ─────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const s = document.getElementById('search-input');
      if (s) { s.focus(); s.select(); }
    }
    // Escape only if search-input is focused
    if (e.key === 'Escape') {
      const s = document.getElementById('search-input');
      if (s && document.activeElement === s) {
        s.value = '';
        s.dispatchEvent(new Event('input')); // triggers runSearch('')
        s.blur();
      }
    }
  });

  // Ctrl+K shortcut chip is in HTML (.search-shortcut) – no extra injection needed

  // ── UPDATE BANNER ─────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    const bar = document.createElement('div');
    bar.className = 'as-update-bar';
    bar.innerHTML = `
      <span style="color:#e0e4f0">⚡ <strong style="color:#4ade80">Neue Version verfügbar!</strong></span>
      <button class="as-update-btn" onclick="window.location.reload()">🔄 Jetzt aktualisieren</button>
      <button class="as-update-dismiss" onclick="this.closest('.as-update-bar').classList.remove('show');document.body.classList.remove('has-update')">✕</button>
    `;
    document.body.prepend(bar);

    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SW_UPDATED') {
        bar.classList.add('show');
        document.body.classList.add('has-update');
      }
    });

    navigator.serviceWorker.ready.then(reg => {
      if (reg.waiting) {
        bar.classList.add('show');
        document.body.classList.add('has-update');
        bar.querySelector('.as-update-btn').addEventListener('click', () => {
          reg.waiting.postMessage({ type:'SKIP_WAITING' });
        }, { once:true });
      }
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            bar.classList.add('show');
            document.body.classList.add('has-update');
          }
        });
      });
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) { refreshing = true; window.location.reload(); }
    });
  }

  // ── SCROLL TO TOP ─────────────────────────────────────────
  const scrollBtn = document.createElement('button');
  scrollBtn.className = 'as-scroll-top';
  scrollBtn.setAttribute('aria-label', 'Nach oben');
  scrollBtn.innerHTML = '↑';
  scrollBtn.addEventListener('click', () => window.scrollTo({ top:0, behavior:'smooth' }));
  document.body.appendChild(scrollBtn);
  window.addEventListener('scroll', () => {
    scrollBtn.classList.toggle('visible', window.scrollY > 300);
  }, { passive:true });

})();
