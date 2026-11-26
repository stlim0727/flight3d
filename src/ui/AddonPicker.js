import { listAddons, loadAddonCatalog, buildAddonProfileUrl, resolveCatalogUrl } from '../addons/addonCatalogBrowser.js';

const LABELS = {
  title: '애드온',
  hint: '카탈로그 URL을 넣고 비행에 사용할 애드온을 고르세요.',
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
  shareReady: '공유 링크가 준비되었습니다.',
  copy: '링크 복사',
  copied: '링크를 복사했습니다.',
  open: '링크 열기',
  error: '애드온 카탈로그를 불러오지 못했습니다.',
};

export class AddonPicker {
  constructor({ catalogUrl = '', coreVersion, profileShareParams, fetchImpl, validateCatalog, labels = LABELS } = {}) {
    this.catalogUrl = catalogUrl;
    this.coreVersion = coreVersion;
    this.profileShareParams = profileShareParams;
    this.fetchImpl = fetchImpl;
    this.validateCatalog = validateCatalog;
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
      <button type="button" class="btn addon-share" hidden>${this.labels.share}</button>
      <div class="addon-share-actions" hidden>
        <a class="addon-share-link" target="_blank" rel="noopener noreferrer"></a>
        <button type="button" class="btn addon-share-copy">${this.labels.copy}</button>
      </div>`;

    parent.appendChild(this.root);
    this.urlInput = this.root.querySelector('.addon-catalog-url');
    this.urlInput.value = this.catalogUrl;
    this.filters = this.root.querySelector('.addon-picker-filters');
    this.list = this.root.querySelector('.addon-list');
    this.status = this.root.querySelector('.addon-picker-status');
    this.shareBtn = this.root.querySelector('.addon-share');
    this.shareActions = this.root.querySelector('.addon-share-actions');
    this.shareLink = this.root.querySelector('.addon-share-link');
    this.shareCopyBtn = this.root.querySelector('.addon-share-copy');

    this.root.querySelector('.addon-catalog-load').addEventListener('click', () => this.load(resolveCatalogUrl(this.urlInput.value)));
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

  async copyShareLink() {
    if (!this.shareLink?.href) return;
    try {
      await navigator.clipboard.writeText(this.shareLink.href);
      this.status.textContent = this.labels.copied;
    } catch {
      this.status.textContent = `${this.labels.error}: clipboard`;
    }
  }

  async load(url) {
    this.selected.clear();
    this.hideShareLink();
    try {
      const catalog = await loadAddonCatalog(url, {
        fetchImpl: this.fetchImpl,
        validate: this.validateCatalog,
      });
      this.catalog = catalog;
      this.catalogUrl = resolveCatalogUrl(url);
      this.filters.hidden = false;
      this.status.textContent = '';
      this.render();
    } catch (error) {
      this.catalog = null;
      this.filters.hidden = true;
      this.list.replaceChildren();
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
    this.shareBtn.hidden = this.selected.size === 0;
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
