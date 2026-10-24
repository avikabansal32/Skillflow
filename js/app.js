/**
 * SkillFlow — Application Entry Point
 * Vanilla JS client-side orchestration
 */

(() => {
  'use strict';

  // Mandatory Auth Guard
  if (!localStorage.getItem('skillflow_user')) {
    window.location.replace('auth.html');
    return;
  }

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
    navTabs: document.querySelectorAll('.nav-tab'),
    navButtons: document.querySelectorAll('.nav-btn, .nav-tab'),
    appViews: document.querySelectorAll('.app-view'),
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
   * @param {string} viewName - Target view id (e.g. 'dashboard', 'roadmap', 'schedule', 'view-dashboard')
   */
  function navigateTo(viewName) {
    const targetId = viewName.startsWith('view-') ? viewName : `view-${viewName}`;
    const tabs = document.querySelectorAll('.nav-tab');
    const views = document.querySelectorAll('.app-view');

    // Update active tab style
    tabs.forEach(tab => {
      const tabTarget = tab.getAttribute('data-target');
      if (tabTarget === targetId) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // Show selected view, hide others
    views.forEach(view => {
      if (view.id === targetId) {
        view.classList.remove('hidden');
        view.classList.add('active');
      } else {
        view.classList.add('hidden');
        view.classList.remove('active');
      }
    });

    state.currentView = targetId.replace('view-', '');

    if (targetId === 'view-dashboard') {
      renderDashboard();
    } else if (targetId === 'view-schedule' && window.SkillFlowScheduler) {
      window.SkillFlowScheduler.renderSchedule();
    } else if (targetId === 'view-roadmap' && window.SkillFlowRoadmap) {
      window.SkillFlowRoadmap.renderRoadmap();
    }
  }

  /**
   * Apply onboarding visibility and access gating rules:
   * Keep setup form hidden once profile is completed.
   */
  function applyOnboardingGating() {
    const isCompleted = localStorage.getItem('skillflow_profile_completed') === 'true';
    const btnEditGoals = document.getElementById('btn-edit-goals');
    const tabs = document.querySelectorAll('.nav-tab');
    const views = document.querySelectorAll('.app-view');

    if (isCompleted) {
      // 1. Keep the onboarding container hidden
      if (elements.views.onboarding) {
        elements.views.onboarding.style.display = 'none';
        elements.views.onboarding.classList.remove('active');
      }

      // Show "Edit Goals" button in navbar
      if (btnEditGoals) {
        btnEditGoals.style.display = 'inline-flex';
      }

      // Enable and display main app nav tabs
      tabs.forEach(tab => {
        tab.style.display = 'inline-flex';
        tab.disabled = false;
      });

      // Directly render and show the dashboard
      const targetView = (state.currentView && state.currentView !== 'onboarding')
        ? state.currentView
        : 'dashboard';
      navigateTo(targetView);
    } else {
      // 2. Profile NOT completed: Show onboarding container & keep main dashboard hidden
      if (elements.views.onboarding) {
        elements.views.onboarding.style.display = 'block';
        elements.views.onboarding.classList.add('active');
      }

      // Keep dashboard, roadmap, schedule containers hidden
      views.forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('active');
      });

      tabs.forEach(tab => {
        tab.classList.remove('active');
      });

      if (btnEditGoals) {
        btnEditGoals.style.display = 'none';
      }

      state.currentView = 'onboarding';
    }
  }

  /**
   * Render Dashboard Overview with real-time metrics
   */
  function renderDashboard() {
    if (!elements.mounts.dashboard) return;

    const profile = state.userProfile || (() => {
      try {
        const raw = localStorage.getItem('skillflow_user_profile');
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    })();

    let completions = {};
    try {
      const rawComp = localStorage.getItem('skillflow_task_completions');
      if (rawComp) completions = JSON.parse(rawComp);
    } catch (e) {}

    const activeTrackId = profile ? profile.trackId : 'frontend-web-development';
    const activeTrack = state.learningPaths.find(t => t.id === activeTrackId) || state.learningPaths[0];

    let totalTasks = 0;
    let completedTasks = 0;
    let totalMinutes = 0;

    if (activeTrack && activeTrack.stages) {
      activeTrack.stages.forEach(stage => {
        (stage.tasks || []).forEach(task => {
          totalTasks++;
          totalMinutes += task.durationMin || 0;
          if (completions[task.id]) completedTasks++;
        });
      });
    }

    const overallPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const dailyBudget = profile ? profile.dailyBudgetMin : 60;
    const trackTitle = activeTrack ? activeTrack.title : 'Frontend Web Development';

    elements.mounts.dashboard.innerHTML = `
      <div class="schedule-hero">
        <div class="schedule-hero-header">
          <div>
            <span class="highlight-pill">${profile ? 'Active Learning Goal' : 'Default Preview'}</span>
            <h2 class="schedule-hero-title" style="margin-top: 0.5rem;">${trackTitle}</h2>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <button type="button" class="btn-preset" id="dash-btn-edit-goals">Edit Goals</button>
            <button type="button" class="btn-primary" id="dash-btn-schedule">
              View Today's Schedule &rarr;
            </button>
          </div>
        </div>

        <div class="roadmap-stats-row">
          <div class="roadmap-stat-item">
            <span class="roadmap-stat-val">${completedTasks} / ${totalTasks}</span>
            <span class="roadmap-stat-lbl">Tasks Mastered</span>
          </div>
          <div class="roadmap-stat-item">
            <span class="roadmap-stat-val">${overallPct}%</span>
            <span class="roadmap-stat-lbl">Roadmap Progress</span>
          </div>
          <div class="roadmap-stat-item">
            <span class="roadmap-stat-val">${dailyBudget} min</span>
            <span class="roadmap-stat-lbl">Daily Target</span>
          </div>
        </div>

        <div class="progress-container" style="margin-top: 1.5rem;">
          <div class="progress-meta">
            <span class="progress-label">Overall Completion</span>
            <span class="progress-value">${overallPct}%</span>
          </div>
          <div class="progress-track" role="progressbar" aria-valuenow="${overallPct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-fill" style="width: ${overallPct}%;"></div>
          </div>
        </div>
      </div>

      <div class="options-grid" style="margin-top: 1.5rem;">
        <div class="card" style="padding: 1.25rem;">
          <h3 style="font-size: 1.1rem; margin-bottom: 0.5rem;">📅 Daily Schedule</h3>
          <p style="color: var(--color-text-muted); font-size: 0.875rem; margin-bottom: 1rem;">
            Work through today's allocated tasks tailored to your ${dailyBudget}-min budget.
          </p>
          <button type="button" class="btn-primary" style="font-size: 0.85rem;" id="dash-link-schedule">Open Daily Planner</button>
        </div>

        <div class="card" style="padding: 1.25rem;">
          <h3 style="font-size: 1.1rem; margin-bottom: 0.5rem;">🗺️ Structured Roadmap</h3>
          <p style="color: var(--color-text-muted); font-size: 0.875rem; margin-bottom: 1rem;">
            Explore sequential stages, prerequisite graphs, and full curriculum milestones.
          </p>
          <button type="button" class="btn-preset" style="font-size: 0.85rem;" id="dash-link-roadmap">View Roadmap</button>
        </div>
      </div>
    `;

    const btnSched1 = elements.mounts.dashboard.querySelector('#dash-btn-schedule');
    const btnSched2 = elements.mounts.dashboard.querySelector('#dash-link-schedule');
    const btnRoadmap = elements.mounts.dashboard.querySelector('#dash-link-roadmap');
    const btnDashEditGoals = elements.mounts.dashboard.querySelector('#dash-btn-edit-goals');

    if (btnSched1) btnSched1.addEventListener('click', () => navigateTo('schedule'));
    if (btnSched2) btnSched2.addEventListener('click', () => navigateTo('schedule'));
    if (btnRoadmap) btnRoadmap.addEventListener('click', () => navigateTo('roadmap'));
    if (btnDashEditGoals) {
      btnDashEditGoals.addEventListener('click', () => {
        const btnEditGoals = document.getElementById('btn-edit-goals');
        if (btnEditGoals) {
          btnEditGoals.click();
        }
      });
    }
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
      applyOnboardingGating();
      navigateTo('dashboard');
    });

    // React when user marks tasks completed
    window.addEventListener('skillflow:task-toggled', () => {
      if (state.currentView === 'dashboard') {
        renderDashboard();
      }
    });

    // Edit Goals button handler
    const btnEditGoals = document.getElementById('btn-edit-goals');
    if (btnEditGoals) {
      btnEditGoals.addEventListener('click', () => {
        if (elements.views.onboarding) {
          elements.views.onboarding.style.display = 'block';
          elements.views.onboarding.classList.add('active');
        }
        Object.entries(elements.views).forEach(([name, container]) => {
          if (container && name !== 'onboarding') {
            container.classList.remove('active');
          }
        });
        elements.navButtons.forEach(btn => btn.classList.remove('active'));
        state.currentView = 'onboarding';
        if (elements.views.onboarding) {
          elements.views.onboarding.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    // Mandatory Log Out handler
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        localStorage.removeItem('skillflow_user');
        window.location.replace('auth.html');
      });
    }
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
   * Update header user indicator if user is signed in
   */
  function updateAuthIndicator() {
    try {
      const rawUser = localStorage.getItem('skillflow_user');
      const btnLogout = document.getElementById('btn-logout');
      if (rawUser && btnLogout) {
        const user = JSON.parse(rawUser);
        if (user && user.email) {
          btnLogout.title = `Signed in as ${user.email} • Click to log out`;
        }
      }
    } catch (e) {}
  }

  /**
   * Initialize SkillFlow Application
   */
  async function init() {
    bindEvents();
    checkPersistedProfile();
    updateAuthIndicator();
    await loadLearningPaths();
    applyOnboardingGating();
    console.log('SkillFlow initialized.');
  }

  // Public API
  window.SkillFlowApp = {
    navigateTo,
    applyOnboardingGating,
    renderDashboard
  };

  // Bootstrap when DOM is fully parsed
  document.addEventListener('DOMContentLoaded', init);
})();
