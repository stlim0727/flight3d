import { listAddons, loadAddonCatalog, buildAddonProfileUrl, resolveCatalogUrl } from '../addons/addonCatalogBrowser.js';
import { loadBaseAddonPrCatalog } from '../addons/baseAddonRegistry.js';
import {
  clearSavedAddonProfile, loadSavedAddonProfile, mergeSelectedAddons,
  removeSavedAddonPin, saveAddonCatalogUrl,
} from '../addons/savedAddonProfile.js';

const LABELS = {
  title: '애드온',
  hint: '기본 카탈로그, 커스텀 URL 또는 기본 레포 PR 번호(#123)로 애드온을 불러오세요. 저장하면 기본 주소에서도 적용됩니다.',
  catalogUrl: '카탈로그 URL',
  load: '불러오기',
  clearUrl: '주소 지우기',
  baseLoad: '기본 카탈로그',
  prNumber: 'PR 번호 (기본 레포)',
  prLoad: 'PR 불러오기',
  prStatusVerified: 'CI 검증 완료',
  urlCleared: '카탈로그 주소를 지웠습니다.',
  search: '검색',
  all: '전체',
  region: '지역',
  aircraft: '기체',
  scenario: '시나리오',
  compatible: '호환',
  incompatible: '미호환',
  empty: '표시할 애드온이 없습니다.',
  share: '선택 공유 링크 만들기',
  apply: '선택 추가',
  savedTitle: '적용된 애드온',
  savedEmpty: '저장된 애드온이 없습니다.',
  savedRemove: '이 애드온만 제거',
  remove: '저장된 애드온 모두 제거',
  shareReady: '공유 링크가 준비되었습니다.',
  copy: '링크 복사',
  copied: '링크를 복사했습니다.',
  copyFailed: '링크를 복사하지 못했습니다. 주소를 직접 선택해 복사하세요.',
  applyReady: '선택한 애드온을 추가했습니다. 기본 주소에서도 적용됩니다.',
  removeReady: '저장된 애드온을 제거했습니다. 기본 주소에서 더 이상 사용하지 않습니다.',
  error: '애드온 카탈로그를 불러오지 못했습니다.',
  saveError: '선택한 애드온을 저장하지 못했습니다.',
};

export class AddonPicker {
  constructor({ catalogUrl = '', defaultCatalogUrl = '', coreVersion, profileShareParams, fetchImpl, validateCatalog, storage, prLoader, onApplied = () => {}, labels = LABELS } = {}) {
    this.catalogUrl = catalogUrl;
    this.defaultCatalogUrl = defaultCatalogUrl;
    this.coreVersion = coreVersion;
    this.profileShareParams = profileShareParams;
    this.fetchImpl = fetchImpl;
    this.validateCatalog = validateCatalog;
    this.storage = storage;
    this.prLoader = prLoader ?? (prInput => loadBaseAddonPrCatalog(prInput, {
      fetchImpl: this.fetchImpl,
      coreVersion: this.coreVersion,
    }));
    this.onApplied = onApplied;
    this.labels = labels;
    this.catalog = null;
    this.activePr = null;
    this.search = '';
    this.kind = 'all';
    this.selected = new Set();
    this.loadSeq = 0;
    this.root = null;
  }

  mount(parent) {
    if (!parent) return this.root;
    this.root = document.createElement('section');
    this.root.className = 'addon-picker';
    this.root.innerHTML = `
      <h3>${this.labels.title}</h3>
      <p class="addon-picker-hint">${this.labels.hint}</p>
      <div class="addon-picker-url">
        <label><span>${this.labels.catalogUrl}</span><input type="url" class="addon-catalog-url" placeholder="https://.../catalog.json"></label>
        <button type="button" class="btn addon-catalog-load">${this.labels.load}</button>
        <button type="button" class="btn addon-catalog-clear">${this.labels.clearUrl}</button>
      </div>
      <div class="addon-picker-pr">
        <label><span>${this.labels.prNumber}</span><input type="text" class="addon-pr-number" placeholder="#42"></label>
        <button type="button" class="btn addon-pr-load">${this.labels.prLoad}</button>
        ${this.defaultCatalogUrl ? `<button type="button" class="btn addon-base-load">${this.labels.baseLoad}</button>` : ''}
      </div>
      <div class="addon-picker-filters" hidden>
        <input type="search" class="addon-search" placeholder="${this.labels.search}" aria-label="${this.labels.search}">
        <div class="addon-kind-buttons" role="group">
          ${['all', 'region', 'aircraft', 'scenario'].map(kind => `<button type="button" class="btn addon-kind" data-kind="${kind}" aria-pressed="${kind === 'all'}">${this.labels[kind]}</button>`).join('')}
        </div>
      </div>
      <div class="addon-saved">
        <h4>${this.labels.savedTitle}</h4>
        <div class="addon-saved-list" role="list"></div>
      </div>
      <div class="addon-list" role="list"></div>
      <p class="addon-picker-status" role="status" aria-live="polite"></p>
      <button type="button" class="btn addon-apply" hidden>${this.labels.apply}</button>
      <button type="button" class="btn addon-remove" hidden>${this.labels.remove}</button>
      <button type="button" class="btn addon-share" hidden>${this.labels.share}</button>
      <div class="addon-share-actions" hidden>
        <a class="addon-share-link" target="_blank" rel="noopener noreferrer"></a>
        <button type="button" class="btn addon-share-copy">${this.labels.copy}</button>
      </div>`;

    parent.appendChild(this.root);
    this.urlInput = this.root.querySelector('.addon-catalog-url');
    this.urlInput.value = this.catalogUrl;
    this.prInput = this.root.querySelector('.addon-pr-number');
    this.prLoadBtn = this.root.querySelector('.addon-pr-load');
    this.baseLoadBtn = this.root.querySelector('.addon-base-load');
    this.filters = this.root.querySelector('.addon-picker-filters');
    this.list = this.root.querySelector('.addon-list');
    this.savedList = this.root.querySelector('.addon-saved-list');
    this.status = this.root.querySelector('.addon-picker-status');
    this.applyBtn = this.root.querySelector('.addon-apply');
    this.removeBtn = this.root.querySelector('.addon-remove');
    this.shareBtn = this.root.querySelector('.addon-share');
    this.shareActions = this.root.querySelector('.addon-share-actions');
    this.shareLink = this.root.querySelector('.addon-share-link');
    this.shareCopyBtn = this.root.querySelector('.addon-share-copy');
    this.syncRemoveButton();

    this.root.querySelector('.addon-catalog-load').addEventListener('click', () => this.load(resolveCatalogUrl(this.urlInput.value)));
    this.root.querySelector('.addon-catalog-clear').addEventListener('click', () => this.clearUrl());
    this.prLoadBtn?.addEventListener('click', () => this.loadPr(this.prInput?.value ?? ''));
    this.baseLoadBtn?.addEventListener('click', () => this.loadBase());
    this.root.querySelector('.addon-search').addEventListener('input', event => {
      this.search = event.target.value;
      this.render();
    });
    for (const button of this.root.querySelectorAll('.addon-kind')) {
      button.addEventListener('click', () => {
        this.kind = button.dataset.kind;
        for (const other of this.root.querySelectorAll('.addon-kind')) {
          other.setAttribute('aria-pressed', String(other === button));
        }
        this.render();
      });
    }
    this.applyBtn.addEventListener('click', () => this.apply());
    this.removeBtn.addEventListener('click', () => this.remove());
    this.shareBtn.addEventListener('click', () => this.share());
    this.shareCopyBtn.addEventListener('click', () => this.copyShareLink());
    if (this.catalogUrl) this.load(resolveCatalogUrl(this.catalogUrl)).catch(() => {});
    return this.root;
  }

  hideShareLink() {
    if (!this.shareActions) return;
    this.shareActions.hidden = true;
    this.shareLink.removeAttribute('href');
    this.shareLink.textContent = '';
  }

  clearUrl() {
    this.loadSeq += 1;
    this.urlInput.value = '';
    if (this.prInput) this.prInput.value = '';
    this.catalogUrl = '';
    this.catalog = null;
    this.activePr = null;
    this.selected.clear();
    this.search = '';
    this.kind = 'all';
    this.filters.hidden = true;
    this.list.replaceChildren();
    this.applyBtn.hidden = true;
    this.shareBtn.hidden = true;
    this.hideShareLink();
    clearSavedAddonProfile(this.storage);
    saveAddonCatalogUrl('', { storage: this.storage });
    this.syncRemoveButton();
    this.status.textContent = this.labels.urlCleared;
  }

  async copyShareLink() {
    if (!this.shareLink?.href) return;
    try {
      await navigator.clipboard.writeText(this.shareLink.href);
      this.status.textContent = this.labels.copied;
    } catch {
      this.status.textContent = this.labels.copyFailed;
    }
  }

  syncRemoveButton() {
    const saved = loadSavedAddonProfile(this.storage);
    if (this.removeBtn) this.removeBtn.hidden = !saved;
    this.renderSaved(saved);
  }

  renderSaved(saved = loadSavedAddonProfile(this.storage)) {
    if (!this.savedList) return;
    this.savedList.replaceChildren();
    if (!saved?.pins?.length) {
      const empty = document.createElement('p');
      empty.textContent = this.labels.savedEmpty;
      this.savedList.appendChild(empty);
      return;
    }
    for (const pin of saved.pins) {
      const item = document.createElement('div');
      item.className = 'addon-saved-item';
      item.setAttribute('role', 'listitem');
      const body = document.createElement('span');
      body.className = 'addon-item-body';
      const title = document.createElement('strong');
      title.textContent = `${pin.id} · ${pin.version}`;
      body.appendChild(title);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn addon-saved-remove';
      remove.textContent = this.labels.savedRemove;
      remove.addEventListener('click', () => this.removePin(pin.id, pin.version));
      item.append(body, remove);
      this.savedList.appendChild(item);
    }
  }

  removePin(id, version) {
    try {
      removeSavedAddonPin(id, version, { storage: this.storage });
    } catch (error) {
      this.status.textContent = `${this.labels.saveError}: ${error.message}`;
      return false;
    }
    this.selected.delete(id);
    if (this.catalog) this.render();
    else this.syncRemoveButton();
    this.status.textContent = this.labels.removeReady;
    return true;
  }

  applyCatalog(catalog, { catalogUrl = '', activePr = null, status = '' } = {}) {
    this.catalog = catalog;
    this.catalogUrl = catalogUrl;
    this.activePr = activePr;
    const saved = loadSavedAddonProfile(this.storage);
    if (saved) {
      for (const pin of saved.pins) {
        if (catalog.addons.some(entry => entry.id === pin.id && entry.version === pin.version
          && entry.compatible !== false)) this.selected.add(pin.id);
      }
    }
    this.filters.hidden = false;
    this.status.textContent = status;
    this.render();
  }

  failCatalogLoad(error) {
    this.catalog = null;
    this.activePr = null;
    this.filters.hidden = true;
    this.list.replaceChildren();
    this.applyBtn.hidden = true;
    this.syncRemoveButton();
    this.shareBtn.hidden = true;
    this.status.textContent = `${this.labels.error}: ${error.message}`;
  }

  async load(url) {
    const seq = ++this.loadSeq;
    this.activePr = null;
    this.selected.clear();
    if (this.applyBtn) this.applyBtn.hidden = true;
    this.hideShareLink();
    try {
      const catalog = await loadAddonCatalog(url, {
        fetchImpl: this.fetchImpl,
        validate: this.validateCatalog,
      });
      if (seq !== this.loadSeq) return;
      this.applyCatalog(catalog, { catalogUrl: resolveCatalogUrl(url) });
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this.failCatalogLoad(error);
    }
  }

  async loadBase() {
    if (!this.defaultCatalogUrl) return null;
    if (this.urlInput) this.urlInput.value = this.defaultCatalogUrl;
    if (this.prInput) this.prInput.value = '';
    return this.load(this.defaultCatalogUrl);
  }

  async loadPr(prInput) {
    const seq = ++this.loadSeq;
    this.activePr = null;
    this.selected.clear();
    if (this.applyBtn) this.applyBtn.hidden = true;
    this.hideShareLink();
    try {
      const preview = await this.prLoader(prInput);
      if (seq !== this.loadSeq) return null;
      this.applyCatalog(preview.catalog, {
        catalogUrl: '',
        activePr: {
          prNumber: preview.prNumber,
          headSha: preview.headSha,
          checkName: preview.checkName,
        },
        status: `PR #${preview.prNumber} (${this.labels.prStatusVerified} · ${preview.headSha.slice(0, 7)})`,
      });
      return preview;
    } catch (error) {
      if (seq !== this.loadSeq) return null;
      this.failCatalogLoad(error);
      return null;
    }
  }

  render() {
    if (!this.catalog || !this.list) return;
    const entries = listAddons(this.catalog, { search: this.search, kind: this.kind });
    this.list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = this.labels.empty;
      this.list.appendChild(empty);
    }
    for (const entry of entries) {
      const item = document.createElement('label');
      item.className = 'addon-item';
      item.setAttribute('role', 'listitem');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = entry.id;
      checkbox.checked = this.selected.has(entry.id);
      checkbox.disabled = !entry.compatible;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) this.selected.add(entry.id);
        else this.selected.delete(entry.id);
        this.applyBtn.hidden = this.selected.size === 0;
        this.shareBtn.hidden = this.selected.size === 0;
        this.hideShareLink();
      });
      const body = document.createElement('span');
      body.className = 'addon-item-body';
      const title = document.createElement('strong');
      title.textContent = `${entry.title} · ${entry.version}`;
      const meta = document.createElement('small');
      meta.textContent = `${this.labels[entry.kind]} · ${entry.publisher} · ${entry.compatible ? this.labels.compatible : this.labels.incompatible}`;
      body.append(title, meta);
      item.append(checkbox, body);
      this.list.appendChild(item);
    }
    this.applyBtn.hidden = this.selected.size === 0;
    this.syncRemoveButton();
    this.shareBtn.hidden = this.selected.size === 0;
  }

  apply() {
    if (!this.catalog || this.selected.size === 0) return false;
    try {
      mergeSelectedAddons(this.catalog, [...this.selected], {
        coreVersion: this.coreVersion ?? null,
        storage: this.storage,
      });
      if (this.catalogUrl) saveAddonCatalogUrl(this.catalogUrl, { storage: this.storage });
      this.status.textContent = this.labels.applyReady;
      this.render();
      this.onApplied?.();
      return true;
    } catch (error) {
      this.status.textContent = `${this.labels.saveError}: ${error.message}`;
      return false;
    }
  }

  remove() {
    clearSavedAddonProfile(this.storage);
    this.status.textContent = this.labels.removeReady;
    this.syncRemoveButton();
    if (this.catalog) this.render();
    this.onApplied?.();
    return true;
  }

  share() {
    if (!this.catalog || this.selected.size === 0 || !this.profileShareParams) return '';
    const url = buildAddonProfileUrl(this.catalog, [...this.selected], {
      coreVersion: this.coreVersion ?? null,
      profileShareParams: this.profileShareParams,
      baseUrl: typeof location === 'undefined' ? '?' : `${location.origin}${location.pathname}?`,
    });
    this.shareLink.href = url;
    this.shareLink.textContent = url;
    this.shareActions.hidden = false;
    this.status.textContent = this.labels.shareReady;
    return url;
  }
}
