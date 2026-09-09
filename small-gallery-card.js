const TRANSLATIONS = {
  en: {
    delete_file: "Delete file",
    reload: "Reload",
    delete_all: "Delete all files",
    no_media: "No media available",
    confirm_delete_single: 'Delete "{title}"?',
    confirm_delete_all: 'Delete all {count} files?',
    load_more: "Load more..."
  },
  de: {
    delete_file: "Datei löschen",
    reload: "Neu laden",
    delete_all: "Alle Dateien löschen",
    no_media: "Keine Medien vorhanden",
    confirm_delete_single: '"{title}" löschen?',
    confirm_delete_all: 'Alle {count} Dateien löschen?',
    load_more: "Mehr laden..."
  }
};

function localize(hass, key, placeholders = {}) {
  const lang = (hass && hass.language) ? hass.language.split('-')[0] : 'en';
  const text = (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) 
    ? TRANSLATIONS[lang][key] 
    : (TRANSLATIONS['en'][key] || key);

  return Object.entries(placeholders).reduce(
    (str, [pKey, pVal]) => str.replace(`{${pKey}}`, pVal), 
    text
  );
}

class SmallGalleryCard extends HTMLElement {
  setConfig(config) {
    if (!config.media_path) throw new Error("Missing configuration: 'media_path' must be specified.");
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.content) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `
        <style>
          ha-card { width: 100%; max-width: calc(100% - 20px); margin: 10px auto; position: relative; padding: 16px; box-sizing: border-box; }
          .actions { flex: 0 0 auto; display: flex; flex-direction: column; gap: 10px; }
          .actions ha-icon, #delete-single { cursor: pointer; color: var(--secondary-text-color); }
          .actions ha-icon:hover, #delete-single:hover { color: var(--primary-text-color); }
          .actions ha-icon.del:hover, #delete-single:hover { color: var(--error-color, #db4437); }

          .container { display: flex; align-items: flex-start; gap: 10px; width: 100%; height: 90vh; min-height: 400px; box-sizing: border-box; }
          .main { flex: 1; min-width: 0; height: 75vh; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; }
          .main img, .main video { max-height: calc(100% - 28px); width: auto; max-width: 100%; object-fit: contain; }
          .main-footer { display: flex; align-items: center; justify-content: flex-start; gap: 8px; margin-top: 4px; max-width: 100%; }
          .caption { font-size: 12px; color: var(--primary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

          .thumbs { flex: 0 0 20%; height: 100%; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
          .thumb-item { display: flex; flex-direction: column; align-items: center; cursor: pointer; width: 100%; }
          .thumb-item img, .thumb-item video { width: 100%; opacity: 0.7; border-radius: 4px; box-sizing: border-box; pointer-events: none; }
          .thumb-item:hover img, .thumb-item.active img, .thumb-item:hover video, .thumb-item.active video { opacity: 1; border: 2px solid var(--primary-color); }
          .load-more { cursor: pointer; color: var(--primary-color); font-weight: bold; padding: 10px 0; text-align: center; font-size: 13px; }
          .load-more:hover { text-decoration: underline; }
        </style>
        <ha-card header="${this._config.title || ''}">
          <div class="container">
            <div class="main">
              <img id="viewer" src="" />
              <video id="video-viewer" controls muted style="display:none;"></video>
              <div class="main-footer">
                <span id="main-caption" class="caption"></span>
                <ha-icon id="delete-single" icon="mdi:delete" title="${localize(this._hass, 'delete_file')}"></ha-icon>
              </div>
            </div>
            <div class="thumbs" id="thumbs"></div>
            <div class="actions">
              <ha-icon id="refresh" icon="mdi:refresh" title="${localize(this._hass, 'reload')}"></ha-icon>
              <ha-icon id="delete-all" class="del" icon="mdi:delete-sweep" title="${localize(this._hass, 'delete_all')}"></ha-icon>
            </div>
          </div>
        </ha-card>
      `;
      this.content = true;
      const $ = id => this.shadowRoot.getElementById(id);
      $('refresh').onclick = () => this._loadImages();
      $('delete-all').onclick = () => this._delete(true);
      $('delete-single').onclick = () => this._delete(false);
      this._loadImages();
    }
  }

  _extractDate(title) {
    const format = this._config.date_format;
    if (!format) return 0;

    const nameWithoutExt = title.substring(0, title.lastIndexOf('.')) || title;
    const dateStr = (this._config.date_position || 'end') === 'start'
      ? nameWithoutExt.substring(0, format.length)
      : nameWithoutExt.slice(-format.length);

    if (dateStr.length !== format.length) return 0;

    // Standardwerte festlegen
    let year = 2000;
    let month = 0; // Januar
    let day = 1;
    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    const getVal = (token) => {
      const idx = format.indexOf(token);
      if (idx === -1) return null;
      const val = parseInt(dateStr.substring(idx, idx + token.length), 10);
      return isNaN(val) ? null : val;
    };

    const yyyy = getVal('YYYY');
    const yy = getVal('YY');
    if (yyyy !== null) year = yyyy;
    else if (yy !== null) year = 2000 + yy;

    const mm = getVal('MM');
    if (mm !== null) month = mm - 1;

    const dd = getVal('DD');
    if (dd !== null) day = dd;

    const hh = getVal('HH') ?? getVal('hh');
    if (hh !== null) hours = hh;

    const min = getVal('mm');
    if (min !== null) minutes = min;

    const ss = getVal('ss');
    if (ss !== null) seconds = ss;

    const parsedDate = new Date(year, month, day, hours, minutes, seconds);
    return isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime();
  }

  async _loadImages() {
    try {
      const res = await this._hass.callWS({ type: "media_source/browse_media", media_content_id: this._config.media_path });
      // HINWEIS: Sortierung schaltet automatisch auf 'date' um, sobald 'date_format' in der Config steht
      const sortBy = (this._config.sort_by || (this._config.date_format ? 'date' : 'name')).toLowerCase();
      const order = (this._config.order || 'asc').toLowerCase();

      this._files = (res.children || []).filter(i => i.media_class === "image" || i.media_class === "video")
        .sort((a, b) => {
          let diff = 0;
          if (sortBy === 'date') {
            diff = this._extractDate(a.title) - this._extractDate(b.title);
          }
          if (diff === 0) {
            diff = a.title.localeCompare(b.title, undefined, { numeric: true });
          }
          return order === 'desc' ? -diff : diff;
        });

      this._currentLimit = this._config.max_files || 30;
      this._renderThumbs();
    } catch (err) { console.error("Small Gallery Card Error:", err); }
  }

  async _renderThumbs() {
    const thumbs = this.shadowRoot.getElementById('thumbs');
    thumbs.innerHTML = '';
    
    const hasFiles = this._files.length > 0;
    this.shadowRoot.getElementById('delete-all').style.display = hasFiles ? '' : 'none';
    this.shadowRoot.getElementById('delete-single').style.display = hasFiles ? '' : 'none';
    this.shadowRoot.getElementById('viewer').style.display = hasFiles ? '' : 'none';
    this.shadowRoot.getElementById('video-viewer').style.display = 'none';

    if (!hasFiles) {
      this.shadowRoot.getElementById('main-caption').textContent = localize(this._hass, 'no_media');
      this._active = null;
      return;
    }

    const filesToShow = this._files.slice(0, this._currentLimit);

    const elements = await Promise.all(filesToShow.map(async (file, index) => {
      const r = await this._hass.callWS({ type: "media_source/resolve_media", media_content_id: file.media_content_id });
      const item = document.createElement('div');
      item.className = 'thumb-item' + (index === 0 && !this._active ? ' active' : '');
      item.dataset.id = file.media_content_id;
      
      const mediaTag = file.media_class === "video" ? `<video src="${r.url}#t=0.5" preload="metadata"></video>` : `<img src="${r.url}" />`;
      item.innerHTML = mediaTag + '<div class="caption"></div>';
      item.querySelector('.caption').textContent = file.title;
      
      // Stelle sicher, dass die aktive Markierung beim Nachladen erhalten bleibt
      if (this._active && this._active.media_content_id === file.media_content_id) {
        item.classList.add('active');
      }

      if (index === 0 && !this._active) this._select(file, r.url, item);
      item.onclick = () => this._select(file, r.url, item);
      return item;
    }));
    
    elements.forEach(el => thumbs.appendChild(el));

    // "Mehr laden" Button anzeigen, wenn noch Dateien übrig sind
    if (this._files.length > this._currentLimit) {
      const btn = document.createElement('div');
      btn.className = 'load-more';
      btn.textContent = localize(this._hass, 'load_more');
      btn.onclick = () => {
        this._currentLimit += (this._config.max_files || 30);
        this._renderThumbs();
      };
      thumbs.appendChild(btn);
    }
  }

  _select(file, url, item) {
    this._active = file;
    const img = this.shadowRoot.getElementById('viewer');
    const vid = this.shadowRoot.getElementById('video-viewer');
    const isVid = file.media_class === "video";
    img.style.display = isVid ? 'none' : '';
    img.src = isVid ? '' : url;
    vid.style.display = isVid ? '' : 'none';
    if (isVid) { vid.pause(); vid.src = url; } else { vid.pause(); vid.src = ''; }

    this.shadowRoot.getElementById('main-caption').textContent = file.title;
    
    this.shadowRoot.querySelectorAll('.thumb-item').forEach(el => {
      if (el.dataset.id === file.media_content_id) el.classList.add('active');
      else el.classList.remove('active');
    });
  }

  async _delete(all) {
    const list = all ? this._files : (this._active ? [this._active] : []);
    const confirmMsg = all 
      ? localize(this._hass, 'confirm_delete_all', { count: list.length }) 
      : localize(this._hass, 'confirm_delete_single', { title: this._active.title });

    if (!list.length || !confirm(confirmMsg)) return;

    try {
      for (const file of list) {
        const path = file.media_content_id.replace(/^media-source:\/\/media_source\/local\/?/, '');
        await this._hass.callService('shell_command', 'del_gallery_file', { path });
      }
    } catch (err) { console.error("Small Gallery Card Delete Error:", err); }
    this._active = null; // Setze aktive Auswahl nach dem Löschen zurück
    this._loadImages();
  }

  getCardSize() { return 3; }
}

customElements.define('small-gallery-card', SmallGalleryCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "small-gallery-card",
  name: "Small Gallery Card",
  description: "Small gallery card for local images or videos."
});