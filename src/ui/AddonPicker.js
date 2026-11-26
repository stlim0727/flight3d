import { listAddons, loadAddonCatalog, buildAddonProfileUrl } from '../addons/addonCatalogBrowser.js';
import { clearSavedAddonProfile, loadSavedAddonProfile, saveSelectedAddons } from '../addons/savedAddonProfile.js';

const LABELS = {
  title: '애드온',
  hint: '카탈로그 URL을 넣고 비행에 사용할 애드온을 고르세요. 저장하면 기본 주소에서도 적용됩니다.',
  catalogUrl: '카탈로그 URL',
  load: '불러오기',
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
  remove: '저장된 애드온 제거',
  shareReady: '공유 링크가 준비되었습니다.',
  applyReady: '선택한 애드온을 추가했습니다. 기본 주소에서도 적용됩니다.',
  removeReady: '저장된 애드온을 제거했습니다. 기본 주소에서 더 이상 사용하지 않습니다.',
  error: '애드온 카탈로그를 불러오지 못했습니다.',
  saveError: '선택한 애드온을 저장하지 못했습니다.',
};

export class AddonPicker {
  constructor({ catalogUrl = '', coreVersion, profileShareParams, fetchImpl, validateCatalog, storage, labels = LABELS } = {}) {
    this.catalogUrl = catalogUrl;
    this.coreVersion = coreVersion;
    this.profileShareParams = profileShareParams;
    this.fetchImpl = fetchImpl;
    this.validateCatalog = validateCatalog;
    this.storage = storage;
    this.labels = labels;
    this.catalog = null;
    this.search = '';
    this.kind = 'all';
    this.selected = new Set();
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
      </div>
      <div class="addon-picker-filters" hidden>
        <input type="search" class="addon-search" placeholder="${this.labels.search}" aria-label="${this.labels.search}">
        <div class="addon-kind-buttons" role="group">
          ${['all', 'region', 'aircraft', 'scenario'].map(kind => `<button type="button" class="btn addon-kind" data-kind="${kind}" aria-pressed="${kind === 'all'}">${this.labels[kind]}</button>`).join('')}
        </div>
      </div>
      <div class="addon-list" role="list"></div>
      <p class="addon-picker-status" role="status" aria-live="polite"></p>
      <button type="button" class="btn addon-apply" hidden>${this.labels.apply}</button>
      <button type="button" class="btn addon-remove" hidden>${this.labels.remove}</button>
      <button type="button" class="btn addon-share" hidden>${this.labels.share}</button>
      <output class="addon-share-url" hidden></output>`;

    parent.appendChild(this.root);
    this.urlInput = this.root.querySelector('.addon-catalog-url');
    this.urlInput.value = this.catalogUrl;
    this.filters = this.root.querySelector('.addon-picker-filters');
    this.list = this.root.querySelector('.addon-list');
    this.status = this.root.querySelector('.addon-picker-status');
    this.applyBtn = this.root.querySelector('.addon-apply');
    this.removeBtn = this.root.querySelector('.addon-remove');
    this.shareBtn = this.root.querySelector('.addon-share');
    this.shareOutput = this.root.querySelector('.addon-share-url');

    this.root.querySelector('.addon-catalog-load').addEventListener('click', () => this.load(this.urlInput.value.trim()));
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
    if (this.catalogUrl) this.load(this.catalogUrl).catch(() => {});
    return this.root;
  }

  async load(url) {
    this.selected.clear();
    if (this.applyBtn) this.applyBtn.hidden = true;
    if (this.removeBtn) this.removeBtn.hidden = true;
    if (this.shareOutput) {
      this.shareOutput.hidden = true;
      this.shareOutput.textContent = '';
    }
    try {
      const catalog = await loadAddonCatalog(url, {
        fetchImpl: this.fetchImpl,
        validate: this.validateCatalog,
      });
      this.catalog = catalog;
      this.catalogUrl = url;
      const saved = loadSavedAddonProfile(this.storage);
      if (saved) {
        for (const pin of saved.pins) {
          if (catalog.addons.some(entry => entry.id === pin.id && entry.version === pin.version)) {
            this.selected.add(pin.id);
          }
        }
      }
      this.filters.hidden = false;
      this.status.textContent = '';
      this.render();
    } catch (error) {
      this.catalog = null;
      this.filters.hidden = true;
      this.list.replaceChildren();
      this.applyBtn.hidden = true;
      this.removeBtn.hidden = true;
      this.shareBtn.hidden = true;
      this.status.textContent = `${this.labels.error}: ${error.message}`;
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
        this.shareOutput.hidden = true;
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
    this.removeBtn.hidden = !loadSavedAddonProfile(this.storage);
    this.shareBtn.hidden = this.selected.size === 0;
  }

  apply() {
    if (!this.catalog || this.selected.size === 0) return false;
    try {
      saveSelectedAddons(this.catalog, [...this.selected], {
        coreVersion: this.coreVersion ?? null,
        storage: this.storage,
      });
      this.status.textContent = this.labels.applyReady;
      this.render();
      return true;
    } catch (error) {
      this.status.textContent = `${this.labels.saveError}: ${error.message}`;
      return false;
    }
  }

  remove() {
    clearSavedAddonProfile(this.storage);
    this.status.textContent = this.labels.removeReady;
    this.render();
    return true;
  }

  share() {
    if (!this.catalog || this.selected.size === 0 || !this.profileShareParams) return '';
    const url = buildAddonProfileUrl(this.catalog, [...this.selected], {
      coreVersion: this.coreVersion ?? null,
      profileShareParams: this.profileShareParams,
      baseUrl: typeof location === 'undefined' ? '?' : `${location.origin}${location.pathname}?`,
    });
    this.shareOutput.textContent = url;
    this.shareOutput.hidden = false;
    this.status.textContent = this.labels.shareReady;
    return url;
  }
}
