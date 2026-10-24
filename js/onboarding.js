/**
 * SkillFlow — Onboarding Module
 * Manages user track selection, experience level, daily study budget,
 * and localStorage persistence with instant read verification.
 */

(() => {
  'use strict';

  const STORAGE_KEY = 'skillflow_user_profile';

  const TRACK_METADATA = {
    'frontend-web-development': {
      title: 'Frontend Web Development',
      badge: '3 Stages • HTML, CSS, JavaScript'
    },
    'python-for-data-analysis': {
      title: 'Python for Data Analysis',
      badge: '3 Stages • Python, Pandas, Visualization'
    }
  };

  /**
   * DOM Elements Cache
   */
  let elements = {};

  function cacheElements() {
    elements = {
      form: document.getElementById('onboarding-form'),
      dailyBudgetInput: document.getElementById('daily-budget-input'),
      presetButtons: document.querySelectorAll('.btn-preset'),
      feedback: document.getElementById('onboarding-feedback'),
      savedProfileCard: document.getElementById('saved-profile-card'),
      savedProfileContent: document.getElementById('saved-profile-content'),
      btnEdit: document.getElementById('btn-edit-onboarding'),
      optionCards: document.querySelectorAll('.option-card')
    };
  }

  /**
   * Retrieve saved user profile from localStorage
   * @returns {Object|null}
   */
  function getStoredProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.error('SkillFlow [Onboarding]: Error parsing localStorage profile', err);
      return null;
    }
  }

  /**
   * Save user profile to localStorage and immediately verify the write
   * @param {Object} profile
   * @returns {{ success: boolean, data?: Object, error?: string }}
   */
  function saveProfile(profile) {
    try {
      const serialized = JSON.stringify(profile);
      localStorage.setItem(STORAGE_KEY, serialized);

      // Verify immediate readback
      const readBackRaw = localStorage.getItem(STORAGE_KEY);
      if (!readBackRaw) {
        throw new Error('Verification failed: localStorage was empty after save attempt.');
      }

      const verified = JSON.parse(readBackRaw);
      if (
        verified.trackId !== profile.trackId ||
        verified.experienceLevel !== profile.experienceLevel ||
        verified.dailyBudgetMin !== profile.dailyBudgetMin
      ) {
        throw new Error('Verification failed: Stored data does not match submitted data.');
      }

      console.info('SkillFlow [Onboarding]: Profile successfully saved and verified in localStorage:', verified);
      return { success: true, data: verified };
    } catch (err) {
      console.error('SkillFlow [Onboarding]: Save failed', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Render feedback message banner
   * @param {string} htmlMessage
   * @param {'success'|'error'} type
   */
  function showFeedback(htmlMessage, type = 'success') {
    if (!elements.feedback) return;
    elements.feedback.innerHTML = htmlMessage;
    elements.feedback.className = `onboarding-feedback ${type}`;
    elements.feedback.hidden = false;

    // Auto-scroll feedback into view if needed
    elements.feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Render the saved profile summary card
   * @param {Object} profile
   */
  function renderSavedProfileCard(profile) {
    if (!elements.savedProfileCard || !elements.savedProfileContent) return;

    const trackInfo = TRACK_METADATA[profile.trackId] || { title: profile.trackTitle || profile.trackId };
    const levelLabel = profile.experienceLevel === 'intermediate' ? 'Intermediate' : 'Beginner';
    const savedTime = profile.updatedAt ? new Date(profile.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';

    elements.savedProfileContent.innerHTML = `
      <div class="profile-meta-grid">
        <div class="meta-item">
          <span class="meta-label">Selected Track</span>
          <span class="meta-value">${trackInfo.title}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Experience Level</span>
          <span class="meta-value">${levelLabel}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Daily Study Budget</span>
          <span class="meta-value">${profile.dailyBudgetMin} mins/day</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Last Saved</span>
          <span class="meta-value">${savedTime}</span>
        </div>
      </div>
    `;

    elements.savedProfileCard.hidden = false;
  }

  /**
   * Populate onboarding form fields with existing profile values
   * @param {Object} profile
   */
  function populateForm(profile) {
    if (!elements.form || !profile) return;

    // Track radio
    const trackRadio = elements.form.querySelector(`input[name="track"][value="${profile.trackId}"]`);
    if (trackRadio) {
      trackRadio.checked = true;
      syncCardSelection();
    }

    // Experience level radio
    const levelRadio = elements.form.querySelector(`input[name="experienceLevel"][value="${profile.experienceLevel}"]`);
    if (levelRadio) {
      levelRadio.checked = true;
      syncCardSelection();
    }

    // Daily budget
    if (profile.dailyBudgetMin && elements.dailyBudgetInput) {
      elements.dailyBudgetInput.value = profile.dailyBudgetMin;
      syncPresetButtons(profile.dailyBudgetMin);
    }
  }

  /**
   * Highlight active option-cards based on checked inputs
   */
  function syncCardSelection() {
    if (!elements.optionCards) return;
    elements.optionCards.forEach(card => {
      const radio = card.querySelector('input[type="radio"]');
      if (radio) {
        card.classList.toggle('selected', radio.checked);
      }
    });
  }

  /**
   * Synchronize preset button active state with the current minutes input value
   * @param {number|string} minutes
   */
  function syncPresetButtons(minutes) {
    const minsNum = Number(minutes);
    elements.presetButtons.forEach(btn => {
      const presetVal = Number(btn.dataset.minutes);
      btn.classList.toggle('active', presetVal === minsNum);
    });
  }

  /**
   * Form submission event handler
   * @param {Event} e
   */
  function handleFormSubmit(e) {
    e.preventDefault();

    // 1. Goal / Track Selection
    const selectedTrackRadio = elements.form.querySelector('input[name="track"]:checked');
    if (!selectedTrackRadio) {
      showFeedback('Please select a learning track to continue.', 'error');
      return;
    }
    const trackId = selectedTrackRadio.value;
    const trackMetadata = TRACK_METADATA[trackId] || { title: trackId };

    // 2. Experience Level
    const selectedLevelRadio = elements.form.querySelector('input[name="experienceLevel"]:checked');
    if (!selectedLevelRadio) {
      showFeedback('Please select your current experience level.', 'error');
      return;
    }
    const experienceLevel = selectedLevelRadio.value;

    // 3. Daily Study Time Budget
    const dailyBudgetRaw = elements.dailyBudgetInput ? elements.dailyBudgetInput.value : 60;
    const dailyBudgetMin = parseInt(dailyBudgetRaw, 10);

    if (isNaN(dailyBudgetMin) || dailyBudgetMin < 15 || dailyBudgetMin > 480) {
      showFeedback('Please enter a daily study budget between 15 and 480 minutes.', 'error');
      return;
    }

    // Build normalized user profile
    const profilePayload = {
      trackId,
      trackTitle: trackMetadata.title,
      experienceLevel,
      dailyBudgetMin,
      updatedAt: new Date().toISOString()
    };

    // Save to localStorage & verify readback
    const result = saveProfile(profilePayload);

    if (!result.success) {
      showFeedback(`Error saving profile: ${result.error}`, 'error');
      return;
    }

    const verified = result.data;

    // Display confirmation and verified details
    showFeedback(
      `<div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
        <span>✓ <strong>Preferences saved!</strong> Goal: <em>${verified.trackTitle}</em> | Level: ${verified.experienceLevel.toUpperCase()} | Budget: ${verified.dailyBudgetMin} mins/day.</span>
        <button type="button" class="btn-primary" style="font-size: 0.8rem; padding: 0.35rem 0.85rem;" onclick="document.querySelector('[data-view=schedule]').click()">
          Go to Today's Schedule &rarr;
        </button>
      </div>`,
      'success'
    );

    renderSavedProfileCard(verified);

    // 1. Mark onboarding profile setup as completed
    localStorage.setItem('skillflow_profile_completed', 'true');

    // 2. Hide onboarding section
    const onboardingSection = document.getElementById('view-onboarding');
    if (onboardingSection) {
      onboardingSection.style.display = 'none';
      onboardingSection.classList.remove('active');
    }

    // 3. Notify application system & other tabs/views
    window.dispatchEvent(
      new CustomEvent('skillflow:profile-saved', {
        detail: verified
      })
    );

    // 4. Display main dashboard
    if (window.SkillFlowApp && typeof window.SkillFlowApp.navigateTo === 'function') {
      window.SkillFlowApp.navigateTo('dashboard');
    } else {
      const dashboardBtn = document.querySelector('.nav-btn[data-view="dashboard"]');
      if (dashboardBtn) {
        dashboardBtn.click();
      }
    }
  }

  /**
   * Bind DOM event listeners
   */
  function bindEvents() {
    if (elements.form) {
      elements.form.addEventListener('submit', handleFormSubmit);

      // Listen to radio changes to toggle selected classes
      elements.form.addEventListener('change', (e) => {
        if (e.target && e.target.type === 'radio') {
          syncCardSelection();
        }
      });
    }

    // Daily budget presets
    elements.presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = btn.dataset.minutes;
        if (elements.dailyBudgetInput) {
          elements.dailyBudgetInput.value = mins;
          syncPresetButtons(mins);
        }
      });
    });

    // Daily budget manual typing
    if (elements.dailyBudgetInput) {
      elements.dailyBudgetInput.addEventListener('input', (e) => {
        syncPresetButtons(e.target.value);
      });
    }

    // Edit preferences button
    if (elements.btnEdit) {
      elements.btnEdit.addEventListener('click', () => {
        if (elements.form) {
          elements.form.scrollIntoView({ behavior: 'smooth' });
          const firstField = elements.form.querySelector('input[name="track"]');
          if (firstField) firstField.focus();
        }
      });
    }
  }

  /**
   * Initialize onboarding module
   */
  function init() {
    cacheElements();
    bindEvents();
    syncCardSelection();

    // Check for existing saved profile
    const existing = getStoredProfile();
    if (existing) {
      populateForm(existing);
      renderSavedProfileCard(existing);
      console.log('SkillFlow [Onboarding]: Existing user profile restored from localStorage:', existing);
    }
  }

  // Public API for programmatic verification & testing
  window.SkillFlowOnboarding = {
    getStoredProfile,
    saveProfile,
    init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
