/**
 * SkillFlow — Roadmap Module
 * Visualizes the complete structured learning path, stage progression,
 * prerequisite dependency status, and synchronized progress metrics.
 */

(() => {
  'use strict';

  const STORAGE_PROFILE_KEY = 'skillflow_user_profile';
  const STORAGE_COMPLETIONS_KEY = 'skillflow_task_completions';

  let cachedTracks = null;

  /**
   * Safe getter for user profile
   */
  function getUserProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('SkillFlow [Roadmap]: Error parsing profile', err);
      return null;
    }
  }

  /**
   * Safe getter for task completion state map
   * @returns {Object.<string, boolean>}
   */
  function getTaskCompletions() {
    try {
      const raw = localStorage.getItem(STORAGE_COMPLETIONS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn('SkillFlow [Roadmap]: Error parsing completions', err);
      return {};
    }
  }

  /**
   * Toggle or set task completion state in localStorage
   * @param {string} taskId
   * @param {boolean} isCompleted
   */
  function setTaskCompletion(taskId, isCompleted) {
    const completions = getTaskCompletions();
    completions[taskId] = Boolean(isCompleted);
    try {
      localStorage.setItem(STORAGE_COMPLETIONS_KEY, JSON.stringify(completions));
      console.log(`SkillFlow [Roadmap]: Updated task "${taskId}" completed:`, isCompleted);
    } catch (err) {
      console.error('SkillFlow [Roadmap]: Failed to save task completion', err);
    }

    // Broadcast change to scheduler and other views
    window.dispatchEvent(
      new CustomEvent('skillflow:task-toggled', {
        detail: { taskId, completed: Boolean(isCompleted) }
      })
    );
  }

  /**
   * Fetch tracks data from JSON
   */
  async function fetchLearningPaths() {
    if (cachedTracks) return cachedTracks;
    try {
      const response = await fetch('./data/learning-paths.json');
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const data = await response.json();
      cachedTracks = data.tracks || [];
      return cachedTracks;
    } catch (err) {
      console.error('SkillFlow [Roadmap]: Failed to fetch learning paths data', err);
      return [];
    }
  }

  /**
   * Create a lookup map for tasks by id
   * @param {Array} tracks
   */
  function buildTaskDictionary(tracks) {
    const dict = {};
    tracks.forEach(t => {
      (t.stages || []).forEach(s => {
        (s.tasks || []).forEach(task => {
          dict[task.id] = { ...task, stageTitle: s.title };
        });
      });
    });
    return dict;
  }

  /**
   * Render the entire Roadmap into #roadmap-container
   */
  async function renderRoadmap() {
    const container = document.getElementById('roadmap-container');
    if (!container) return;

    const tracks = await fetchLearningPaths();
    if (!tracks || !tracks.length) {
      container.innerHTML = `<div class="state-box"><p>Unable to load learning paths.</p></div>`;
      return;
    }

    const profile = getUserProfile();
    const activeTrackId = profile ? profile.trackId : 'frontend-web-development';
    const activeTrack = tracks.find(t => t.id === activeTrackId) || tracks[0];
    const taskDict = buildTaskDictionary(tracks);
    const completions = getTaskCompletions();

    // Calculate overall stats
    let totalTasksCount = 0;
    let completedTasksCount = 0;
    let totalMinutes = 0;

    activeTrack.stages.forEach(stage => {
      stage.tasks.forEach(task => {
        totalTasksCount++;
        totalMinutes += task.durationMin || 0;
        if (completions[task.id]) {
          completedTasksCount++;
        }
      });
    });

    const overallPct = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;
    const totalHours = (totalMinutes / 60).toFixed(1);

    // Build Hero Banner & Overall Progress
    let html = `
      <div class="roadmap-hero">
        <div class="roadmap-hero-top">
          <div>
            <span class="highlight-pill">${activeTrack.title}</span>
            <h2 style="margin-top: 0.5rem;">${activeTrack.title} Roadmap</h2>
            <p style="color: var(--color-text-muted); font-size: var(--font-size-sm); margin-top: 0.25rem;">
              ${activeTrack.description}
            </p>
          </div>
          ${!profile ? '<span class="badge-status locked">Previewing Default Track</span>' : ''}
        </div>

        <div class="roadmap-stats-row">
          <div class="roadmap-stat-item">
            <span class="roadmap-stat-val">${completedTasksCount} / ${totalTasksCount}</span>
            <span class="roadmap-stat-lbl">Tasks Completed</span>
          </div>
          <div class="roadmap-stat-item">
            <span class="roadmap-stat-val">${overallPct}%</span>
            <span class="roadmap-stat-lbl">Overall Mastery</span>
          </div>
          <div class="roadmap-stat-item">
            <span class="roadmap-stat-val">${totalHours} hrs</span>
            <span class="roadmap-stat-lbl">Total Track Scope</span>
          </div>
        </div>

        <div class="progress-container" style="margin-top: 1.25rem;">
          <div class="progress-meta">
            <span class="progress-label">Track Progress</span>
            <span class="progress-value">${overallPct}% Completed</span>
          </div>
          <div class="progress-track" role="progressbar" aria-valuenow="${overallPct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-fill" style="width: ${overallPct}%;"></div>
          </div>
        </div>
      </div>

      <div class="stages-stack">
    `;

    // Render each stage
    activeTrack.stages.forEach((stage, stageIdx) => {
      let stageTasksTotal = stage.tasks.length;
      let stageTasksCompleted = stage.tasks.filter(t => completions[t.id]).length;
      let stagePct = stageTasksTotal > 0 ? Math.round((stageTasksCompleted / stageTasksTotal) * 100) : 0;

      html += `
        <article class="stage-card" aria-labelledby="stage-title-${stage.id}">
          <div class="stage-card-header">
            <div class="stage-header-title-row">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="stage-order-tag">Stage ${stageIdx + 1}</span>
                <h3 id="stage-title-${stage.id}">${stage.title}</h3>
              </div>
              <span class="badge-stage">${stageTasksCompleted} / ${stageTasksTotal} completed</span>
            </div>
            <p class="stage-description">${stage.description || ''}</p>
            
            <div class="progress-container">
              <div class="progress-track" role="progressbar" aria-valuenow="${stagePct}" aria-valuemin="0" aria-valuemax="100">
                <div class="progress-fill ${stagePct === 100 ? '' : 'peach'}" style="width: ${stagePct}%;"></div>
              </div>
            </div>
          </div>

          <div class="stage-card-body">
            <div class="task-list">
      `;

      stage.tasks.forEach(task => {
        const isDone = Boolean(completions[task.id]);
        
        // Prerequisite satisfaction check
        const prereqs = task.prerequisites || [];
        const unmetPrereqs = prereqs.filter(pId => !completions[pId]);
        const arePrereqsMet = unmetPrereqs.length === 0;

        let statusClass = 'locked';
        let statusLabel = 'Locked';

        if (isDone) {
          statusClass = 'scheduled';
          statusLabel = 'Completed';
        } else if (arePrereqsMet) {
          statusClass = 'ready';
          statusLabel = 'Ready to Learn';
        } else {
          statusClass = 'locked';
          statusLabel = 'Prerequisites Required';
        }

        html += `
          <div class="task-item ${isDone ? 'completed' : ''} ${!isDone && !arePrereqsMet ? 'locked' : ''}">
            <div class="task-checkbox-wrapper">
              <input
                type="checkbox"
                class="task-checkbox roadmap-task-checkbox"
                id="roadmap-check-${task.id}"
                data-task-id="${task.id}"
                ${isDone ? 'checked' : ''}
                aria-label="Mark ${task.title} as completed"
              >
            </div>
            <div class="task-body">
              <div class="task-main-row">
                <label for="roadmap-check-${task.id}" class="task-title" style="cursor: pointer;">
                  ${task.title}
                </label>
                <div class="task-meta-badges">
                  <span class="badge-duration">${task.durationMin} mins</span>
                  <span class="badge-status ${statusClass}">${statusLabel}</span>
                </div>
              </div>

              ${prereqs.length > 0 ? `
                <div class="task-prereqs">
                  <span>Prerequisites:</span>
                  ${prereqs.map(pId => {
                    const prereqTask = taskDict[pId];
                    const pTitle = prereqTask ? prereqTask.title : pId;
                    const pDone = Boolean(completions[pId]);
                    return `<span class="prereq-tag ${pDone ? 'met' : 'unmet'}">${pDone ? '✓' : '⏳'} ${pTitle}</span>`;
                  }).join('')}
                </div>
              ` : ''}
            </div>
          </div>
        `;
      });

      html += `
            </div>
          </div>
        </article>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;

    // Attach checkbox toggle events
    container.querySelectorAll('.roadmap-task-checkbox').forEach(box => {
      box.addEventListener('change', (e) => {
        const taskId = e.target.dataset.taskId;
        setTaskCompletion(taskId, e.target.checked);
      });
    });
  }

  /**
   * Bind global listeners
   */
  function bindEvents() {
    window.addEventListener('skillflow:task-toggled', () => {
      renderRoadmap();
    });

    window.addEventListener('skillflow:profile-saved', () => {
      renderRoadmap();
    });
  }

  /**
   * Module initialization
   */
  function init() {
    bindEvents();
    renderRoadmap();
  }

  // Public API
  window.SkillFlowRoadmap = {
    renderRoadmap,
    getTaskCompletions,
    setTaskCompletion
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
