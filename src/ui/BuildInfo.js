import { BUILD_INFO } from '../dev/buildInfo.js';
import { bindText, getLanguage, t } from '../i18n/index.js';

const UNITS = [['year', 31557600], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

/** Localized "merged N ago" phrase for a build-time commit date, or null when it is unavailable. */
export function describeCommitAge(commitDate, now = Date.now()) {
  const landed = Date.parse(commitDate);
  if (!Number.isFinite(landed)) return null;
  const elapsed = Math.max(0, Math.floor((now - landed) / 1000));
  const match = UNITS.find(([, seconds]) => elapsed >= seconds);
  const [unit, seconds] = match ?? ['second', 1];
  const age = new Intl.RelativeTimeFormat(getLanguage(), { numeric: 'auto' }).format(-Math.floor(elapsed / seconds), unit);
  return t('build.merged', { age });
}

export function initBuildInfo() {
  for (const element of document.querySelectorAll('[data-build-info]')) {
    element.querySelector('[data-build-branch]').textContent = BUILD_INFO.branch;
    const commit = element.querySelector('[data-build-commit]');
    commit.textContent = BUILD_INFO.revision;
    if (/^[a-f0-9]{40}$/.test(BUILD_INFO.commit)) {
      commit.href = `https://github.com/stlim0727/flight3d/commit/${BUILD_INFO.commit}`;
    } else {
      // Source archives have no revision to link to.
      commit.removeAttribute('href');
    }
    bindText(element.querySelector('[data-build-age]'), () => describeCommitAge(BUILD_INFO.commitDate) ?? 'unknown');
  }
}
