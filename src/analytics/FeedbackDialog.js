import '../styles/feedback-dialog.css';
import { gatherUserFeedbackContext, prepareUserFeedback, sendUserFeedback } from './posthog.js';

let feedbackOverlay = null;
let currentSim = null;
let sending = false;
let diagnosticsSnapshot = null;
let pendingReport = null;
let pendingSignature = null;

/**
 * Mount and open the in-game feedback / bug reporting dialog.
 * Gathers current simulator state (aircraft, scenario, crash reason, FPS, etc.)
 * and submits it to PostHog as a `user_feedback_submitted` event.
 */
export function openFeedbackDialog(sim = null) {
  if (typeof document === 'undefined' || sending) return;
  if (sim) currentSim = sim;

  if (!feedbackOverlay) {
    feedbackOverlay = createFeedbackOverlay(() => currentSim);
    document.body.appendChild(feedbackOverlay);
  }

  const textarea = feedbackOverlay.querySelector('[data-feedback-text]');
  // Closing a failed report must not erase its text or replace the incident snapshot.
  if (!diagnosticsSnapshot || !textarea.value.trim()) {
    diagnosticsSnapshot = gatherUserFeedbackContext(currentSim);
    feedbackOverlay.querySelector('[data-feedback-status]').textContent = '';
    feedbackOverlay.querySelector('[data-feedback-status]').dataset.failed = 'false';
    pendingReport = null;
    pendingSignature = null;
  }
  feedbackOverlay.querySelector('[data-feedback-diag-preview]').textContent = JSON.stringify(diagnosticsSnapshot, null, 2);

  feedbackOverlay.hidden = false;
  setTimeout(() => textarea?.focus(), 50);
}

function closeFeedbackDialog() {
  if (feedbackOverlay) {
    if (!sending) feedbackOverlay.hidden = true;
  }
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
        <h2 id="feedback-dialog-title" class="feedback-title">🐞 문제 및 피드백 제보</h2>
        <button type="button" class="feedback-close-btn" data-feedback-close aria-label="닫기">✕</button>
      </div>
      <p class="feedback-desc">
        시뮬레이터 비행 중 발생한 버그, 튕김, 이상 동작 또는 개선 의견을 자유롭게 적어주세요.
      </p>
      <form class="feedback-form" data-feedback-form>
        <div class="feedback-field">
          <label class="feedback-label" for="feedback-content">내용 (필수)</label>
          <textarea
            id="feedback-content"
            class="feedback-textarea"
            data-feedback-text
            required
            maxlength="4000"
            rows="3"
            placeholder="어떤 상황에서 문제가 발생했나요? (예: 계곡 슬라롬 실패 후 재시도 시 바로 충돌됨, 모바일 터치 스틱 튐 등)"
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
        <label class="feedback-diag-row">
          <input type="checkbox" data-feedback-include-diag checked />
          <span>현재 비행 진단 정보 함께 전송</span>
        </label>
        <pre class="feedback-diag-preview" data-feedback-diag-preview aria-label="진단 정보 미리보기"></pre>
        <p class="feedback-status" data-feedback-status role="status" aria-live="polite"></p>
        <button type="button" class="btn-feedback-cancel" data-feedback-download>신고 파일 저장</button>
        <div class="feedback-actions">
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
  const contactInput = overlay.querySelector('[data-feedback-contact]');
  const includeInput = overlay.querySelector('[data-feedback-include-diag]');
  const submitBtn = overlay.querySelector('[data-feedback-submit]');
  const setStatus = (text, failed = false) => {
    status.textContent = text;
    status.dataset.failed = String(failed);
    status.setAttribute('role', failed ? 'alert' : 'status');
  };
  const reportForForm = () => {
    const message = messageInput.value.trim();
    if (!message) { messageInput.focus(); return null; }
    const signature = JSON.stringify([message, contactInput.value.trim(), includeInput.checked]);
    if (!pendingReport || signature !== pendingSignature) {
      pendingReport = prepareUserFeedback({ message, contact: contactInput.value,
        includeContext: includeInput.checked, context: diagnosticsSnapshot });
      pendingSignature = signature;
    }
    return pendingReport;
  };
  includeInput.addEventListener('change', () => {
    overlay.querySelector('[data-feedback-diag-preview]').hidden = !includeInput.checked;
  });
  overlay.querySelector('[data-feedback-download]').addEventListener('click', () => {
    const report = reportForForm();
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `flight3d-report-${report.reportId}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('신고 파일을 저장했습니다. 서버 전송 여부와는 별개입니다.');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    const report = reportForForm();
    if (!report) return;
    sending = true;
    for (const element of overlay.querySelectorAll('button, input, textarea')) element.disabled = true;
    submitBtn.textContent = '수신 확인 중...';
    setStatus('신고를 보내고 서버 응답을 기다리고 있습니다.');
    const sim = getSim() || currentSim;
    let accepted = false;
    try {
      await sendUserFeedback({ report });
      accepted = true;
      setStatus(`서버가 신고를 접수했습니다. 신고 ID: ${report.reportId}`);
      sim?.showToast?.(() => `서버가 신고를 접수했습니다. 신고 ID: ${report.reportId}`);
      messageInput.value = ''; contactInput.value = '';
      pendingReport = null; pendingSignature = null; diagnosticsSnapshot = null;
    } catch (error) {
      setStatus(`${error.message} 신고 ID: ${report.reportId}`, true);
    } finally {
      sending = false;
      for (const element of overlay.querySelectorAll('button, input, textarea')) element.disabled = false;
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
