(function () {
  'use strict';

  function backendLog(message) {
    try {
      if (typeof Millennium !== 'undefined' && typeof Millennium.callServerMethod === 'function') {
        Millennium.callServerMethod('ispa', 'Logger.log', { message: String(message) });
      }
    } catch (err) { if (console && console.warn) console.warn('[ispa] backendLog başarısız', err); }
  }

  async function callServer(method, params = {}) {
    try {
      if (typeof Millennium === 'undefined' || typeof Millennium.callServerMethod !== 'function') {
        return { success: false, error: 'Sunucu bağlantısı mevcut değil' };
      }
      const raw = await Millennium.callServerMethod('ispa', method, params);
      if (raw === null || raw === undefined) return { success: false, error: 'Boş yanıt' };
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch (e) { return { success: false, error: String(raw) }; }
      }
      if (typeof raw === 'object') return raw;
      return { success: false, error: String(raw) };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  class AppState {
    constructor() {
      this.logs = { missingOnce: false, existsOnce: false };
      this.run = { inProgress: false, appid: null };
      this.cache = new Map();
    }
    setRunState(inProgress, appid = null) { this.run = { inProgress, appid }; }
    cacheResult(key, value, ttl = 30000) { this.cache.set(key, { value, expires: Date.now() + ttl }); }
    getCached(key) { const c = this.cache.get(key); if (c && Date.now() < c.expires) return c.value; this.cache.delete(key); return null; }
  }

  const state = new AppState();

  function ensureStyles() {
    if (!document.getElementById('ispa-styles')) {
      const style = document.createElement('style');
      style.id = 'ispa-styles';
      style.textContent = `
        :root {
          --steam-bg-modal: linear-gradient(135deg, #23262E 0%, #191B20 100%);
          --steam-bg-header: linear-gradient(135deg, #2D3139 0%, #1E2024 100%);
          --steam-bg-progress: linear-gradient(135deg, #3D4450 0%, #2A2D35 100%);
          --steam-btn-primary: linear-gradient(135deg, #1976D2 0%, #1565C0 100%);
          --steam-btn-primary-hover: linear-gradient(135deg, #1E88E5 0%, #1976D2 100%);
          --steam-btn-primary-active: linear-gradient(135deg, #1565C0 0%, #0D47A1 100%);
          --steam-btn-secondary: linear-gradient(135deg, #1e2329 0%, #1a1e22 100%);
          --steam-btn-secondary-hover: linear-gradient(135deg, #3c4043 0%, #2a2d31 100%);
          --steam-border: #3D4450; --steam-border-btn: #1976D2; --steam-border-light: #495a6b;
          --steam-text-primary: #C6D4DF; --steam-text-secondary: #8F98A0; --steam-text-muted: #b8bcbf;
          --steam-font: "Motiva Sans", Arial, sans-serif; --steam-shadow: 0 0 20px rgba(0,0,0,.8);
          --steam-shadow-btn: 0 2px 4px rgba(0,0,0,.3); --steam-shadow-hover: 0 4px 8px rgba(0,0,0,.4);
        }
        .ispa-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.85); backdrop-filter: blur(2px); z-index: 99999; display:flex; align-items:center; justify-content:center; animation: fadeIn .3s ease-out; }
        .ispa-modal { background: var(--steam-bg-modal); border:1px solid var(--steam-border); box-shadow: var(--steam-shadow); font-family: var(--steam-font); animation: modalSlideIn .4s ease-out; width:min(90vw,500px); max-width:600px; max-height:80vh; overflow-y:auto; position:relative; }
        .ispa-header { background: var(--steam-bg-header); border-bottom:1px solid var(--steam-border); padding:12px 16px; display:flex; align-items:center; justify-content:space-between; }
        .ispa-title { color: var(--steam-text-primary); font-size:14px; font-weight:normal; }
        .ispa-close { color: var(--steam-text-secondary); cursor:pointer; font-size:16px; padding:4px; user-select:none; transition: color .2s; }
        .ispa-close:hover { color:#fff; }
        .ispa-content { padding:16px 20px 20px 20px; }
        .ispa-status { font-size:13px; line-height:1.4; margin-bottom:12px; color:var(--steam-text-primary); min-height:18px; }
        .ispa-progress { background: var(--steam-bg-progress); border:1px solid #4A5462; height:16px; border-radius:4px; overflow:hidden; margin-bottom:12px; position:relative; display:none; }
        .ispa-progress-bar { height:100%; width:0%; background: var(--steam-btn-primary); transition: width .3s; position:relative; overflow:hidden; }
        .ispa-progress-bar::after { content:''; position:absolute; inset:0; background: linear-gradient(45deg, transparent 25%, rgba(255,255,255,.1) 25%, rgba(255,255,255,.1) 50%, transparent 50%, transparent 75%, rgba(255,255,255,.1) 75%); background-size: 20px 20px; animation: progressStripes 1s linear infinite; }
        .ispa-percent { display:none; font-size:12px; color:var(--steam-text-muted); }
        .ispa-btn { border-radius:3px; cursor:pointer; font-size:12px; font-family:var(--steam-font); font-weight:500; padding:8px 16px; transition: all .2s; text-align:center; outline:none; display:inline-block; margin:4px; text-decoration:none; min-width:80px; }
        .ispa-btn-primary { background: var(--steam-btn-primary); border:1px solid var(--steam-border-btn); color:#fff; box-shadow: var(--steam-shadow-btn); }
        .ispa-btn-primary:hover { background: var(--steam-btn-primary-hover); transform: translateY(-1px); box-shadow: var(--steam-shadow-hover); }
        .ispa-btn-secondary { background: var(--steam-btn-secondary); border:1px solid var(--steam-border); color:var(--steam-text-secondary); box-shadow: var(--steam-shadow-btn); }
        .ispa-endpoints { margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; }
        .ispa-error-box { background: rgba(160,30,30,0.12); border:1px solid rgba(160,30,30,0.35); color:#d9534f; padding:8px 10px; border-radius:6px; margin-top:8px; font-size:13px; }
        @keyframes progressStripes { 0% { background-position: 0 0; } 100% { background-position: 20px 0; } }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes modalSlideIn { from { opacity:0; transform: scale(.9) translateY(-20px); } to { opacity:1; transform: scale(1) translateY(0); } }
        .ispa-button-container { }
        #ispa-in-library-banner { }
      `;
      document.head.appendChild(style);
    }
  }

  function createModal(opts = {}) {
    const overlay = document.createElement('div');
    overlay.className = `ispa-overlay ${opts.overlayClass || ''}`;

    const modal = document.createElement('div');
    modal.className = 'ispa-modal';
    modal.style.width = opts.width || '400px';

    const header = document.createElement('div');
    header.className = 'ispa-header';

    const title = document.createElement('div');
    title.className = 'ispa-title';
    title.textContent = opts.title || 'ispa';

    const closeBtn = document.createElement('div');
    closeBtn.className = 'ispa-close'; closeBtn.innerHTML = '×';
    closeBtn.onclick = () => overlay.remove();

    const content = document.createElement('div');
    content.className = 'ispa-content';

    header.append(title, closeBtn); modal.append(header, content); overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    return { overlay, modal, header, title, closeBtn, content };
  }

  function createButton(text, className = 'ispa-btn-primary', onClick = null) {
    const btn = document.createElement('button');
    btn.className = `ispa-btn ${className}`;
    btn.textContent = text;
    if (onClick) btn.onclick = onClick;
    return btn;
  }

  function createProgressBar() {
    const wrap = document.createElement('div'); wrap.className = 'ispa-progress';
    const bar = document.createElement('div'); bar.className = 'ispa-progress-bar'; wrap.appendChild(bar);
    const percent = document.createElement('div'); percent.className = 'ispa-percent'; percent.textContent = '0%';
    return { wrap, bar, percent };
  }

  class Api {
    static async call(method, params = {}) {
      return await callServer(method, params);
    }
    static async hasLua(appId) {
      const key = `appExists_${appId}`; const cached = state.getCached(key);
      if (cached !== null) return cached;
      try {
        const r = await this.call('hasLuaForApp', { appid: appId });
        const exists = r.success && r.exists; state.cacheResult(key, exists, 120000);
        return exists;
      } catch {
        return false;
      }
    }
  }

  function setSteamTooltip(el, text) {
    el.setAttribute('data-tooltip-text', text); el.title = text; el.setAttribute('data-panel-tooltip', text);
  }

  function createInLibraryBanner(gameName) {
    const banner = document.createElement('div');
    banner.className = 'game_area_already_owned page_content';
    banner.id = 'ispa-in-library-banner';
    const ctn = document.createElement('div'); ctn.className = 'game_area_already_owned_ctn';
    const flag = document.createElement('div'); flag.className = 'ds_owned_flag ds_flag'; flag.innerHTML = 'KÜTÜPHANEDE&nbsp;&nbsp;';
    const msg = document.createElement('div'); msg.className = 'already_in_library'; msg.textContent = `${gameName} zaten Steam kütüphanenizde`;
    ctn.append(flag, msg); banner.appendChild(ctn); return banner;
  }
  function addInLibraryFlag(section) {
    if (section && !section.querySelector('.package_in_library_flag')) {
      const flag = document.createElement('div'); flag.className = 'package_in_library_flag in_own_library';
      flag.innerHTML = '<span class="icon">☰</span> <span>Kütüphanede</span>'; section.insertBefore(flag, section.firstChild);
    }
  }

  function showDownloadModal() {
    if (document.querySelector('.ispa-overlay')) return;
    const { overlay, title, content } = createModal({ title: 'ispa', overlayClass: 'ispa-overlay' });
    const status = document.createElement('div'); status.className = 'ispa-status'; status.textContent = 'İşleniyor…';
    const { wrap, bar, percent } = createProgressBar();
    const details = document.createElement('div'); details.className = 'ispa-download-details';
    details.style.marginTop = '8px';
    content.append(status, wrap, percent, details);
    const errBox = document.createElement('div'); errBox.className = 'ispa-error-box'; errBox.style.display = 'none'; content.appendChild(errBox);
    document.body.appendChild(overlay);
    return { overlay, title, status, wrap, bar, percent, errBox };
  }

  function createAndInjectButton(appId) {
    const container =
      document.querySelector('.game_area_purchase_game_wrapper .game_purchase_action_bg') ||
      document.querySelector('.game_area_purchase_game:not(.demo_above_purchase) .game_purchase_action_bg') ||
      document.querySelector('.game_area_purchase_game:not(.demo_above_purchase) .game_purchase_action') ||
      document.querySelector('.game_area_purchase_game:not(.demo_above_purchase) .btn_addtocart')?.parentElement ||
      document.querySelector('.game_area_purchase_game_wrapper') ||
      document.querySelector('.game_purchase_action_bg') ||
      document.querySelector('.game_purchase_action') ||
      document.querySelector('.btn_addtocart')?.parentElement ||
      document.querySelector('[class*="purchase"]');

    if (!container) { backendLog('ispa butonu için uygun kapsayıcı bulunamadı'); return; }

    const btnContainer = document.createElement('div');
    btnContainer.className = 'btn_addtocart btn_packageinfo ispa-button-container';

    const button = document.createElement('span');
    button.setAttribute('data-panel', '{"focusable":true,"clickOnActivate":true}');
    button.setAttribute('role', 'button');
    button.className = 'btn_blue_steamui btn_medium';
    button.style.marginLeft = '2px';

    const buttonSpan = document.createElement('span'); buttonSpan.textContent = 'Oyunu Ekle';
    button.appendChild(buttonSpan); btnContainer.appendChild(button);

    setSteamTooltip(button, 'Oyunu Ekle');

    button.onclick = () => {
      if (state.run.inProgress) return;
      state.setRunState(true, appId);
      button.style.pointerEvents = 'none'; buttonSpan.textContent = 'Yükleniyor...'; button.style.opacity = '0.7';
      const modal = showDownloadModal(); if (modal) modal.status.textContent = 'Ekliyor...';
      callServer('addViaIspa', { appid: appId })
        .then((r) => {
          if (!r.success && modal) {
            const msg = r.error || 'Bilinmeyen Hata';
            modal.status.textContent = `Hata: ${msg}`;
            if (modal.errBox) { modal.errBox.textContent = msg; modal.errBox.style.display = 'block'; }
            state.setRunState(false);
          } else {
            startProgressMonitoring(appId);
          }
        })
        .catch((e) => { 
          const msg = e?.message || e || 'Bilinmeyen Hata';
          if (modal) { 
            modal.status.textContent = `Hata: ${msg}`; 
            if (modal.errBox) { modal.errBox.textContent = msg; modal.errBox.style.display = 'block'; }
          }
          state.setRunState(false);
        });
    };

    container.appendChild(btnContainer);
  }

  function createRemoveButton(appId) {
    const container =
      document.querySelector('.game_area_purchase_game_wrapper .game_purchase_action_bg') ||
      document.querySelector('.game_area_purchase_game:not(.demo_above_purchase) .game_purchase_action_bg') ||
      document.querySelector('.game_area_purchase_game:not(.demo_above_purchase) .game_purchase_action') ||
      document.querySelector('.game_area_purchase_game:not(.demo_above_purchase) .btn_addtocart')?.parentElement ||
      document.querySelector('.game_area_purchase_game_wrapper') ||
      document.querySelector('.game_purchase_action_bg') ||
      document.querySelector('.game_purchase_action') ||
      document.querySelector('.btn_addtocart')?.parentElement ||
      document.querySelector('[class*="purchase"]');

    if (!container) { backendLog('ispa kaldırma için uygun kapsayıcı bulunamadı'); return; }

    const btnContainer = document.createElement('div'); btnContainer.className = 'btn_addtocart btn_packageinfo ispa-button-container';
    const button = document.createElement('span');
    button.setAttribute('data-panel', '{"focusable":true,"clickOnActivate":true}');
    button.setAttribute('role', 'button');
    button.className = 'btn_blue_steamui btn_medium'; button.style.marginLeft = '2px';

    const buttonSpan = document.createElement('span'); buttonSpan.textContent = 'Oyunu Kaldır';
    button.appendChild(buttonSpan); btnContainer.appendChild(button);
    setSteamTooltip(button, 'Oyunu kaldır');

    button.onclick = () => {
      if (state.run.inProgress) return;
      state.setRunState(true, appId);
      button.style.pointerEvents = 'none'; buttonSpan.textContent = 'Kaldırılıyor...'; button.style.opacity = '0.7';
      const modal = showDownloadModal(); if (modal) modal.status.textContent = 'Kaldırılıyor...';
      callServer('RemoveViaIspa', { appid: appId })
        .then((r) => {
          if (r.success) {
            state.setRunState(false);
            state.cache.delete(`appExists_${appId}`);
            document.querySelector('#ispa-in-library-banner')?.remove();
            document.querySelectorAll('.package_in_library_flag').forEach(f => f.remove());
            document.querySelector('.ispa-button-container')?.remove();
            if (modal) { modal.status.textContent = 'Oyun kaldırıldı'; setTimeout(() => modal.overlay?.remove(), 1200); }
            setTimeout(addIspaButton, 1500);
          } else {
            const msg = r.error || 'Bilinmeyen Hata';
            state.setRunState(false);
            if (modal) { 
              modal.status.textContent = `Hata: ${msg}`; 
              if (modal.errBox) { modal.errBox.textContent = msg; modal.errBox.style.display = 'block'; }
            }
          }
        })
        .catch((e) => { 
          const msg = e?.message || e || 'Bilinmeyen Hata';
          state.setRunState(false);
          if (modal) { 
            modal.status.textContent = `Hata: ${msg}`; 
            if (modal.errBox) { modal.errBox.textContent = msg; modal.errBox.style.display = 'block'; }
          }
        });
    };

    container.appendChild(btnContainer);
  }

  function getCurrentAppId() {
    const m = window.location.href.match(/\/app\/(\d+)/);
    if (m) return parseInt(m[1]);
    const d = document.querySelector('[data-appid]');
    if (d) return parseInt(d.getAttribute('data-appid'));
    return null;
  }

  function getGameName() {
    const el = document.querySelector('.apphub_AppName') ||
      document.querySelector('.pageheader .breadcrumbs h1') ||
      document.querySelector('h1') || document.querySelector('title');
    if (!el) return 'Bu oyun';
    let name = el.textContent || el.innerText || '';
    return (name.replace(/\s+on\s+Steam$/i, '').trim()) || 'Bu oyun';
  }

  function showLibraryBanners() {
    if (document.querySelector('#ispa-in-library-banner')) return;
    const gameName = getGameName();
    const queue = document.querySelector('#queueActionsCtn');
    if (queue) queue.insertAdjacentElement('afterend', createInLibraryBanner(gameName));
    const btn = document.querySelector('.ispa-button-container');
    if (btn) {
      const sec = btn.closest('.game_area_purchase_game');
      if (sec && !sec.classList.contains('demo_above_purchase')) addInLibraryFlag(sec);
    }
  }

  function addIspaButton() {
    try {
      const appId = getCurrentAppId();
      if (!appId) { if (!state.logs.missingOnce) state.logs.missingOnce = true; return; }
      if (!state.logs.existsOnce) state.logs.existsOnce = true;

      Api.hasLua(appId).then(exists => {
        if (exists) {
          if (!document.querySelector('.ispa-button-container')) createRemoveButton(appId);
          showLibraryBanners();
          injectTopActions(appId);
        } else {
          if (!document.querySelector('.ispa-button-container')) createAndInjectButton(appId);
          injectTopActions(appId);
        }
      }).catch(() => {
        if (!document.querySelector('.ispa-button-container')) createAndInjectButton(appId);
        injectTopActions(appId);
      });
    } catch (e) { backendLog(`addIspaButton hatası: ${e}`); }
  }

  function startProgressMonitoring(appid) {
    let overlay = null, title = null, status = null, wrap = null, bar = null, percent = null, errBox = null;
    let done = false;
      const startTime = Date.now();
      const TIMEOUT_MS = 30000; // 30 saniyelik timeout

    const timer = setInterval(async () => {
      if (done) { clearInterval(timer); return; }
      
        // Timeout kontrolü
        if (Date.now() - startTime > TIMEOUT_MS) {
          done = true; clearInterval(timer);
          if (status) status.textContent = 'İşlem zaman aşımına uğradı (30sn)';
          state.setRunState(false);
          setTimeout(() => overlay?.remove(), 3000);
          return;
        }
      
      // Her polling'de overlay ve elementleri yeniden seç
      if (!overlay) overlay = document.querySelector('.ispa-overlay');
      if (overlay && !title) {
        title = overlay.querySelector('.ispa-title');
        status = overlay.querySelector('.ispa-status');
        wrap = overlay.querySelector('.ispa-progress');
        bar = overlay.querySelector('.ispa-progress-bar');
        percent = overlay.querySelector('.ispa-percent');
        errBox = overlay.querySelector('.ispa-error-box');
      }
      
      try {
        const payload = await callServer('GetStatus', { appid });
        if (!payload || payload.success === false) {
          if (status) status.textContent = `Durum alınamadı: ${payload?.error || 'API hatası'}`;
          return;
        }
        const st = payload?.state || {};

        if (title) title.textContent = st.currentApi ? `ispa - ${st.currentApi}` : 'ispa';
        const map = {
          'checking': st.currentApi ? `Kontrol ediliyor ${st.currentApi}…` : 'Müsaitlik kontrolü…',
          'checking_availability': 'Bağlantı kontrolü…',
          'queued': 'İndirme işlemi başlatılıyor…',
          'downloading': st.endpoint ? `İndiriliyor ${st.endpoint}…` : 'Paket indiriliyor…',
          'processing': 'Paket işleniyor…',
          'extracting': 'LUA çıkarılıyor…',
          'installing': st.installedFiles ? `Yükleniyor (${st.installedFiles.length} dosya)…` : 'Kurulum…',
          'done': 'Kurulum tamamlandı.!',
          'installing_missing_dlc': 'Eksik içerikler indiriliyor…',
          'failed': st.error || 'İndirme başarısız oldu'
        };
        const text = map[st.status] || st.status || 'İşleme…';
        if (status) status.textContent = text;

        if (wrap && bar && percent && ['downloading','processing','extracting','installing','installing_missing_dlc'].includes(st.status)) {
          wrap.style.display = 'block'; percent.style.display = 'block';
          let pct = 0;
          if (st.status === 'downloading') {
            const t = st.totalBytes || 0, r = st.bytesRead || 0;
            pct = t > 0 ? Math.floor((r / t) * 100) : (r ? 1 : 0);
          } else if (st.status === 'processing') pct = 25;
          else if (st.status === 'extracting') pct = 60;
          else if (st.status === 'installing') pct = 90;
          else if (st.status === 'installing_missing_dlc') {
            const total = st.to_install || (st.depot_list ? st.depot_list.length : 0);
            const depotStatus = st.depot_status || {};
            const doneCount = Object.values(depotStatus).filter(v => v === 'done').length;
            pct = total > 0 ? Math.floor((doneCount / total) * 100) : 0;
            // render per-depot statuses below the progress bar
            if (overlay && overlay.querySelector('.ispa-download-details')) {
              const details = overlay.querySelector('.ispa-download-details');
              details.innerHTML = '';
              (st.depot_list || []).forEach(d => {
                const s = depotStatus[String(d)] || 'pending';
                const el = document.createElement('div');
                el.style.cssText = 'font-size:12px; color:#ccc; margin-bottom:4px; display:flex; justify-content:space-between;';
                el.innerHTML = `<span>Depot ${d}</span><span style="opacity:0.9">${s}</span>`;
                details.appendChild(el);
              });
            }
          }
          bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
          percent.textContent = `${Math.min(100, Math.max(0, pct))}%`;
        }

        if (st.status === 'done') {
          if (bar && percent && status) { bar.style.width = '100%'; percent.textContent = '100%'; status.textContent = 'Oyun eklendi!'; }
          // temizle hata kutusunu
          const eb = overlay?.querySelector('.ispa-error-box'); if (eb) eb.style.display = 'none';
          done = true; state.setRunState(false); state.cache.delete(`appExists_${appid}`);
            setTimeout(() => { 
              state.cache.delete(`appExists_${appid}`);
                state.cacheResult(`appExists_${appid}`, true, 120000);
              showLibraryBanners();
              // Otomatik restart kaldırıldı - kullanıcı STEAMı YENIDEN BAŞLAT butonundan yapacak
              setTimeout(() => { overlay?.remove(); }, 800);
              document.querySelector('.ispa-button-container')?.remove();              document.querySelector('.ispa-top-actions')?.remove();              setTimeout(addIspaButton, 100);
            }, 1200);
        }

        if (st.status === 'failed') {
          const msg = st.error || 'Bilinmeyen hata';
          if (status) status.textContent = `Hata: ${msg}`;
          if (wrap) wrap.style.display = 'none';
          if (percent) percent.style.display = 'none';
          if (errBox) { errBox.textContent = msg; errBox.style.display = 'block'; }
          done = true; state.setRunState(false);
        }
      } catch (e) { backendLog(`İlerleme hatası: ${e}`); }
    }, 500);
  }

  function ensureCompatCss() {
    if (document.getElementById('ispa-compat-css')) return;
    const style = document.createElement('style');
    style.id = 'ispa-compat-css';
    style.textContent = `
      .ispa-compat-badge { display:inline-flex; align-items:center; gap:8px; font-size:13px; line-height:18px; padding:4px 10px; border-radius:12px; background:rgba(0,0,0,.3); border:1px solid rgba(255,255,255,.12); user-select:none; backdrop-filter: blur(2px); }
      .ispa-compat-dot { width:9px; height:9px; border-radius:50%; flex:0 0 9px; background:#888; }
      .ispa-compat-wrap { margin-left:0; display:block; vertical-align:middle; margin-top:6px; }
      .ispa-compat-badge[title] { cursor:help; }
    `;
    document.head.appendChild(style);
  }

  /* Kırmızı uyumluluk rozeti alanında butonlar */
  function ensureTopButtonsCss() {
    if (document.getElementById('ispa-top-css')) return;
    const style = document.createElement('style');
    style.id = 'ispa-top-css';
    style.textContent = `
      .ispa-top-actions { 
        display:flex; 
        gap:10px; 
        align-items:center; 
        padding:4px 0; 
        flex-wrap:nowrap;
      }
      .ispa-top-actions .ispa-top-btn { 
        background:linear-gradient(135deg, rgba(100,200,230,0.6) 0%, rgba(80,150,200,0.6) 100%);
        backdrop-filter:blur(12px);
        border:1px solid rgba(150,220,255,0.4);
        color:#fff;
        padding:8px 16px;
        border-radius:12px;
        font-size:13px;
        font-weight:600;
        cursor:pointer;
        transition:all 0.2s ease;
        white-space:nowrap;
        text-transform:uppercase;
        letter-spacing:0.5px;
        box-shadow:0 4px 12px rgba(100,200,230,0.2), inset 0 1px 2px rgba(255,255,255,0.3);
      }
      .ispa-top-actions .ispa-top-btn:hover { 
        background:linear-gradient(135deg, rgba(120,220,255,0.8) 0%, rgba(100,170,220,0.8) 100%);
        border-color:rgba(180,240,255,0.6);
        box-shadow:0 6px 20px rgba(100,200,230,0.35), inset 0 1px 2px rgba(255,255,255,0.4);
        transform:translateY(-1px);
      }
      .ispa-top-actions .ispa-top-btn:active { 
        transform:translateY(0px);
        box-shadow:0 2px 4px rgba(0,0,0,0.3) inset;
      }
      .ispa-dropdown-menu {
        position:relative;
        display:inline-block;
      }
      .ispa-dropdown-items { 
        position:absolute;
        top:100%;
        right:0;
        margin-top:8px;
        background:rgba(20,20,30,0.8);
        backdrop-filter:blur(20px);
        border:1px solid rgba(200,150,220,0.3);
        border-radius:12px;
        padding:0;
        border-radius:12px;
        min-width:240px;
        z-index:100000;
        box-shadow:0 8px 32px rgba(0,0,0,0.4), inset 0 1px 2px rgba(255,255,255,0.1);
      }
      .ispa-dlc-download-btn {
        background:linear-gradient(135deg, rgba(100,200,200,0.6) 0%, rgba(80,160,180,0.6) 100%);
        border:1px solid rgba(150,220,220,0.4);
        color:#fff;
        padding:6px 12px;
        border-radius:6px;
        font-size:11px;
        font-weight:600;
        cursor:pointer;
        transition:all 0.2s ease;
        box-shadow:0 2px 6px rgba(0,0,0,0.2);
      }
      .ispa-dlc-download-btn:hover {
        background:linear-gradient(135deg, rgba(120,220,220,0.8) 0%, rgba(100,180,200,0.8) 100%);
        box-shadow:0 4px 12px rgba(100,200,200,0.3);
      }
      .ispa-menu-item {
        background:linear-gradient(135deg, rgba(100,200,230,0.5) 0%, rgba(80,150,200,0.5) 100%);
        border:1px solid rgba(150,220,255,0.3);
        color:#fff;
        padding:10px 12px;
        border-radius:8px;
        font-size:12px;
        font-weight:600;
        cursor:pointer;
        transition:all 0.2s ease;
        box-shadow:0 2px 6px rgba(0,0,0,0.2);
      }
      .ispa-menu-item:hover {
        background:linear-gradient(135deg, rgba(120,220,255,0.7) 0%, rgba(100,170,220,0.7) 100%);
        border-color:rgba(180,240,255,0.5);
        box-shadow:0 4px 12px rgba(100,200,230,0.3);
      }
    `;
    document.head.appendChild(style);
  }

  function norm(s) {
    try { return (s || '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase(); } catch { return (s || '').toString().toLowerCase(); }
  }

  function uniqueNormList(list) {
    const out = [];
    const seen = new Set();
    for (const x of list) {
      const n = norm(x).trim();
      if (!n) continue;
      if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out;
  }

  function ispaCollectStructured() {
    const tagNodes = document.querySelectorAll('.glance_tags .app_tag, .popular_tags .app_tag, #category_block a, #category_block .label');
    const specNodes = document.querySelectorAll('.game_area_details_specs a.name, .game_area_details_specs li, .game_area_features_list li');
    const noticeNodes = document.querySelectorAll('.DRM_notice, .game_meta_data, .glance_ctn, .game_area_purchase');

    const tags = uniqueNormList(Array.from(tagNodes).map(n => n.textContent || n.innerText || ''));
    const specs = uniqueNormList(Array.from(specNodes).map(n => n.textContent || n.innerText || ''));
    const noticesText = norm(Array.from(noticeNodes).map(n => n.innerText || n.textContent || '').join(' \n '));

    return { tags, specs, noticesText };
  }

  function ispaAnalyzeCompat() {
    const { tags, specs, noticesText } = ispaCollectStructured();

    const ONLINE_TERMS = [
      'online pvp','online co-op','co-op online','cooperativo en linea','cooperativo en linea','multijugador en linea',
      'multiplayer online','massively multiplayer','mmo','mmorpg','cross-platform multiplayer','crossplay','cross-play',
      'pvp en linea','jcj en linea','pve en linea','requires internet connection','requiere conexion','requiere conexion a internet',
      'always online','live service','games as a service','servicio en linea'
    ];
    const SINGLE_PLAYER_TERMS = ['single-player','un jugador','single player'];
    const DRM_TERMS = ['requires 3rd-party drm','third-party drm','drm de terceros','denuvo','secucrom','securom','arxan','vmprotect','dmm drm','xadrs drm','rockstar launcher drm','proteccion denuvo'];
    const ACCOUNT_TERMS = ['requires 3rd-party account','3rd-party account','cuenta de terceros','requiere cuenta','ea account','ea app','ea play','ubisoft connect','uplay','rockstar social club','battle.net','bethesda.net','2k account','epic account','riot account','bnet'];

    const inList = (list, terms) => list.some(x => terms.some(t => x.includes(t)));
    const hasOnline = inList(tags, ONLINE_TERMS) || inList(specs, ONLINE_TERMS);
    const hasSingle = inList(tags, SINGLE_PLAYER_TERMS) || inList(specs, SINGLE_PLAYER_TERMS);

    let level = 'ok';
    const reasons = [];

    if (DRM_TERMS.some(t => noticesText.includes(t))) {
      level = 'bad';
      reasons.push('Third-party DRM detected (bypass gerekli).');
    }

    if (ACCOUNT_TERMS.some(t => noticesText.includes(t)) || inList(tags, ACCOUNT_TERMS) || inList(specs, ACCOUNT_TERMS)) {
      if (level !== 'bad') level = 'warn';
      reasons.push('Requires a third-party account (Lisans doğrulama işlemi başarısız olabilir; atlama işlemi gerekebilir.).');
    }

    if (hasOnline) {
      if (level !== 'bad') level = 'warn';
      reasons.push('Online/multiplayer content (Çalışmayabilir).');
    }

    if (level === 'ok' && hasSingle && !hasOnline) {
    }

    const labels = { ok: 'Çalışıyor', warn: 'Çalışmayabilir', bad: "Bypass olmadan çalışmaz." };
    const colors = { ok: '#5c7e10', warn: '#a0790b', bad: '#a0352c' };

    return { level, label: labels[level], color: colors[level], reasons };
  }

  function ispaMakeBadge(info) {
    const wrap = document.createElement('span');
    wrap.className = 'ispa-compat-wrap';
    const badge = document.createElement('span');
    badge.className = 'ispa-compat-badge';
    badge.title = (info.reasons.length ? info.reasons.join(' • ') : info.label);
    const dot = document.createElement('span');
    dot.className = 'ispa-compat-dot';
    dot.style.background = info.color;
    const text = document.createElement('span');
    text.textContent = `Uyumluluk: ${info.label}`;
    badge.appendChild(dot);
    badge.appendChild(text);
    wrap.appendChild(badge);
    const titleEl = document.querySelector('#appHubAppName, .apphub_AppName');
    if (titleEl && titleEl.parentElement) {
      titleEl.parentElement.style.display = 'flex';
      titleEl.parentElement.style.flexDirection = 'column';
      titleEl.parentElement.insertBefore(wrap, titleEl.nextSibling);
      return wrap;
    }
    const buy = document.querySelector('.game_area_purchase_game');
    if (buy) {
      const holder = document.createElement('div');
      holder.style.margin = '6px 0 2px 0';
      holder.appendChild(wrap);
      buy.prepend(holder);
      return wrap;
    }
    return wrap;
  }

  function createFixStatusBadge(appId) {
    // Fix status badge'i oluştur - uyumluluk badge'inin altında
    const existing = document.querySelector('.ispa-fix-status-wrap');
    if (existing) return existing;
    
    const compatWrap = document.querySelector('.ispa-compat-wrap');
    if (!compatWrap) return null;
    
    const fixWrap = document.createElement('div');
    fixWrap.className = 'ispa-fix-status-wrap';
    fixWrap.style.cssText = `
      margin-top: 8px;
      padding: 8px 12px;
      background: rgba(15, 15, 25, 0.4);
      backdrop-filter: blur(10px);
      border-radius: 8px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    `;
    
    // 3 fix status item
    const fixItems = [
      { type: 'steam_online', icon: '🌐', label: 'Steam Online' },
      { type: 'bypass', icon: '🔓', label: 'Bypass' },
      { type: 'denuvo', icon: '🛡️', label: 'Denuvo' }
    ];

    fixItems.forEach(item => {
      const fixItem = document.createElement('div');
      fixItem.className = 'ispa-fix-item';
      fixItem.dataset.fixType = item.type;
      fixItem.style.cssText = `
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        background: linear-gradient(135deg, rgba(100,200,230,0.6) 0%, rgba(80,150,200,0.6) 100%);
        color: #fff;
        border: 1px solid rgba(150,220,255,0.4);
        display: flex;
        align-items: center;
        gap: 4px;
        transition: all 0.2s ease;
        cursor: default;
        box-shadow: 0 2px 6px rgba(100,200,230,0.2);
      `;
      fixItem.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
      fixWrap.appendChild(fixItem);
    });
    
    compatWrap.parentElement.insertBefore(fixWrap, compatWrap.nextSibling);
    
    // Fix status'unu kontrol et
    updateFixStatusBadge(appId);
    
    return fixWrap;
  }

  async function checkFixCompatibility(appId, fixType) {
    try {
      const gameInfo = await callServer('GetGameInfo', { appid: appId });
      if (!gameInfo.success) return false;

      const { tags, specs, noticesText } = gameInfo;

      const DRM_TERMS = ['requires 3rd-party drm','third-party drm','drm de terceros','denuvo','secucrom','securom','arxan','vmprotect','dmm drm','xadrs drm','rockstar launcher drm','proteccion denuvo'];
      const ACCOUNT_TERMS = ['requires 3rd-party account','3rd-party account','cuenta de terceros','requiere cuenta','ea account','ea app','ea play','ubisoft connect','uplay','rockstar social club','battle.net','bethesda.net','2k account','epic account','riot account','bnet'];

      const inList = (list, terms) => list.some(x => terms.some(t => x.includes(t)));

      if (fixType === 'denuvo') {
        return DRM_TERMS.some(t => noticesText.includes(t));
      } else if (fixType === 'bypass') {
        return ACCOUNT_TERMS.some(t => noticesText.includes(t)) || inList(tags, ACCOUNT_TERMS) || inList(specs, ACCOUNT_TERMS);
      } else if (fixType === 'steam_online') {
        // Steam online fix genellikle single-player oyunlar için
        return true; // Her oyun için potansiyel olarak uyumlu
      }

      return false;
    } catch (e) {
      console.error(`[ISPA] checkFixCompatibility error:`, e);
      return false;
    }
  }

  function updateFixStatusBadge(appId) {
    console.log(`[ISPA] updateFixStatusBadge for appId: ${appId}`);
    callServer('GetFixStatus', { appid: appId }).then(r => {
      console.log(`[ISPA] GetFixStatus response:`, r);
      if (r && r.success && r.fixes) {
        const fixes = r.fixes;
        ['steam_online', 'bypass', 'denuvo'].forEach(fixType => {
          const isApplied = fixes[fixType];
          const item = document.querySelector(`[data-fix-type="${fixType}"]`);
          if (item) {
            if (isApplied) {
              // Yeşile dönsün - fix uygulanmış
              item.style.background = 'rgba(50, 200, 50, 0.5)';
              item.style.borderColor = 'rgba(100, 220, 100, 0.3)';
              item.style.boxShadow = '0 0 8px rgba(50, 200, 50, 0.3)';
            } else {
              // Kırmızı kalmasın - fix uygulanmamış
              item.style.background = 'rgba(200, 50, 50, 0.5)';
              item.style.borderColor = 'rgba(220, 80, 80, 0.3)';
              item.style.boxShadow = 'none';
            }
          }
        });
      }
    }).catch(e => {
      console.error(`[ISPA] GetFixStatus error:`, e);
    });
  }

  function injectTopActions(appId) {
    try {
      ensureTopButtonsCss();
      console.log(`[ISPA] injectTopActions called for appId: ${appId}`);
      
      // Badge wrap'ı bul
      const badgeWrap = document.querySelector('.ispa-compat-wrap');
      console.log(`[ISPA] Badge wrap found:`, badgeWrap);
      if (!badgeWrap || !badgeWrap.parentElement) {
        console.error(`[ISPA] Badge wrap bulunamadı veya parentı yok`);
        return null;
      }
      
      const parent = badgeWrap.parentElement;
      if (parent.querySelector('.ispa-top-actions')) {
        console.log(`[ISPA] Top actions already exist`);
        return parent.querySelector('.ispa-top-actions');
      }

      const actions = document.createElement('div');
      actions.className = 'ispa-top-actions';
      console.log(`[ISPA] Created actions container`);
      
      // 3 buton: OYUN EKLE / OYUNU KALDIR / STEAMı YENIDEN BAŞLAT
      const addBtn = document.createElement('button'); 
      addBtn.className = 'ispa-top-btn'; 
      addBtn.id = `ispa-add-btn-${appId}`;
      
      const remBtn = document.createElement('button'); 
      remBtn.className = 'ispa-top-btn'; 
      remBtn.id = `ispa-rem-btn-${appId}`;
      
      const restartBtn = document.createElement('button'); 
      restartBtn.className = 'ispa-top-btn'; 
      restartBtn.textContent = 'YENIDEN BAŞLAT';
      
      // Menü butonu ekle
      const menuBtn = document.createElement('button');
      menuBtn.className = 'ispa-top-btn ispa-menu-btn';
      menuBtn.textContent = '⋮ MENÜ';
      
      const dropdown = document.createElement('div');
      dropdown.className = 'ispa-dropdown-menu';
      
      const menuItems = document.createElement('div');
      menuItems.className = 'ispa-dropdown-items';
      menuItems.style.display = 'none';  // Başlangıçta gizli
      // menuBtn will be inserted into dropdown so the absolute positioning is relative to this wrapper
      dropdown.appendChild(menuItems);
      
      // Button state'i Api.hasLua sonucuna göre dinamik yap
      const updateButtonState = (appExists) => {
        console.log(`[ISPA] updateButtonState called: appExists=${appExists}`);
        if (appExists) {
          addBtn.textContent = 'Oyun Ekli';
          addBtn.disabled = true;
          addBtn.style.opacity = '0.5';
          remBtn.textContent = 'OYUNU KALDIR';
          remBtn.disabled = false;
          remBtn.style.opacity = '1';
        } else {
          addBtn.textContent = 'OYUN EKLE';
          addBtn.disabled = false;
          addBtn.style.opacity = '1';
          remBtn.textContent = 'Oyun Yok';
          remBtn.disabled = true;
          remBtn.style.opacity = '0.5';
        }
      };
      
      // İlk state'i check et
      console.log(`[ISPA] Checking initial state for appId ${appId}`);
      Api.hasLua(appId).then(exists => {
        console.log(`[ISPA] Api.hasLua returned: exists=${exists}`);
        updateButtonState(exists);
      }).catch(e => {
        console.error(`[ISPA] Api.hasLua error:`, e);
        updateButtonState(false);
      });

      addBtn.onclick = () => {
        if (state.run.inProgress || addBtn.disabled) return;
        state.setRunState(true, appId);
        const modal = showDownloadModal(); if (modal) modal.status.textContent = 'Ekliyor...';
        console.log(`[ISPA] addBtn clicked for appId: ${appId}`);
        callServer('addViaIspa', { appid: appId }).then(r => {
          console.log(`[ISPA] addViaIspa response:`, r);
          if (!r.success) {
            const msg = r.error || 'Bilinmeyen Hata';
            console.error(`[ISPA] Add failed:`, msg);
            if (modal) { modal.status.textContent = `Hata: ${msg}`; if (modal.errBox) { modal.errBox.textContent = msg; modal.errBox.style.display = 'block'; } }
            state.setRunState(false);
            return;
          }
          console.log(`[ISPA] Add successful, starting progress monitor`);
          startProgressMonitoring(appId);
        }).catch(e => { 
          console.error(`[ISPA] addViaIspa error:`, e);
          if (modal) { modal.status.textContent = `Hata: ${e?.message||e}`; if (modal.errBox) { modal.errBox.textContent = e?.message||e; modal.errBox.style.display='block'; } } 
          state.setRunState(false); 
        });
      };

      remBtn.onclick = () => {
        if (state.run.inProgress || remBtn.disabled) return;
        state.setRunState(true, appId);
        const modal = showDownloadModal(); if (modal) modal.status.textContent = 'Kaldırılıyor...';
        callServer('RemoveViaIspa', { appid: appId }).then(r => {
          if (!r.success) {
            const msg = r.error || 'Bilinmeyen Hata';
            if (modal) { modal.status.textContent = `Hata: ${msg}`; if (modal.errBox) { modal.errBox.textContent = msg; modal.errBox.style.display='block'; } }
            state.setRunState(false);
            return;
          }
          state.setRunState(false);
          state.cache.delete(`appExists_${appId}`);
          if (modal) { modal.status.textContent='Oyun kaldırıldı'; setTimeout(()=> modal.overlay?.remove(),1200); }
          document.querySelector('.ispa-button-container')?.remove();
          document.querySelector('.ispa-top-actions')?.remove();
          setTimeout(addIspaButton, 1500);
        }).catch(e => { if (modal) { modal.status.textContent = `Hata: ${e?.message||e}`; if (modal.errBox) { modal.errBox.textContent = e?.message||e; modal.errBox.style.display='block'; } } state.setRunState(false); });
      };

      restartBtn.onclick = () => {
        const modal = showDownloadModal(); if (modal) modal.status.textContent = 'Steam yeniden başlatılıyor...';
        console.log(`[ISPA] RestartSteam clicked`);
        callServer('RestartSteam', {}).then(r => {
          console.log(`[ISPA] RestartSteam response:`, r);
          if (r && r.success) { 
            console.log(`[ISPA] RestartSteam başarılı`);
            if (modal) { 
              modal.status.textContent = r.message || 'Steam yeniden başlatılıyor. Bekleyin...'; 
              setTimeout(() => modal.overlay?.remove(), 3000); 
            } 
          } else { 
            const errMsg = r?.error || 'Bilinmeyen hata';
            console.error(`[ISPA] RestartSteam başarısız:`, errMsg);
            if (modal) { 
              modal.status.textContent = `Hata: ${errMsg}`; 
              if (modal.errBox) { 
                modal.errBox.textContent = errMsg; 
                modal.errBox.style.display='block'; 
              } 
            } 
          }
        }).catch(e => { 
          console.error(`[ISPA] RestartSteam exception:`, e);
          if (modal) { 
            const errMsg = e?.message || String(e);
            modal.status.textContent = `Hata: ${errMsg}`; 
            if (modal.errBox) { 
              modal.errBox.textContent = errMsg; 
              modal.errBox.style.display='block'; 
            } 
          } 
        });
      };

      // Menü butonu click handler
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        console.log(`[ISPA] Menu clicked`);
        const isOpen = menuItems.style.display === 'block';
        menuItems.style.display = isOpen ? 'none' : 'block';

        if (!isOpen) {
          // Dropdown'u doldur: önce DLC bölümü, sonra diğer seçenekler
          menuItems.innerHTML = `
            <div style="padding:12px; border-bottom:1px solid rgba(255,255,255,0.1); color:#ccc;">
              <div style="font-weight:600; font-size:12px; margin-bottom:8px;">📦 DLC Bilgisi</div>
              <div style="color:#aaa; font-size:11px; margin-bottom:8px;">Kontrol ediliyor...</div>
            </div>
            <div style="padding:8px;">
              <button class="ispa-menu-item" data-action="check-updates" style="width:100%; margin-bottom:4px;">✓ Güncellemeleri Kontrol Et</button>
              <button class="ispa-menu-item" data-action="fix-menu" style="width:100%; margin-bottom:4px;">🔧 Fix Menü</button>
              <button class="ispa-menu-item" data-action="settings" style="width:100%;">⚙ Ayarlar</button>
            </div>
          `;

          // DLC info al ve güncelle
          callServer('CheckDLC', { appid: appId }).then(r => {
            console.log(`[ISPA] CheckDLC response:`, r);
            const dlcSection = menuItems.querySelector('div:first-child');
            if (r && r.success) {
              const installed = r.installed || 0;
              const total = r.total || 0;
              const missing = r.missing || 0;
              // Yeni: Bu Oyun İçin İçerik bölümü
              dlcSection.innerHTML = `
                <div style="font-weight:600; font-size:12px; margin-bottom:8px;">Bu Oyun İçin İçerik</div>
                <div style="color:#aaa; font-size:11px; margin-bottom:6px;">Toplam içerik: ${total}</div>
                <div style="color:#aaa; font-size:11px; margin-bottom:6px;">Kurulu: ${installed}</div>
                <div style="color:#aaa; font-size:11px;">Eksik: ${missing}</div>
                <div style="margin-top:8px; display:flex; gap:8px;">
                  <button class="ispa-dlc-download-btn" style="flex:1;">Ekle ${missing > 0 ? `(${missing} eksik)` : ''}</button>
                </div>
                <div style="margin-top:8px; font-size:11px; color:#999;">
                  <a href="#" class="ispa-dlc-debug-toggle">Detayları Göster</a>
                  <div class="ispa-dlc-debug" style="display:none; margin-top:6px; white-space:pre-wrap; font-size:11px; color:#bbb;"></div>
                </div>
              `;

              const dlcBtn = dlcSection.querySelector('.ispa-dlc-download-btn');
              if (dlcBtn) {
                dlcBtn.onclick = (e) => {
                  e.stopPropagation();
                  const modal = showDownloadModal && typeof showDownloadModal === 'function' ? showDownloadModal() : null;
                  if (modal && modal.status) modal.status.textContent = 'İçerik ekleniyor...';

                  // Call InstallMissingDLC
                  callServer('InstallMissingDLC', { appid: appId }).then(r2 => {
                    console.log('[ISPA] InstallMissingDLC response:', r2);
                    if (r2 && r2.success) {
                      if (modal && modal.status) modal.status.textContent = r2.message || 'İçerik indirme başlatıldı';
                      // Start progress monitoring if successful
                      setTimeout(() => startProgressMonitoring(appId), 500);
                    } else {
                      if (modal && modal.status) modal.status.textContent = r2?.error || 'İçerik indirme başarısız';
                      if (modal && modal.errBox) { 
                        modal.errBox.textContent = r2?.error || 'Bilinmeyen hata'; 
                        modal.errBox.style.display = 'block'; 
                      }
                      setTimeout(() => modal?.overlay?.remove(), 3000);
                    }
                  }).catch(e2 => {
                    console.error('[ISPA] InstallMissingDLC error:', e2);
                    if (modal && modal.status) modal.status.textContent = 'İçerik indirme hatası';
                    if (modal && modal.errBox) { 
                      modal.errBox.textContent = e2?.message || String(e2); 
                      modal.errBox.style.display = 'block'; 
                    }
                    setTimeout(() => modal?.overlay?.remove(), 3000);
                  });
                };
              }
              // attach debug toggle
              const dbgToggle = dlcSection.querySelector('.ispa-dlc-debug-toggle');
              const dbgBox = dlcSection.querySelector('.ispa-dlc-debug');
              if (dbgToggle && dbgBox) {
                dbgToggle.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation();
                  if (dbgBox.style.display === 'none') {
                    const info = JSON.stringify(r, null, 2);
                    dbgBox.textContent = info;
                    dbgBox.style.display = 'block';
                    dbgToggle.textContent = 'Detayları Gizle';
                  } else {
                    dbgBox.style.display = 'none'; dbgToggle.textContent = 'Detayları Göster';
                  }
                };
              }
            } else {
              dlcSection.innerHTML = `
                <div style="font-weight:600; font-size:12px; margin-bottom:8px;">📦 DLC Bilgisi</div>
                <div style="color:#999; font-size:11px;">Bilgi alınamadı</div>
              `;
            }

            // Menu items click handlers
            menuItems.querySelectorAll('.ispa-menu-item').forEach(btn => {
              btn.onclick = (e) => { e.stopPropagation(); handleMenuAction(btn.dataset.action, appId); };
            });
          }).catch(e => {
            console.error(`[ISPA] CheckDLC error:`, e);
            const dlcSection = menuItems.querySelector('div:first-child');
            dlcSection.innerHTML = `
              <div style="font-weight:600; font-size:12px; margin-bottom:8px;">📦 DLC Bilgisi</div>
              <div style="color:#999; font-size:11px;">Hata: ${e?.message||e}</div>
            `;
          });
        }
      };
      
      // Dropdown'u dış tıklama ile kapat
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.ispa-dropdown-menu') && !e.target.closest('.ispa-menu-btn')) {
          menuItems.style.display = 'none';
        }
      });

      actions.appendChild(addBtn); 
      actions.appendChild(remBtn); 
      actions.appendChild(restartBtn);
      // Put the menu button inside the dropdown wrapper so the menu items align under the button
      dropdown.insertBefore(menuBtn, menuItems);
      actions.appendChild(dropdown);
      
      // Badge'in hemen sağına (after) ekle
      badgeWrap.insertAdjacentElement('afterend', actions);
      console.log(`[ISPA] Actions inserted after badge`);
      
      // Parent'i flex yap
      parent.style.display = 'flex';
      parent.style.alignItems = 'center';
      parent.style.gap = '10px';
      parent.style.justifyContent = 'flex-start';
      console.log(`[ISPA] Parent display set to flex`);
      
      return actions;
    } catch (e) { 
      console.error(`[ISPA] injectTopActions exception:`, e);
      backendLog(`injectTopActions hata: ${e}`); 
      return null; 
    }
  }

  function handleMenuAction(action, appId) {
    console.log(`[ISPA] Menu action: ${action} for appId: ${appId}`);
    
    if (action === 'check-updates') {
      const modal = showDownloadModal();
      if (modal) modal.status.textContent = 'Güncellemeler kontrol ediliyor...';
      callServer('CheckUpdates', { appid: appId }).then(r => {
        if (r && r.success) {
          const msg = r.updates_available ? 'Güncelleme mevcut! Steam\'de kontrol edin.' : 'Güncelleme yok.';
          if (modal) { modal.status.textContent = msg; setTimeout(() => modal.overlay?.remove(), 2500); }
        } else {
          if (modal) { modal.status.textContent = 'Hata: ' + (r?.error || 'Bilinmeyen'); if (modal.errBox) { modal.errBox.textContent = r?.error; modal.errBox.style.display = 'block'; } }
        }
      }).catch(e => { if (modal) { modal.status.textContent = 'Hata: ' + (e?.message||e); if (modal.errBox) { modal.errBox.textContent = e?.message||e; modal.errBox.style.display = 'block'; } } });
    } 
    else if (action === 'fix-menu') {
      showFixMenu(appId);
    } 
    else if (action === 'settings') {
      showSettingsMenu(appId);
    }
  }

  function showFixMenu(appId) {
    const overlay = document.createElement('div');
    overlay.className = 'ispa-overlay';
    overlay.style.zIndex = '999999';
    
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; 
      top: 50%; left: 50%; 
      transform: translate(-50%, -50%); 
      background: rgba(15,15,25,0.95); 
      backdrop-filter: blur(20px);
      border: 1px solid rgba(150,200,255,0.2);
      border-radius: 16px;
      padding: 24px;
      min-width: 400px;
      max-width: 600px;
      z-index: 1000000;
      color: #fff;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      max-height: 80vh;
      overflow-y: auto;
    `;
    
    // Fix status'u yükle
    const fixItems = [
      { type: 'steam_online', icon: '🌐', label: 'Steam Online Fix' },
      { type: 'bypass', icon: '🔓', label: 'Bypass Fix' },
      { type: 'denuvo', icon: '🛡️', label: 'Denuvo Fix' }
    ];
    
    let fixesLoaded = { steam_online: false, bypass: false, denuvo: false };
    
    const statusFetch = callServer('GetFixStatus', { appid: appId }).then(r => {
      if (r && r.success && r.fixes) {
        fixesLoaded = r.fixes;
      }
    }).catch(e => console.error(e));
    
    // Modal içeriğini başlat - ekle/kaldır butonları
    let buttonsHTML = `<div style="font-weight:700; font-size:18px; margin-bottom:16px; text-align:center;">🔧 Fix Menü</div>
      <div style="display:flex; flex-direction:column; gap:8px;">`;
    
    fixItems.forEach(item => {
      buttonsHTML += `
        <div style="padding: 12px; background: rgba(100,200,230,0.1); border-radius:8px; border-left:3px solid rgba(100,200,230,0.5); display:flex; justify-content:space-between; align-items:center;">
          <span>${item.icon} ${item.label}</span>
          <div style="display:flex; gap:4px;">
            <button class="ispa-fix-download" data-fix="${item.type}" style="padding:4px 10px; background:rgba(100,220,100,0.5); border:1px solid rgba(150,255,150,0.3); border-radius:4px; color:#fff; cursor:pointer; font-size:11px;">📥 İndir</button>
            <button class="ispa-fix-toggle" data-action="apply" data-fix="${item.type}" style="padding:4px 10px; background:rgba(100,200,230,0.5); border:1px solid rgba(150,220,255,0.3); border-radius:4px; color:#fff; cursor:pointer; font-size:11px;">+ Ekle</button>
            <button class="ispa-fix-toggle" data-action="remove" data-fix="${item.type}" style="padding:4px 10px; background:rgba(200,100,100,0.5); border:1px solid rgba(220,150,150,0.3); border-radius:4px; color:#fff; cursor:pointer; font-size:11px;">- Kaldır</button>
          </div>
        </div>
      `;
    });
    
    buttonsHTML += `</div>
      <div style="margin-top:16px; padding:12px; background:rgba(100,200,230,0.1); border-radius:8px; border-left:3px solid rgba(100,200,230,0.5); font-size:12px; color:#aaa;">
        ℹ️ <strong>İndir</strong> butonu generator.ryuu.lol'den otomatik fix indirir ve uygular.<br>
        <strong>Ekle/Kaldır</strong> butonları manuel marker dosyası oluşturur/siler.
      </div>
      <button style="width:100%; margin-top:16px; padding:8px; background:rgba(100,150,180,0.5); border:1px solid rgba(150,200,255,0.3); border-radius:8px; color:#fff; cursor:pointer;" onclick="this.closest('.ispa-overlay').remove();">Kapat</button>`;
    
    modal.innerHTML = buttonsHTML;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Fix download butonlarına click handler ekle
    statusFetch.then(() => {
      modal.querySelectorAll('.ispa-fix-download').forEach(btn => {
        const fixType = btn.dataset.fix;
        
        btn.onclick = (e) => {
          e.stopPropagation();
          console.log(`[ISPA] DownloadAndApplyFix for ${fixType}`);
          
          const progressOverlay = document.createElement('div');
          progressOverlay.style.cssText = `
            position: fixed; top: 50%; left: 50%; 
            transform: translate(-50%, -50%);
            background: rgba(15,15,25,0.95);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(150,200,255,0.2);
            border-radius: 16px;
            padding: 24px;
            z-index: 1000001;
            color: #fff;
            text-align: center;
          `;
          progressOverlay.innerHTML = `
            <div style="font-weight:700; margin-bottom:12px;">📥 Fix İndiriliyor...</div>
            <div style="font-size:12px;">generator.ryuu.lol'den indiriliyor...</div>
          `;
          document.body.appendChild(progressOverlay);
          
          callServer('DownloadAndApplyFix', { appid: appId, fix_type: fixType }).then(r => {
            console.log(`[ISPA] DownloadAndApplyFix response:`, r);
            progressOverlay.remove();
            overlay.remove();
            
            if (r && r.success) {
              updateFixStatusBadge(appId);
              // Başarı mesajı göster
              const successOverlay = document.createElement('div');
              successOverlay.className = 'ispa-overlay';
              const successModal = document.createElement('div');
              successModal.style.cssText = `
                position: fixed; top: 50%; left: 50%; 
                transform: translate(-50%, -50%);
                background: rgba(15,15,25,0.95);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(100,255,100,0.2);
                border-radius: 16px;
                padding: 24px;
                z-index: 1000001;
                color: #fff;
                min-width: 300px;
              `;
              successModal.innerHTML = `
                <div style="font-weight:700; color:#8f8; margin-bottom:12px;">✅ Başarılı</div>
                <div style="font-size:12px; margin-bottom:16px;">${r.message || 'Fix başarıyla indirildi ve uygulandı'}</div>
                <button style="width:100%; padding:8px; background:rgba(100,150,100,0.5); border:1px solid rgba(150,200,150,0.3); border-radius:8px; color:#fff; cursor:pointer;" onclick="this.closest('.ispa-overlay').remove();">Tamam</button>
              `;
              successOverlay.appendChild(successModal);
              document.body.appendChild(successOverlay);
              setTimeout(() => {
                successOverlay.remove();
                showFixMenu(appId);
              }, 2000);
            } else {
              const errorOverlay = document.createElement('div');
              errorOverlay.className = 'ispa-overlay';
              const errorModal = document.createElement('div');
              errorModal.style.cssText = `
                position: fixed; top: 50%; left: 50%; 
                transform: translate(-50%, -50%);
                background: rgba(15,15,25,0.95);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255,100,100,0.2);
                border-radius: 16px;
                padding: 24px;
                z-index: 1000001;
                color: #fff;
                min-width: 300px;
              `;
              errorModal.innerHTML = `
                <div style="font-weight:700; color:#f88; margin-bottom:12px;">❌ Hata</div>
                <div style="font-size:12px; margin-bottom:16px;">${r?.error || 'Fix indirilemedi. Bu oyun için fix mevcut olmayabilir.'}</div>
                <button style="width:100%; padding:8px; background:rgba(150,100,100,0.5); border:1px solid rgba(200,150,150,0.3); border-radius:8px; color:#fff; cursor:pointer;" onclick="this.closest('.ispa-overlay').remove();">Kapat</button>
              `;
              errorOverlay.appendChild(errorModal);
              document.body.appendChild(errorOverlay);
            }
          }).catch(e => {
            console.error(`[ISPA] DownloadAndApplyFix error:`, e);
            progressOverlay.remove();
            overlay.remove();
          });
        };
      });
      
      // Fix toggle butonlarına click handler ekle
      modal.querySelectorAll('.ispa-fix-toggle').forEach(btn => {
        const fixType = btn.dataset.fix;
        const action = btn.dataset.action;
        const isApplied = fixesLoaded[fixType];
        
        // Buton durumlarını ayarla
        if (isApplied && action === 'apply') {
          btn.disabled = true;
          btn.style.opacity = '0.4';
        } else if (!isApplied && action === 'remove') {
          btn.disabled = true;
          btn.style.opacity = '0.4';
        }
        
        btn.onclick = (e) => {
          e.stopPropagation();
          const callMethod = action === 'apply' ? 'ApplyFix' : 'RemoveFix';
          console.log(`[ISPA] ${callMethod} for ${fixType}`);
          
          const progressOverlay = document.createElement('div');
          progressOverlay.style.cssText = `
            position: fixed; top: 50%; left: 50%; 
            transform: translate(-50%, -50%);
            background: rgba(15,15,25,0.95);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(150,200,255,0.2);
            border-radius: 16px;
            padding: 24px;
            z-index: 1000001;
            color: #fff;
            text-align: center;
          `;
          progressOverlay.innerHTML = `
            <div style="font-weight:700; margin-bottom:12px;">${action === 'apply' ? '🌐 Uygulanıyor...' : '🗑️ Kaldırılıyor...'}</div>
            <div style="font-size:12px;">Lütfen bekleyin...</div>
          `;
          document.body.appendChild(progressOverlay);
          
          callServer(callMethod, { appid: appId, fix_type: fixType }).then(r => {
            console.log(`[ISPA] ${callMethod} response:`, r);
            progressOverlay.remove();
            overlay.remove();
            
            if (r && r.success) {
              updateFixStatusBadge(appId);
              showFixMenu(appId);
            } else {
              const errorOverlay = document.createElement('div');
              errorOverlay.className = 'ispa-overlay';
              const errorModal = document.createElement('div');
              errorModal.style.cssText = `
                position: fixed; top: 50%; left: 50%; 
                transform: translate(-50%, -50%);
                background: rgba(15,15,25,0.95);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255,100,100,0.2);
                border-radius: 16px;
                padding: 24px;
                z-index: 1000001;
                color: #fff;
                min-width: 300px;
              `;
              errorModal.innerHTML = `
                <div style="font-weight:700; color:#f88; margin-bottom:12px;">❌ Hata</div>
                <div style="font-size:12px; margin-bottom:16px;">${r?.error || 'Bilinmeyen hata'}</div>
                <button style="width:100%; padding:8px; background:rgba(150,100,100,0.5); border:1px solid rgba(200,150,150,0.3); border-radius:8px; color:#fff; cursor:pointer;" onclick="this.closest('div').remove();">Kapat</button>
              `;
              errorOverlay.appendChild(errorModal);
              document.body.appendChild(errorOverlay);
            }
          }).catch(e => {
            console.error(`[ISPA] ${callMethod} error:`, e);
            progressOverlay.remove();
            overlay.remove();
          });
        };
      });
    });
  }

  function showSettingsMenu(appId) {
    const overlay = document.createElement('div');
    overlay.className = 'ispa-overlay';
    overlay.style.zIndex = '999999';
    
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; 
      top: 50%; left: 50%; 
      transform: translate(-50%, -50%); 
      background: rgba(15,15,25,0.95); 
      backdrop-filter: blur(20px);
      border: 1px solid rgba(150,200,255,0.2);
      border-radius: 16px;
      padding: 24px;
      min-width: 400px;
      max-width: 600px;
      z-index: 1000000;
      color: #fff;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;
    
    modal.innerHTML = `
      <div style="font-weight:700; font-size:18px; margin-bottom:16px; text-align:center;">⚙️ Ayarlar</div>
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div style="padding:12px; background:rgba(100,200,230,0.1); border-radius:8px; border-left:3px solid rgba(100,200,230,0.5);">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="auto-fix" checked style="cursor:pointer;">
            <span>Otomatik Fix Uygula</span>
          </label>
        </div>
        <div style="padding:12px; background:rgba(100,200,230,0.1); border-radius:8px; border-left:3px solid rgba(100,200,230,0.5);">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="debug-mode" style="cursor:pointer;">
            <span>Debug Modu</span>
          </label>
        </div>
        <div style="padding:12px; background:rgba(100,200,230,0.1); border-radius:8px; border-left:3px solid rgba(100,200,230,0.5);">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="backup" checked style="cursor:pointer;">
            <span>Yedek Otomatik Oluştur</span>
          </label>
        </div>
      </div>
      <button style="width:100%; margin-top:16px; padding:8px; background:rgba(100,150,180,0.5); border:1px solid rgba(150,200,255,0.3); border-radius:8px; color:#fff; cursor:pointer;" onclick="this.closest('.ispa-overlay').remove();">Kapat</button>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function renderCompatibilityBadge() {
    ensureCompatCss();
    const existing = document.querySelector('.ispa-compat-wrap');
    if (existing) {
      // Badge zaten varsa, fix status'unu güncelle
      const appId = getCurrentAppId();
      if (appId) {
        createFixStatusBadge(appId);
      }
      return;
    }
    const appId = getCurrentAppId();
    const info = ispaAnalyzeCompat();
    ispaMakeBadge(info);
    if (appId) {
      createFixStatusBadge(appId);
    }
  }

  ensureStyles();
  addIspaButton();
  renderCompatibilityBadge();
  setTimeout(addIspaButton, 1000);
  setTimeout(addIspaButton, 3000);
  setTimeout(renderCompatibilityBadge, 500);
  setTimeout(renderCompatibilityBadge, 2000);
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => { addIspaButton(); renderCompatibilityBadge(); }).observe(document.body, { childList: true, subtree: true });
  }
})();
