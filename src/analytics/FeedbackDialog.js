import '../styles/feedback-dialog.css';
import { gatherFlightContext, sendUserFeedback } from './posthog.js';

let feedbackOverlay = null;
let currentSim = null;

/**
 * Mount and open the in-game feedback / bug reporting dialog.
 * Gathers current simulator state (aircraft, scenario, crash reason, FPS, etc.)
 * and submits it to PostHog as a `user_feedback_submitted` event.
 */
export function openFeedbackDialog(sim = null) {
  if (typeof document === 'undefined') return;
  if (sim) currentSim = sim;

  if (!feedbackOverlay) {
    feedbackOverlay = createFeedbackOverlay(() => currentSim);
    document.body.appendChild(feedbackOverlay);
  }

  const context = gatherFlightContext(currentSim);
  const diagPreview = feedbackOverlay.querySelector('[data-feedback-diag-preview]');
  if (diagPreview) {
    diagPreview.textContent = JSON.stringify(context, null, 2);
  }

  const textarea = feedbackOverlay.querySelector('[data-feedback-text]');
  if (textarea) textarea.value = '';

  const submitBtn = feedbackOverlay.querySelector('[data-feedback-submit]');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = '제보 보내기';
  }

  feedbackOverlay.hidden = false;
  setTimeout(() => textarea?.focus(), 50);
}

function closeFeedbackDialog() {
  if (feedbackOverlay) {
    feedbackOverlay.hidden = true;
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
            rows="3"
            placeholder="어떤 상황에서 문제가 발생했나요? (예: 계곡 슬라롬 실패 후 재시도 시 바로 충돌됨, 모바일 터치 스틱 튐 등)"
          ></textarea>
        </div>
        <div class="feedback-field">
          <label class="feedback-label" for="feedback-contact">연락처 / 콜사인 (선택)</label>
          <input
            id="feedback-contact"
            type="text"
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
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const textarea = overlay.querySelector('[data-feedback-text]');
    const contactInput = overlay.querySelector('[data-feedback-contact]');
    const includeDiag = overlay.querySelector('[data-feedback-include-diag]')?.checked ?? true;
    const message = textarea?.value?.trim();

    if (!message) {
      textarea?.focus();
      return;
    }

    const submitBtn = overlay.querySelector('[data-feedback-submit]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '전송 중...';
    }

    const sim = (typeof getSim === 'function' ? getSim() : getSim) || currentSim;
    try {
      await sendUserFeedback({
        message,
        contact: contactInput?.value?.trim() || '',
        category: 'bug',
        includeContext: includeDiag,
        context: includeDiag ? gatherFlightContext(sim) : {},
      });
      closeFeedbackDialog();
      if (sim?.showToast) {
        sim.showToast(() => '소중한 문제 제보가 전달되었습니다. 감사합니다!');
      }
    } catch (err) {
      console.warn('[Feedback] Failed to send feedback:', err);
      closeFeedbackDialog();
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '제보 보내기';
      }
    }
  });

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closeFeedbackDialog();
    }
  });

  return overlay;
}
