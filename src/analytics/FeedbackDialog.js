import '../styles/feedback-dialog.css';
import {
  gatherUserFeedbackContext,
  gatherUserFeedbackFullReport,
  prepareUserFeedback,
  sendUserFeedback,
} from './posthog.js';

let feedbackOverlay = null;
let currentSim = null;
let closeHandler = null;
let sending = false;
let diagnosticsSnapshot = null;
let fullReportSnapshot = null;
let screenshotSnapshot = null;
let pendingReport = null;
let pendingSignature = null;

const SCREENSHOT_MAX_WIDTH = 960;
const SCREENSHOT_JPEG_QUALITY = 0.72;

export function captureFeedbackScreenshot(sim = null) {
  if (typeof document === 'undefined') return null;
  const source = sim?.renderer?.domElement ?? document.querySelector?.('canvas');
  if (!source || !source.width || !source.height) return null;
  try {
    if (typeof sim?.renderScene === 'function') {
      sim.renderScene();
      if (sim.cockpitPhotoOverlay?.enabled) {
        sim.cockpitPhotoOverlay.render(sim.renderer);
      }
    } else if (sim?.renderer?.render && sim?.scene && sim?.camera) {
      sim.renderer.render(sim.scene, sim.camera);
    }
    const scale = Math.min(1, SCREENSHOT_MAX_WIDTH / source.width);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const target = document.createElement('canvas');
    target.width = width;
    target.height = height;
    const ctx = target.getContext?.('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, width, height);
    const dataUrl = target.toDataURL('image/jpeg', SCREENSHOT_JPEG_QUALITY);
    return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : null;
  } catch {
    return null;
  }
}

const CATEGORY_OPTIONS = [
  ['bug', '버그/오작동 (일반)'],
  ['physics', '비행 물리/기체 모델'],
  ['collision', '충돌/지형'],
  ['graphics', '그래픽/렌더링'],
  ['controls', '조작/입력'],
  ['audio', '오디오'],
  ['ui', 'UI/메뉴'],
  ['other', '기타'],
];
const SEVERITY_OPTIONS = [
  ['blocker', '심각 — 비행 불가·튕김·파손'],
  ['major', '보통 — 기능이 잘못 동작'],
  ['minor', '경미 — 시각·문구'],
];
const optionMarkup = options => options.map(([value, label]) =>
  `<option value="${value}">${label}</option>`).join('');

const formatClock = seconds => {
  if (!Number.isFinite(seconds)) return '—';
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};
const formatNumber = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : null;
const formatBytes = bytes => bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;

/**
 * Mount and open the in-game anomaly report dialog.
 * The snapshot is captured the moment the dialog opens (including the sortie's
 * flight log), so the aircraft can keep flying or the report can be retried
 * without the evidence changing.
 */
export function openFeedbackDialog(sim = null, options = {}) {
  if (typeof document === 'undefined' || sending) return false;
  if (sim) currentSim = sim;
  if (typeof options.onClose === 'function') closeHandler = options.onClose;

  if (!feedbackOverlay) {
    feedbackOverlay = createFeedbackOverlay(() => currentSim);
    document.body.appendChild(feedbackOverlay);
  }

  const textarea = feedbackOverlay.querySelector('[data-feedback-text]');
  // Closing a failed report must not erase its text or replace the incident snapshot.
  if (!diagnosticsSnapshot || !textarea.value.trim()) {
    diagnosticsSnapshot = gatherUserFeedbackContext(currentSim);
    fullReportSnapshot = gatherUserFeedbackFullReport(currentSim);
    screenshotSnapshot = captureFeedbackScreenshot(currentSim);
    resetFormState(feedbackOverlay);
    renderContext(feedbackOverlay, diagnosticsSnapshot);
    renderFlightLogSummary(feedbackOverlay, diagnosticsSnapshot);
    renderAttachmentOptions(feedbackOverlay, fullReportSnapshot, screenshotSnapshot);
    feedbackOverlay.querySelector('[data-feedback-status]').textContent = '';
    feedbackOverlay.querySelector('[data-feedback-status]').dataset.failed = 'false';
    pendingReport = null;
    pendingSignature = null;
  }
  feedbackOverlay.querySelector('[data-feedback-diag-preview]').textContent = summarizePreview(diagnosticsSnapshot);

  feedbackOverlay.hidden = false;
  setTimeout(() => textarea?.focus(), 50);
  return true;
}

function closeFeedbackDialog() {
  if (!feedbackOverlay || sending) return;
  feedbackOverlay.hidden = true;
  const handler = closeHandler;
  closeHandler = null;
  handler?.();
}

function resetFormState(overlay) {
  overlay.querySelector('[data-feedback-category]').value = 'bug';
  overlay.querySelector('[data-feedback-severity]').value = 'major';
  overlay.querySelector('[data-feedback-include-diag]').checked = true;
  overlay.querySelector('[data-feedback-include-full-report]').checked = false;
  overlay.querySelector('[data-feedback-include-screenshot]').checked = false;
  overlay.querySelector('[data-feedback-screenshot-preview]').hidden = true;
  overlay.querySelector('[data-feedback-screenshot-preview]').removeAttribute('src');
  overlay.querySelector('[data-feedback-preview-toggle]').setAttribute('aria-expanded', 'false');
  overlay.querySelector('[data-feedback-preview-toggle]').textContent = '진단 정보 미리보기';
  overlay.querySelector('[data-feedback-diag-preview]').hidden = true;
}

function renderAttachmentOptions(overlay, fullReport, screenshot) {
  const fullReportInput = overlay.querySelector('[data-feedback-include-full-report]');
  const fullReportSummary = overlay.querySelector('[data-feedback-full-report-summary]');
  fullReportInput.disabled = !fullReport;
  if (!fullReport) {
    fullReportSummary.dataset.empty = 'true';
    fullReportSummary.textContent = '첨부할 전체 리포트가 없습니다.';
  } else {
    fullReportSummary.dataset.empty = 'false';
    const bytes = new TextEncoder().encode(JSON.stringify(fullReport)).length;
    const parts = [formatBytes(bytes)];
    if (fullReport.track) parts.push('3D 리플레이 트랙 포함');
    else if (fullReport.trackOmittedForBudget) parts.push('트랙 제외(전송 한도)');
    fullReportSummary.textContent = `전체 리포트 (${fullReport.kind}): ${parts.join(' · ')}`;
  }

  const screenshotInput = overlay.querySelector('[data-feedback-include-screenshot]');
  const screenshotSummary = overlay.querySelector('[data-feedback-screenshot-summary]');
  const screenshotPreview = overlay.querySelector('[data-feedback-screenshot-preview]');
  screenshotInput.disabled = !screenshot;
  if (!screenshot) {
    screenshotSummary.dataset.empty = 'true';
    screenshotSummary.textContent = '캡처 가능한 화면이 없습니다.';
    screenshotPreview.hidden = true;
    screenshotPreview.removeAttribute('src');
  } else {
    screenshotSummary.dataset.empty = 'false';
    screenshotSummary.textContent = `스크린샷 준비됨 (${formatBytes(screenshot.length)})`;
    screenshotPreview.src = screenshot;
    screenshotPreview.hidden = !screenshotInput.checked;
  }
}

/** Only a readable ingestion acknowledgement counts; the local file is the fallback. */
function summarizePreview(snapshot) {
  if (!snapshot) return '{}';
  return JSON.stringify(snapshot, (key, value) =>
    key === 'samples' && Array.isArray(value) ? `[${value.length} samples]` : value, 2);
}

function renderContext(overlay, snapshot) {
  const list = overlay.querySelector('[data-feedback-context]');
  list.textContent = '';
  if (!snapshot) { list.hidden = true; return; }
  const telemetry = snapshot.telemetry ?? {};
  const rows = [];
  const add = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    rows.push([label, value]);
  };
  add('기체', snapshot.aircraft);
  add('공항', snapshot.airport);
  add('시나리오', snapshot.scenario);
  add('비행 시간', Number.isFinite(snapshot.flightDurationSec) ? formatClock(snapshot.flightDurationSec) : null);
  add('현재 G', formatNumber(snapshot.gForce, 2));
  add('고도', Number.isFinite(telemetry.altitudeFt) ? `${Math.round(telemetry.altitudeFt).toLocaleString()} ft` : null);
  add('IAS', Number.isFinite(telemetry.iasKnots) ? `${Math.round(telemetry.iasKnots)} kt` : null);
  add('최대 G', Number.isFinite(snapshot.peakG) ? `${formatNumber(snapshot.peakG, 1)} @ ${formatClock(snapshot.peakGTimeSec)}` : null);
  if (snapshot.isCrashed) add('상태', '충돌·파손');
  else if (snapshot.gearFailure) add('기어', '고장');
  for (const [label, value] of rows) {
    const item = document.createElement('span');
    item.className = 'feedback-context-item';
    const caption = document.createElement('b');
    caption.textContent = label;
    item.append(caption, document.createTextNode(String(value)));
    list.append(item);
  }
  list.hidden = rows.length === 0;
}

function renderFlightLogSummary(overlay, snapshot) {
  const summary = overlay.querySelector('[data-feedback-log-summary]');
  const log = snapshot?.flightLog;
  if (!log) {
    summary.dataset.empty = 'true';
    summary.textContent = '이번 비행 로그가 없어 첨부할 수 없습니다.';
    return;
  }
  summary.dataset.empty = 'false';
  const parts = [`${log.samples.length}개 샘플`, formatBytes(JSON.stringify(log).length)];
  if (Number.isFinite(log.durationSec)) parts.push(`비행 ${formatClock(log.durationSec)}`);
  if (log.sampling?.decimated) parts.push('전송 한도에 맞게 축약됨');
  summary.textContent = `비행 로그 첨부: ${parts.join(' · ')}`;
}

function createFeedbackOverlay(getSim) {
  const overlay = document.createElement('div');
  overlay.id = 'feedback-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'feedback-dialog-title');
  overlay.hidden = true;

  overlay.innerHTML = `
    <div class="feedback-card">
      <div class="feedback-header">
        <h2 id="feedback-dialog-title" class="feedback-title">🐞 이상 신고 · 문제 제보</h2>
        <button type="button" class="feedback-close-btn" data-feedback-close aria-label="닫기">×</button>
      </div>
      <p class="feedback-desc">
        비행 중 이상 동작을 발견한 즉시 기록하세요. 열린 순간의 기체 상태와 비행 로그가 자동으로 첨부됩니다.
      </p>
      <div class="feedback-context" data-feedback-context aria-label="현재 비행 상황"></div>
      <form class="feedback-form" data-feedback-form>
        <div class="feedback-row">
          <label class="feedback-field" for="feedback-category">
            <span class="feedback-label">유형</span>
            <select id="feedback-category" class="feedback-input" data-feedback-category>
              ${optionMarkup(CATEGORY_OPTIONS)}
            </select>
          </label>
          <label class="feedback-field" for="feedback-severity">
            <span class="feedback-label">심각도</span>
            <select id="feedback-severity" class="feedback-input" data-feedback-severity>
              ${optionMarkup(SEVERITY_OPTIONS)}
            </select>
          </label>
        </div>
        <div class="feedback-field">
          <label class="feedback-label" for="feedback-content">내용 (필수)</label>
          <textarea
            id="feedback-content"
            class="feedback-textarea"
            data-feedback-text
            required
            maxlength="4000"
            rows="4"
            placeholder="무엇이 잘못됐나요? (예: 터치다운 순간 50G, 지형을 통과함, 조작이 반대로 먹힘)"
          ></textarea>
        </div>
        <details class="feedback-extra">
          <summary>추가 정보 (선택) — 기대 동작 · 재현 절차 · 연락처</summary>
          <div class="feedback-field">
            <label class="feedback-label" for="feedback-expected">기대한 동작 (선택)</label>
            <textarea
              id="feedback-expected"
              class="feedback-textarea feedback-textarea-short"
              data-feedback-expected
              maxlength="2000"
              rows="2"
              placeholder="예: 부드럽게 착륙하고 충격은 1.5G 이하여야 함"
            ></textarea>
          </div>
          <div class="feedback-field">
            <label class="feedback-label" for="feedback-steps">재현 절차 (선택)</label>
            <textarea
              id="feedback-steps"
              class="feedback-textarea feedback-textarea-short"
              data-feedback-steps
              maxlength="2000"
              rows="2"
              placeholder="예: F16 · 계곡 슬라롬 · 두 번째 링 통과 직후"
            ></textarea>
          </div>
          <div class="feedback-field">
            <label class="feedback-label" for="feedback-contact">연락처 / 콜사인 (선택)</label>
            <input
              id="feedback-contact"
              type="text"
              maxlength="256"
              class="feedback-input"
              data-feedback-contact
              placeholder="이메일 또는 파일럿 호출부호"
            />
          </div>
        </details>
        <label class="feedback-diag-row">
          <input type="checkbox" data-feedback-include-diag checked />
          <span>현재 비행 진단 정보 및 비행 로그 함께 전송</span>
        </label>
        <p class="feedback-log-summary" data-feedback-log-summary></p>
        <label class="feedback-diag-row">
          <input type="checkbox" data-feedback-include-full-report />
          <span>전체 리포트 함께 첨부 (flight3d.sortie.v1)</span>
        </label>
        <p class="feedback-log-summary" data-feedback-full-report-summary></p>
        <label class="feedback-diag-row">
          <input type="checkbox" data-feedback-include-screenshot />
          <span>현재 화면 스크린샷 함께 첨부</span>
        </label>
        <p class="feedback-log-summary" data-feedback-screenshot-summary></p>
        <img class="feedback-screenshot-preview" data-feedback-screenshot-preview alt="제보에 첨부할 현재 화면 스크린샷 미리보기" hidden />
        <button type="button" class="feedback-preview-toggle" data-feedback-preview-toggle aria-expanded="false">진단 정보 미리보기</button>
        <pre class="feedback-diag-preview" data-feedback-diag-preview aria-label="진단 정보 미리보기" hidden></pre>
        <p class="feedback-status" data-feedback-status role="status" aria-live="polite"></p>
        <div class="feedback-actions">
          <button type="button" class="btn-feedback-cancel" data-feedback-download>신고 파일 저장</button>
          <button type="button" class="btn-feedback-cancel" data-feedback-cancel>취소</button>
          <button type="submit" class="btn-feedback-submit" data-feedback-submit>제보 보내기</button>
        </div>
      </form>
    </div>
  `;

  // Event bindings
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('[data-feedback-close]') || event.target.closest('[data-feedback-cancel]')) {
      closeFeedbackDialog();
    }
  });

  const form = overlay.querySelector('[data-feedback-form]');
  const status = overlay.querySelector('[data-feedback-status]');
  const messageInput = overlay.querySelector('[data-feedback-text]');
  const expectedInput = overlay.querySelector('[data-feedback-expected]');
  const stepsInput = overlay.querySelector('[data-feedback-steps]');
  const contactInput = overlay.querySelector('[data-feedback-contact]');
  const categoryInput = overlay.querySelector('[data-feedback-category]');
  const severityInput = overlay.querySelector('[data-feedback-severity]');
  const includeInput = overlay.querySelector('[data-feedback-include-diag]');
  const includeFullReportInput = overlay.querySelector('[data-feedback-include-full-report]');
  const includeScreenshotInput = overlay.querySelector('[data-feedback-include-screenshot]');
  const screenshotPreview = overlay.querySelector('[data-feedback-screenshot-preview]');
  const previewToggle = overlay.querySelector('[data-feedback-preview-toggle]');
  const preview = overlay.querySelector('[data-feedback-diag-preview]');
  const submitBtn = overlay.querySelector('[data-feedback-submit]');
  const setStatus = (text, failed = false) => {
    status.textContent = text;
    status.dataset.failed = String(failed);
    status.setAttribute('role', failed ? 'alert' : 'status');
  };
  const syncPreview = () => {
    previewToggle.hidden = !includeInput.checked;
    preview.hidden = !includeInput.checked || previewToggle.getAttribute('aria-expanded') !== 'true';
    screenshotPreview.hidden = !includeScreenshotInput.checked || !screenshotSnapshot;
  };
  syncPreview();
  const reportForForm = () => {
    const message = messageInput.value.trim();
    if (!message) { messageInput.focus(); return null; }
    const includeFullReport = includeFullReportInput.checked && Boolean(fullReportSnapshot);
    const includeScreenshot = includeScreenshotInput.checked && Boolean(screenshotSnapshot);
    const signature = JSON.stringify([message, contactInput.value.trim(), categoryInput.value,
      severityInput.value, expectedInput.value.trim(), stepsInput.value.trim(), includeInput.checked,
      includeFullReport, includeScreenshot]);
    if (!pendingReport || signature !== pendingSignature) {
      pendingReport = prepareUserFeedback({ message, contact: contactInput.value,
        category: categoryInput.value, severity: severityInput.value,
        expected: expectedInput.value, steps: stepsInput.value,
        includeContext: includeInput.checked, context: diagnosticsSnapshot,
        fullReport: includeFullReport ? fullReportSnapshot : null,
        screenshot: includeScreenshot ? screenshotSnapshot : null });
      pendingSignature = signature;
    }
    return pendingReport;
  };
  includeInput.addEventListener('change', () => {
    if (!includeInput.checked) {
      previewToggle.setAttribute('aria-expanded', 'false');
      previewToggle.textContent = '진단 정보 미리보기';
    }
    syncPreview();
  });
  includeScreenshotInput.addEventListener('change', syncPreview);
  previewToggle.addEventListener('click', () => {
    const expanded = previewToggle.getAttribute('aria-expanded') !== 'true';
    previewToggle.setAttribute('aria-expanded', String(expanded));
    previewToggle.textContent = expanded ? '진단 정보 숨기기' : '진단 정보 미리보기';
    syncPreview();
  });
  overlay.querySelector('[data-feedback-download]').addEventListener('click', () => {
    const report = reportForForm();
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `flight3d-report-${report.reportId}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('비행 로그가 포함된 신고 파일을 저장했습니다. 서버 전송 여부와는 별개입니다.');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    const report = reportForForm();
    if (!report) return;
    sending = true;
    for (const element of overlay.querySelectorAll('button, input, textarea, select')) element.disabled = true;
    submitBtn.textContent = '수신 확인 중...';
    setStatus('신고를 보내고 서버 응답을 기다리고 있습니다.');
    const sim = getSim() || currentSim;
    let accepted = false;
    try {
      await sendUserFeedback({ report });
      accepted = true;
      setStatus(`서버가 신고를 접수했습니다. 신고 ID: ${report.reportId}`);
      sim?.showToast?.(() => `서버가 신고를 접수했습니다. 신고 ID: ${report.reportId}`);
      messageInput.value = ''; expectedInput.value = ''; stepsInput.value = ''; contactInput.value = '';
      categoryInput.value = 'bug'; severityInput.value = 'major';
      pendingReport = null; pendingSignature = null; diagnosticsSnapshot = null;
      fullReportSnapshot = null; screenshotSnapshot = null;
    } catch (error) {
      setStatus(`${error.message} 신고 ID: ${report.reportId}`, true);
    } finally {
      sending = false;
      for (const element of overlay.querySelectorAll('button, input, textarea, select')) element.disabled = false;
      if (!fullReportSnapshot) includeFullReportInput.disabled = true;
      if (!screenshotSnapshot) includeScreenshotInput.disabled = true;
      submitBtn.textContent = accepted ? '제보 보내기' : '다시 보내기';
      if (accepted) closeFeedbackDialog();
    }
  });

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closeFeedbackDialog();
    }
  });

  return overlay;
}
