// ============================================================
// HA Thermostat Card — Checkpoint v50 (Fixed)
// Fixes applied:
//   1. @import replaced with <link> injection for reliable font loading in shadow DOM
//   2. Default state values set in setConfig() to prevent NaN before hass loads
//   3. _dragging defaulted in setConfig() to prevent undefined access
//   4. window event listeners cleaned up in disconnectedCallback() to prevent leaks
//   5. connectedCallback guards against missing _entity before _build()
// ============================================================

class ThermostatCard extends HTMLElement {

  // ── Lifecycle ───────────────────────────────────────────────

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this._build();
    }
    // Re-attach window listeners if card was removed and re-added
    this._attachWindowListeners();
  }

  disconnectedCallback() {
    // Clean up window-level listeners to prevent leaks
    this._detachWindowListeners();
  }

  setConfig(config) {
    this._config     = config;
    this._entity     = config.entity || 'climate.living_room';
    this._notchAngle = 0;
    this._dragging   = false;
    this._cooldown          = false;
    this._notchInitialised  = false;

    // Safe defaults so _updateGlow() never sees undefined/NaN
    this._currentTemp = 19;
    this._setpoint    = 21;
    this._mode        = 'off';
    this._humidity     = null;
    this._friendlyName = '';
    this._minTemp      = 10;
    this._maxTemp      = 32;
    this._hvacModes    = ['heat','cool','heat_cool','off'];
    this._cardWidth    = config.card_width   || '360px';
    this._cardHeight   = config.card_height  || '80vh';

    // Dial
    this._dialScale    = config.dial_scale   || 1;
    this._dialY        = config.dial_y       || '0px';

    // Buttons
    this._btnScale     = config.btn_scale    || 1;
    this._btnY         = config.btn_y        || '0px';

    // Title
    this._titleScale   = config.title_scale  || 1;
    this._titleY       = config.title_y      || '0px';

    // Global opacity
    this._opacity      = config.opacity      !== undefined ? config.opacity : 1;

    // Popup mode
    this._popupMode    = config.popup_mode   || false;
    this._popupOffsetY = config.popup_offset_y || '0px';
    this._popupBlur    = config.popup_blur   !== undefined ? config.popup_blur : 8;
    this._popupScrim   = config.popup_scrim  || 'rgba(0,0,0,0.7)';



    this._applyDimensions();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._dragging || this._cooldown) return;

    const state = hass.states[this._entity];
    if (!state) return;

    this._currentTemp = state.attributes.current_temperature ?? 19;
    this._humidity    = state.attributes.humidity ?? null;
    this._setpoint    = state.attributes.temperature ?? 21;
    // Normalise heat_cool -> auto for internal UI use
    const rawMode = state.state ?? 'off';
    this._mode = rawMode === 'heat_cool' ? 'auto' : rawMode;
    this._friendlyName  = state.attributes.friendly_name ?? '';
    this._render();
  }

  static getConfigElement() {
    return document.createElement('thermostat-card-editor');
  }

  static getStubConfig() {
    return { entity: 'climate.living_room' };
  }

  // ── Build DOM ───────────────────────────────────────────────

  _build() {
    const root = this.shadowRoot;

    // Fix 1: inject <link> instead of @import — reliable in shadow DOM
    const fontLink = document.createElement('link');
    fontLink.rel  = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@100;200;300;400&display=swap';
    root.appendChild(fontLink);

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :host {
        display: block;
        font-family: 'DM Sans', sans-serif;
      }
      .wrap {
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; padding: 2rem 1rem 2rem;
        background: #0e0e0f; border-radius: 16px;
        position: relative;
        min-height: 80vh;
        width: 360px;
      }

      .close-btn {
        position: absolute;
        top: 12px;
        left: 14px;
        background: none;
        border: none;
        color: #555;
        font-size: 20px;
        cursor: pointer;
        line-height: 1;
        padding: 6px;
        border-radius: 50%;
        transition: color 0.2s;
        font-family: 'DM Sans', sans-serif;
      }
      .close-btn:hover { color: #aaa; }

      .room-label {
        font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
        color: #4a4a4c; margin-bottom: 5.2rem; font-weight: 400;
      }

      .dial-scene {
        position: relative; width: 240px; height: 240px;
        cursor: grab; user-select: none;
      }
      .dial-scene:active { cursor: grabbing; }

      .halo {
        position: absolute; inset: -22px; border-radius: 50%;
        background: radial-gradient(circle at 60% 25%, #1f1f22 0%, #111112 65%, #050506 100%);
        box-shadow:
          0 0 0 1px #1a1a1c,
          -6px 14px 54px rgba(0,0,0,0.98),
          inset 1px 1px 1px rgba(255,255,255,0.03);
      }

      .underglow {
        position: absolute; bottom: -40px; left: 50%;
        transform: translateX(-50%);
        border-radius: 50%; pointer-events: none;
        width: 220px; height: 100px; opacity: 0;
        transition: opacity 0.4s, width 0.4s, height 0.4s;
      }

      .dial-face {
        position: absolute; inset: 0; border-radius: 50%;
        background: radial-gradient(circle at 82% 5%, #585860 10%, #17171a 45%, #121212 58%);
        box-shadow:
          -6px 12px 24px rgba(0,0,0,0.95),
          inset -1px 2px 1px rgba(255,255,255,0.4),
          inset 10px -20px 24px rgba(0,0,0,0.1);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        transition: box-shadow 0.4s;
        z-index: 2;
      }

      .dial-face::before {
        content: ''; position: absolute; inset: 5px; border-radius: 50%;
        background: radial-gradient(circle at 75% 15%, transparent 50%, rgba(0,0,0,0.6) 100%);
        pointer-events: none;
      }

      .static-ring {
        position: absolute; inset: -16px; border-radius: 50%;
        pointer-events: none; z-index: 1;
      }
      .static-ring svg { width: 100%; height: 100%; }

      .notch-ring {
        position: absolute; inset: 0; border-radius: 50%;
        pointer-events: none; z-index: 3;
        transform: rotate(0deg);
        transition: none;
      }

      .dimple-notch {
        position: absolute;
        top: 10px; left: 50%;
        transform: translateX(-50%);
        width: 20px; height: 20px;
        border-radius: 50%;
        background: radial-gradient(circle at 25% 90%, #6a6a72 0%, #1e1e22 55%, #0a0a0d 100%);
        box-shadow:
          inset 0 3px 5px rgba(0,0,0,0.95),
          inset -1px 2px 2px rgba(255,255,255,0.12),
          0 1px 1px rgba(255,255,255,0.04),
          -1px 2px 3px rgba(0,0,0,0.45);
      }

      .temp-wrapper {
        position: relative;
        display: flex; align-items: center; justify-content: center;
        width: 100%; height: 64px;
        transform: translate(-10px, 8px);
      }

      .temp-current {
        font-size: 64px; font-weight: 100;
        color: rgba(255,255,255,0.5);
        line-height: 1; letter-spacing: -2px;
        pointer-events: none; text-align: center;
        text-shadow: -3px 4px 6px rgba(0,0,0,0.5);
      }

      .decimal-hero {
        position: absolute;
        font-size: 22px; font-weight: 300; color: #8a8a8f;
        top: 4px; left: calc(50% + 36px);
      }

      .setpoint-row {
        font-size: 13px; color: #5a5a5c;
        pointer-events: none; margin-top: 14px;
      }
      .setpoint-row span { color: #8a8a8c; font-weight: 400; }

      .humidity-row { font-size: 11px; color: #2e2e30; pointer-events: none; margin-top: 2px; }

      .mode-row { display: flex; gap: 8px; margin-top: 4.4rem; }

      .mode-btn {
        display: flex; flex-direction: column; align-items: center; gap: 5px;
        cursor: pointer; padding: 8px 14px; border-radius: 12px;
        border: 0.5px solid #222; background: #131315;
        transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
        min-width: 56px;
        box-shadow: -2px 4px 10px rgba(0,0,0,0.9);
      }
      .mode-btn.active {
        border-color: var(--mc,#444);
        background: color-mix(in srgb, var(--mc,#444) 10%, #131315);
        box-shadow: -1px 2px 4px rgba(0,0,0,0.2);
      }
      .mode-icon { font-size: 16px; line-height: 1; }
      .mode-text { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: #444; }
      .mode-btn.active .mode-text { color: var(--mc,#888); }

      /* ── Popup Mode ── */
      :host(.popup-mode) {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        background: var(--popup-scrim, rgba(0,0,0,0.7));
        backdrop-filter: blur(var(--popup-blur, 8px));
        -webkit-backdrop-filter: blur(var(--popup-blur, 8px));
        opacity: 0;
        transition: opacity 0.25s ease;
        padding-top: var(--popup-offset-y, 0px);
      }
      :host(.popup-mode.open) {
        opacity: 1;
      }
      :host(.popup-mode) .wrap {
        max-height: calc(100vh - var(--popup-offset-y, 0px));
        overflow: auto;
      }
    `;
    root.appendChild(style);

    const container = document.createElement('div');
    container.innerHTML = `
      <div class="wrap">
        <button class="close-btn" id="closeBtn">✕</button>
        <div class="room-label" id="roomLabel">Living Room</div>
        <div class="dial-scene" id="dialScene">
          <div class="halo"></div>
          <div class="underglow" id="underglow"></div>

          <div class="dial-face" id="dialFace">
            <div class="temp-wrapper">
              <span class="temp-current" id="currentDisp">--</span>
              <span class="decimal-hero" id="decimalDisp">.0°C</span>
            </div>
            <div class="setpoint-row"><span id="roomTempLabel">--</span>: <span id="setpointDisp">--°C</span></div>
            <div class="humidity-row" id="humidityDisp"></div>
          </div>

          <div class="static-ring">
            <svg viewBox="0 0 272 272" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="tickGlow" cx="80%" cy="10%" r="85%">
                  <stop offset="0%"   stop-color="rgba(255,255,255,0.35)"/>
                  <stop offset="35%"  stop-color="rgba(255,255,255,0.12)"/>
                  <stop offset="70%"  stop-color="rgba(0,0,0,0.5)"/>
                  <stop offset="100%" stop-color="rgba(0,0,0,0.85)"/>
                </radialGradient>
              </defs>
              <circle cx="136" cy="136" r="125"
                stroke="url(#tickGlow)" stroke-width="6"
                stroke-dasharray="1 13.08" stroke-linecap="butt"/>
            </svg>
          </div>

          <div class="notch-ring" id="notchRing">
            <div class="dimple-notch"></div>
          </div>
        </div>

        <div class="mode-row" id="modeRow">
          <div class="mode-btn" data-mode="heat" style="--mc:#ff5b00"><div class="mode-icon">🔥</div><div class="mode-text">Heat</div></div>
          <div class="mode-btn" data-mode="cool" style="--mc:#0084ff"><div class="mode-icon">❄️</div><div class="mode-text">Cool</div></div>
          <div class="mode-btn" data-mode="auto" style="--mc:#a78bfa"><div class="mode-icon">⚡</div><div class="mode-text">Auto</div></div>
          <div class="mode-btn" data-mode="off"  style="--mc:#555"><div class="mode-icon">○</div><div class="mode-text">Off</div></div>
        </div>
      </div>
    `;
    root.appendChild(container);

    this._bindEvents();
    this._applyDimensions();
  }

  // ── Events ──────────────────────────────────────────────────

  _bindEvents() {
    const root  = this.shadowRoot;
    const scene = root.getElementById('dialScene');

    const CENTER_TEMP = 21, TEMP_RANGE = 28;
    const NOTCH_MIN = -135, NOTCH_MAX = 135;
    let lastAngle = null;

    const getAngle = (e) => {
      const r  = scene.getBoundingClientRect();
      const cx = r.left + r.width  / 2;
      const cy = r.top  + r.height / 2;
      const x  = e.touches ? e.touches[0].clientX : e.clientX;
      const y  = e.touches ? e.touches[0].clientY : e.clientY;
      return Math.atan2(y - cy, x - cx) * 180 / Math.PI;
    };

    const angleDelta = (a, b) => {
      let d = a - b;
      if (d >  180) d -= 360;
      if (d < -180) d += 360;
      return d;
    };

    const onMove = (e) => {
      if (!this._dragging) return;
      if (e.cancelable) e.preventDefault();
      const a = getAngle(e), d = angleDelta(a, lastAngle);
      lastAngle = a;
      this._notchAngle = Math.max(NOTCH_MIN, Math.min(NOTCH_MAX, this._notchAngle + d));
      this._setpoint   = Math.round((CENTER_TEMP + (this._notchAngle / 270) * TEMP_RANGE) * 2) / 2;
      this._setpoint   = Math.max(this._minTemp, Math.min(this._maxTemp, this._setpoint));
      root.getElementById('notchRing').style.transform = `rotate(${this._notchAngle}deg)`;
      this._updateGlow();
    };

    const onEnd = () => {
      if (!this._dragging) return;
      this._dragging = false;
      this._callSetTemp();
      // Block hass state updates briefly so HA's echo doesn't snap the dial back
      this._cooldown = true;
      clearTimeout(this._cooldownTimer);
      this._cooldownTimer = setTimeout(() => { this._cooldown = false; }, 3000);
    };

    // Store bound handlers so we can remove them later (Fix 4)
    this._onMouseMove = onMove;
    this._onMouseUp   = onEnd;
    this._onTouchMove = onMove;
    this._onTouchEnd  = onEnd;

    scene.addEventListener('mousedown', e => {
      this._dragging = true;
      lastAngle = getAngle(e);
      e.preventDefault();
    });

    scene.addEventListener('touchstart', e => {
      this._dragging = true;
      lastAngle = getAngle(e);
      e.preventDefault();
    }, { passive: false });

    this._attachWindowListeners();

    // Close button — close popup_mode if active, otherwise fire Browser Mod close
    const closeBtn = root.getElementById('closeBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (this._popupMode) {
          this._closePopup();
        } else {
          this.dispatchEvent(new CustomEvent('ll-custom', {
            bubbles: true,
            composed: true,
            detail: { browser_mod: { service: 'browser_mod.close_popup' } }
          }));
        }
      });
    }

    // Escape key for popup mode (no outside-click — user must use X button)
    if (this._popupMode) {
      this._onEscape = (e) => { if (e.key === 'Escape') this._closePopup(); };
      document.addEventListener('keydown', this._onEscape);
    }

    root.getElementById('modeRow').addEventListener('click', e => {
      const btn = e.target.closest('[data-mode]');
      if (!btn) return;
      this._mode = btn.dataset.mode;
      this._updateModeButtons();
      this._updateGlow();
      this._callSetMode();
    });
  }

  _applyDimensions() {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;

    // Popup mode styling
    if (this._popupMode) {
      this.classList.add('popup-mode');
      this.style.setProperty('--popup-offset-y', this._popupOffsetY || '0px');
      this.style.setProperty('--popup-blur',     `${this._popupBlur || 8}px`);
      this.style.setProperty('--popup-scrim',    this._popupScrim || 'rgba(0,0,0,0.7)');
      // Trigger fade-in on next frame
      requestAnimationFrame(() => this.classList.add('open'));
    }

    const wrap = root.querySelector('.wrap');
    if (wrap) {
      wrap.style.width     = this._cardWidth  || '360px';
      wrap.style.minHeight = this._cardHeight || '80vh';
      wrap.style.opacity   = this._opacity    !== undefined ? this._opacity : 1;
    }

    const dial = root.querySelector('.dial-scene');
    if (dial) {
      // translateY first, then scale — keeps horizontal centering intact
      dial.style.transform       = `translateY(${this._dialY || '0px'}) scale(${this._dialScale || 1})`;
      dial.style.transformOrigin = '50% 50%';
      dial.style.position        = 'static';
    }

    const btnRow = root.querySelector('.mode-row');
    if (btnRow) {
      btnRow.style.transform       = `translateY(${this._btnY || '0px'}) scale(${this._btnScale || 1})`;
      btnRow.style.transformOrigin = '50% 50%';
      btnRow.style.marginTop       = '0px';
    }

    const title = root.querySelector('.room-label');
    if (title) {
      title.style.transform       = `translateY(${this._titleY || '0px'}) scale(${this._titleScale || 1})`;
      title.style.transformOrigin = '50% 50%';
      title.style.marginTop       = '0px';
    }
  }

  _attachWindowListeners() {
    if (this._listenersAttached) return;
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup',   this._onMouseUp);
    window.addEventListener('touchmove', this._onTouchMove, { passive: false });
    window.addEventListener('touchend',  this._onTouchEnd);
    this._listenersAttached = true;
  }

  _detachWindowListeners() {
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup',   this._onMouseUp);
    window.removeEventListener('touchmove', this._onTouchMove);
    window.removeEventListener('touchend',  this._onTouchEnd);
    this._listenersAttached = false;
  }

  // ── HA Service Calls ─────────────────────────────────────────

  _closePopup() {
    this.classList.remove('open');
    // Wait for fade out, then remove from DOM
    setTimeout(() => {
      if (this._onEscape) document.removeEventListener('keydown', this._onEscape);
      this.remove();
    }, 250);
  }

  _callSetTemp() {
    if (!this._hass) return;
    this._hass.callService('climate', 'set_temperature', {
      entity_id: this._entity,
      temperature: this._setpoint
    });
  }

  _callSetMode() {
    if (!this._hass) return;
    // Map internal 'auto' to 'heat_cool' if entity doesn't support auto
    let mode = this._mode;
    if (mode === 'auto' && !this._hvacModes.includes('auto') && this._hvacModes.includes('heat_cool')) {
      mode = 'heat_cool';
    }
    this._hass.callService('climate', 'set_hvac_mode', {
      entity_id: this._entity,
      hvac_mode: mode
    });
  }

  // ── Render Helpers ───────────────────────────────────────────

  _updateModeButtons() {
    this.shadowRoot.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === this._mode);
    });
  }

  _updateGlow() {
    const root      = this.shadowRoot;
    if (!root) return;
    const underglow = root.getElementById('underglow');
    const dialFace  = root.getElementById('dialFace');
    if (!underglow || !dialFace) return;

    const DECORATIVE_SHADOWS = [
      '-6px 12px 24px rgba(0,0,0,0.95)',
      'inset -1px 2px 1px rgba(255,255,255,0.4)',
      'inset 10px -20px 24px rgba(0,0,0,0.1)'
    ];

    let filamentColor = '';
    let ambientGlow   = '';
    let t             = 0;

    const isHeating = this._mode === 'heat' || (this._mode === 'auto' && this._setpoint >= this._currentTemp);
    const isCooling = this._mode === 'cool' || (this._mode === 'auto' && this._setpoint  < this._currentTemp);

    if (isHeating) {
      ambientGlow = '255,45,0';
      if (this._setpoint > this._currentTemp) {
        const range = Math.max(1, 24 - this._currentTemp);
        t = Math.min(1, (this._setpoint - this._currentTemp) / range);
      }
      filamentColor = `rgba(255,60,0,${(0.8 + t * 0.2).toFixed(2)})`;

    } else if (isCooling) {
      ambientGlow = '0,80,255';
      if (this._setpoint < this._currentTemp) {
        const range = Math.max(1, this._currentTemp - 17);
        t = Math.min(1, (this._currentTemp - this._setpoint) / range);
      }
      filamentColor = `rgba(0,102,255,${(0.8 + t * 0.2).toFixed(2)})`;
    }

    if (filamentColor && t > 0) {
      const spread = Math.round(1 + t * 2);
      const blur   = Math.round(12 + t * 14);

      underglow.style.opacity    = (0.3 + t * 0.4).toFixed(2);
      underglow.style.background = `radial-gradient(ellipse at 50% 0%, rgba(${ambientGlow},0.8) 0%, rgba(${ambientGlow},0.1) 60%, transparent 80%)`;
      underglow.style.width      = `${190 + t * 90}px`;
      underglow.style.height     = `${80  + t * 70}px`;
      underglow.style.filter     = `blur(${10 + t * 4}px)`;

      dialFace.style.boxShadow = [
        `0 ${spread}px 0px 1px ${filamentColor}`,
        `0 ${spread + 1}px 4px 1px ${filamentColor}`,
        `-4px ${4 + t * 5}px ${blur}px ${spread + 2}px rgba(${ambientGlow},${(0.6 + t * 0.2).toFixed(2)})`,
        `inset -2px -12px 24px rgba(${ambientGlow},${(t * 0.25).toFixed(2)})`,
        ...DECORATIVE_SHADOWS
      ].join(', ');

    } else {
      underglow.style.opacity  = '0';
      dialFace.style.boxShadow = DECORATIVE_SHADOWS.join(', ');
    }

    // Update display
    const str   = (this._setpoint ?? 21).toFixed(1);
    const parts = str.split('.');
    const currentDisp  = root.getElementById('currentDisp');
    const decimalDisp  = root.getElementById('decimalDisp');
    const setpointDisp = root.getElementById('setpointDisp');
    if (currentDisp)  currentDisp.textContent  = parts[0];
    if (decimalDisp)  decimalDisp.textContent  = `.${parts[1]}°C`;
    if (setpointDisp) setpointDisp.textContent = `${(this._currentTemp ?? 19).toFixed(1)}°C`;
    const roomTempLabel = root.getElementById('roomTempLabel');
    if (roomTempLabel) roomTempLabel.textContent = this._friendlyName || 'Room';
  }

  _render() {
    if (!this.shadowRoot) return;
    const root  = this.shadowRoot;
    this._applyDimensions();
    const state = this._hass?.states[this._entity];

    if (state?.attributes?.friendly_name) {
      const label = root.getElementById('roomLabel');
      if (label) label.textContent = state.attributes.friendly_name.toUpperCase();
    }

    if (this._humidity != null) {
      const hEl = root.getElementById('humidityDisp');
      if (hEl) hEl.textContent = `${this._humidity}%`;
    }

    // Only sync notch angle from setpoint on first load
    const CENTER_TEMP = 21, TEMP_RANGE = 28;
    this._setpoint = Math.max(this._minTemp, Math.min(this._maxTemp, this._setpoint));
    if (!this._notchInitialised) {
      this._notchAngle = ((this._setpoint - CENTER_TEMP) / TEMP_RANGE) * 270;
      this._notchAngle = Math.max(-135, Math.min(135, this._notchAngle));
      this._notchInitialised = true;
    }
    const notch = root.getElementById('notchRing');
    if (notch) notch.style.transform = `rotate(${this._notchAngle}deg)`;

    this._updateModeButtons();
    this._updateGlow();
  }
}

customElements.define('thermostat-card', ThermostatCard);

// Global helper to open a thermostat popup from any other card
// Usage:  window.openThermostatCard({ entity: 'climate.living_room', ...otherConfig })
window.openThermostatCard = function(config) {
  if (!config || !config.entity) {
    console.warn('openThermostatCard: missing entity');
    return;
  }
  // If a popup is already open, close it first
  document.querySelectorAll('thermostat-card.popup-mode').forEach(el => el.remove());

  const card = document.createElement('thermostat-card');
  card.setConfig({ ...config, popup_mode: true });
  document.body.appendChild(card);

  const haRoot = document.querySelector('home-assistant');
  // Set hass directly first to ensure initial render gets fresh state
  if (haRoot?.hass) {
    card.hass = haRoot.hass;
  }
  // Then subscribe to updates so it stays in sync
  if (haRoot && typeof haRoot.provideHass === 'function') {
    haRoot.provideHass(card);
  }
};

// Global helper for fire-dom-event integration (honeycomb-menu pattern)
// Usage in any card's tap_action:
//   tap_action:
//     action: fire-dom-event
//     thermostat_card:
//       entity: climate.living_room
//       card_width: 350px
//       ...
window.thermostat_card = function(config) {
  window.openThermostatCard(config);
};

// Listen for ll-custom events at the document level — same mechanism honeycomb-menu uses
document.body.addEventListener('ll-custom', (e) => {
  if (e.detail && e.detail.thermostat_card) {
    window.thermostat_card(e.detail.thermostat_card);
  }
});
