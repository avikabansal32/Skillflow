/**
 * SkillFlow — Application Entry Point
 * Vanilla JS client-side orchestration
 */

(() => {
  'use strict';

  // Application State
  const state = {
    currentView: 'onboarding',
    learningPaths: [],
    userProfile: null,
    activeRoadmap: null,
    dailySchedule: []
  };

  /**
   * DOM Elements Cache
   */
  const elements = {
    navButtons: document.querySelectorAll('.nav-btn'),
    views: {
      onboarding: document.getElementById('view-onboarding'),
      dashboard: document.getElementById('view-dashboard'),
      roadmap: document.getElementById('view-roadmap'),
      schedule: document.getElementById('view-schedule')
    },
    mounts: {
      onboarding: document.getElementById('onboarding-container'),
      dashboard: document.getElementById('dashboard-container'),
      roadmap: document.getElementById('roadmap-container'),
      schedule: document.getElementById('schedule-container')
    }
  };

  /**
   * Switch between primary view containers
   * @param {string} viewName - Target view id (onboarding, dashboard, roadmap, schedule)
   */
  function navigateTo(viewName) {
    if (!elements.views[viewName]) return;

    // Update active nav button
    elements.navButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // Toggle active view container
    Object.entries(elements.views).forEach(([name, container]) => {
      if (container) {
        container.classList.toggle('active', name === viewName);
      }
    });

    state.currentView = viewName;
  }

  /**
   * Fetch initial learning paths dataset
   */
  async function loadLearningPaths() {
    try {
      const response = await fetch('./data/learning-paths.json');
      if (!response.ok) {
        throw new Error(`HTTP error while fetching learning paths: ${response.status}`);
      }
      const data = await response.json();
      state.learningPaths = data.tracks || data.paths || [];
      console.log('SkillFlow: Loaded learning paths successfully', state.learningPaths);
    } catch (error) {
      console.warn('SkillFlow: Could not load remote JSON (may be running on file:// protocol). Fallback ready.', error);
    }
  }

  /**
   * Bind event listeners for UI navigation & profile updates
   */
  function bindEvents() {
    elements.navButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetView = e.currentTarget.dataset.view;
        if (targetView) {
          navigateTo(targetView);
        }
      });
    });

    // React when user saves onboarding profile
    window.addEventListener('skillflow:profile-saved', (e) => {
      state.userProfile = e.detail;
      console.log('SkillFlow [App]: Profile updated event received in app controller:', state.userProfile);
    });
  }

  /**
   * Check for existing persisted state
   */
  function checkPersistedProfile() {
    try {
      const raw = localStorage.getItem('skillflow_user_profile');
      if (raw) {
        state.userProfile = JSON.parse(raw);
        console.log('SkillFlow [App]: Restored profile from localStorage:', state.userProfile);
      }
    } catch (err) {
      console.warn('SkillFlow [App]: Error reading stored profile', err);
    }
  }

  /**
   * Initialize SkillFlow Application
   */
  async function init() {
    bindEvents();
    checkPersistedProfile();
    await loadLearningPaths();
    console.log('SkillFlow initialized.');
  }

  // Bootstrap when DOM is fully parsed
  document.addEventListener('DOMContentLoaded', init);
})();
