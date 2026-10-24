/**
 * SkillFlow — Scheduler Module
 * Filters learning tasks according to the user's daily study budget,
 * strictly enforces prerequisite dependencies, manages 'Today' vs 'Upcoming',
 * implements Adaptive Rescheduling ('Find My New Rhythm'),
 * and synchronizes completion state and progress bars with localStorage.
 */

(() => {
  'use strict';

  const STORAGE_PROFILE_KEY = 'skillflow_user_profile';
  const STORAGE_COMPLETIONS_KEY = 'skillflow_task_completions';
  const STORAGE_TODAY_CACHE_KEY = 'skillflow_today_assigned_ids';
  const STORAGE_ADAPTIVE_KEY = 'skillflow_adaptive_plan';

  let cachedTracks = null;

  /**
   * Retrieve active user profile
   */
  function getUserProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('SkillFlow [Scheduler]: Error reading profile', err);
      return null;
    }
  }

  /**
   * Retrieve task completion records
   * @returns {Object.<string, boolean>}
   */
  function getTaskCompletions() {
    try {
      const raw = localStorage.getItem(STORAGE_COMPLETIONS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn('SkillFlow [Scheduler]: Error reading completions', err);
      return {};
    }
  }

  /**
   * Update task completion in localStorage and notify listeners
   * @param {string} taskId
   * @param {boolean} isCompleted
   */
  function setTaskCompletion(taskId, isCompleted) {
    const completions = getTaskCompletions();
    completions[taskId] = Boolean(isCompleted);

    try {
      localStorage.setItem(STORAGE_COMPLETIONS_KEY, JSON.stringify(completions));
      console.log(`SkillFlow [Scheduler]: Saved completion for "${taskId}":`, isCompleted);
    } catch (err) {
      console.error('SkillFlow [Scheduler]: Failed to save completion', err);
    }

    // Broadcast change
    window.dispatchEvent(
      new CustomEvent('skillflow:task-toggled', {
        detail: { taskId, completed: Boolean(isCompleted) }
      })
    );
  }

  /**
   * Get adaptive plan from localStorage if active
   */
  function getAdaptivePlan() {
    try {
      const raw = localStorage.getItem(STORAGE_ADAPTIVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Save adaptive plan to localStorage
   */
  function setAdaptivePlan(plan) {
    try {
      localStorage.setItem(STORAGE_ADAPTIVE_KEY, JSON.stringify(plan));
    } catch (err) {
      console.warn('SkillFlow [Scheduler]: Could not save adaptive plan', err);
    }
  }

  /**
   * Clear adaptive plan
   */
  function clearAdaptivePlan() {
    try {
      localStorage.removeItem(STORAGE_ADAPTIVE_KEY);
      localStorage.removeItem(STORAGE_TODAY_CACHE_KEY);
    } catch (err) {
      console.warn('SkillFlow [Scheduler]: Could not clear adaptive plan', err);
    }
  }

  /**
   * Load tracks from data/learning-paths.json
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
      console.error('SkillFlow [Scheduler]: Failed to load tracks', err);
      return [];
    }
  }

  /**
   * Build lookup of tasks by id
   */
  function buildTaskDictionary(tracks) {
    const dict = {};
    tracks.forEach(track => {
      (track.stages || []).forEach(stage => {
        (stage.tasks || []).forEach(task => {
          dict[task.id] = { ...task, stageTitle: stage.title, stageId: stage.id };
        });
      });
    });
    return dict;
  }

  /**
   * Get cached IDs assigned to today, if any
   */
  function getTodayAssignedIds() {
    return null;
  }

  /**
   * Save cached IDs assigned to today
   */
  function saveTodayAssignedIds(ids) {
    // No-op: Scheduling is deterministic and packs multiple tasks dynamically
  }

  /**
   * Core Deterministic Task Scheduling Engine
   * Packs multiple tasks into "Today's Schedule" strictly up to the user's daily study budget,
   * respecting sequential stage and prerequisite task dependencies.
   *
   * @param {Object} activeTrack
   * @param {number} [standardBudgetMin]
   * @param {Object.<string, boolean>} [completionsOverride]
   * @returns {{
   *   todaysTasks: Array,
   *   todayTasks: Array,
   *   upcomingTasks: Array,
   *   totalBudget: number,
   *   remainingTime: number,
   *   plannedTime: number,
   *   allocatedMinutes: number,
   *   effectiveBudget: number,
   *   standardBudgetMin: number,
   *   isAdaptive: boolean,
   *   adaptivePlan: Object|null,
   *   allOrderedTasks: Array
   * }}
   */
  function computeDailySchedule(activeTrack, standardBudgetMin, completionsOverride) {
    const profile = getUserProfile();
    const completions = completionsOverride !== undefined ? completionsOverride : getTaskCompletions();
    const adaptivePlan = getAdaptivePlan();
    const isAdaptive = Boolean(adaptivePlan && adaptivePlan.isAdapted);

    // 1. Retrieve the user's daily available time in minutes (dailyMinutes = parseInt(userProfile.dailyTime) || 60)
    let dailyMinutes = standardBudgetMin !== undefined
      ? parseInt(standardBudgetMin, 10)
      : (profile ? (parseInt(profile.dailyTime, 10) || parseInt(profile.dailyBudgetMin, 10) || 60) : 60);

    if (isNaN(dailyMinutes) || dailyMinutes <= 0) {
      dailyMinutes = 60;
    }

    const totalBudget = isAdaptive ? (adaptivePlan.adaptedBudgetMin || 30) : dailyMinutes;

    // 2. Keep a running tally: let remainingTime = dailyMinutes; let todaysTasks = [];
    let remainingTime = totalBudget;
    const todaysTasks = [];
    const upcomingTasks = [];

    // Track completed tasks and tasks scheduled for today
    const completedIds = new Set(
      Object.keys(completions).filter(id => Boolean(completions[id]))
    );
    const satisfiedPrereqs = new Set(completedIds);

    // Guard against missing track
    if (!activeTrack || !Array.isArray(activeTrack.stages)) {
      return {
        todaysTasks,
        todayTasks: todaysTasks,
        upcomingTasks,
        totalBudget,
        remainingTime,
        plannedTime: 0,
        allocatedMinutes: 0,
        effectiveBudget: totalBudget,
        standardBudgetMin: dailyMinutes,
        isAdaptive,
        adaptivePlan,
        allOrderedTasks: []
      };
    }

    // Flatten all roadmap tasks in sequential stage order
    const allOrderedTasks = [];
    activeTrack.stages.forEach(stage => {
      (stage.tasks || []).forEach(task => {
        allOrderedTasks.push({
          ...task,
          stageTitle: stage.title,
          stageId: stage.id,
          isCompleted: Boolean(completions[task.id])
        });
      });
    });

    // 3. Loop through the uncompleted roadmap tasks in sequential/dependency order:
    allOrderedTasks.forEach(task => {
      if (task.isCompleted) {
        return;
      }

      // Check if the task's prerequisites are all completed
      const prereqs = task.prerequisites || [];
      const arePrereqsMet = prereqs.every(pId => satisfiedPrereqs.has(pId));

      // If task.durationMin <= remainingTime
      if (arePrereqsMet && task.durationMin <= remainingTime) {
        // Add this task to todaysTasks
        todaysTasks.push(task);
        // Subtract task.durationMin from remainingTime
        remainingTime -= task.durationMin;
        // Mark as satisfied for downstream tasks scheduled in today's session
        satisfiedPrereqs.add(task.id);
      } else {
        // Push it into the upcomingTasks / "Next Up" queue instead of today's schedule
        const reason = !arePrereqsMet
          ? 'Prerequisites pending'
          : (isAdaptive ? 'Rescheduled for tomorrow' : "Exceeds today's budget");
        upcomingTasks.push({
          ...task,
          scheduleReason: reason
        });
      }
    });

    // Sort upcoming tasks so overflow tasks rescheduled for tomorrow appear first if adaptive
    upcomingTasks.sort((a, b) => {
      const aTomorrow = a.scheduleReason === 'Rescheduled for tomorrow' ? 1 : 0;
      const bTomorrow = b.scheduleReason === 'Rescheduled for tomorrow' ? 1 : 0;
      return bTomorrow - aTomorrow;
    });

    const plannedTime = totalBudget - remainingTime;

    return {
      todaysTasks,
      todayTasks: todaysTasks,
      upcomingTasks,
      totalBudget,
      remainingTime,
      plannedTime,
      allocatedMinutes: plannedTime,
      effectiveBudget: totalBudget,
      standardBudgetMin: dailyMinutes,
      isAdaptive,
      adaptivePlan,
      allOrderedTasks
    };
  }

  /**
   * Preview calculation for the Reschedule Modal
   * Calculates what fits vs overflows for a given minute budget
   * @param {number} availableMins
   */
  async function computeReschedulePreview(availableMins) {
    const tracks = await fetchLearningPaths();
    const profile = getUserProfile();
    const activeTrackId = profile ? profile.trackId : 'frontend-web-development';
    const activeTrack = tracks.find(t => t.id === activeTrackId) || tracks[0];
    const completions = getTaskCompletions();
    const completedIds = new Set(Object.keys(completions).filter(id => completions[id]));

    const allOrderedTasks = [];
    activeTrack.stages.forEach(stage => {
      stage.tasks.forEach(task => {
        allOrderedTasks.push({ ...task, isCompleted: Boolean(completions[task.id]) });
      });
    });

    let minsAllocated = 0;
    const fittingTasks = [];
    const tomorrowTasks = [];
    const simulatedUnlocked = new Set(completedIds);

    allOrderedTasks.forEach(task => {
      if (task.isCompleted) {
        simulatedUnlocked.add(task.id);
        return;
      }

      const prereqs = task.prerequisites || [];
      const met = prereqs.every(pId => simulatedUnlocked.has(pId));
      if (!met) return;

      if (minsAllocated + task.durationMin <= availableMins) {
        minsAllocated += task.durationMin;
        fittingTasks.push(task);
        simulatedUnlocked.add(task.id);
      } else {
        tomorrowTasks.push(task);
      }
    });

    return {
      availableMins,
      minsAllocated,
      fittingCount: fittingTasks.length,
      tomorrowCount: tomorrowTasks.length,
      fittingTasks,
      tomorrowTasks
    };
  }

  /**
   * Open the Adaptive Reschedule Modal
   */
  async function openRescheduleModal() {
    const modal = document.getElementById('reschedule-modal');
    if (!modal) return;

    const input = document.getElementById('adaptive-time-input');
    const previewSummary = document.getElementById('modal-preview-summary');

    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    // Synchronize preview
    async function updatePreview() {
      const mins = parseInt(input.value, 10) || 0;
      const preview = await computeReschedulePreview(mins);

      if (previewSummary) {
        if (preview.fittingCount > 0) {
          previewSummary.innerHTML = `
            <strong>⚡ Plan Preview:</strong>
            ${preview.fittingCount} task (${preview.minsAllocated} mins) fits into today's remaining time.<br>
            <span style="color: #B45309;">${preview.tomorrowCount} unfinished task(s) gently queued for tomorrow.</span>
          `;
        } else {
          previewSummary.innerHTML = `
            <strong>⚡ Plan Preview:</strong>
            No single task fits under ${mins} mins.<br>
            <span style="color: #B45309;">All unfinished tasks will be rescheduled for tomorrow so you can rest guilt-free! 🎉</span>
          `;
        }
      }
    }

    if (input) {
      input.focus();
      updatePreview();
    }
  }

  /**
   * Close the Adaptive Reschedule Modal
   */
  function closeRescheduleModal() {
    const modal = document.getElementById('reschedule-modal');
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  /**
   * Apply adaptive reschedule plan and refresh UI without reload
   * @param {number} adjustedMins
   */
  function applyAdaptiveReschedule(adjustedMins) {
    const mins = Math.max(0, parseInt(adjustedMins, 10) || 30);

    const adaptivePayload = {
      isAdapted: true,
      adaptedBudgetMin: mins,
      timestamp: new Date().toISOString()
    };

    setAdaptivePlan(adaptivePayload);
    // Remove stale cache so computeDailySchedule recalculates with adjusted budget
    localStorage.removeItem(STORAGE_TODAY_CACHE_KEY);

    closeRescheduleModal();

    // Refresh UI cleanly without page reload
    renderSchedule();
    console.log(`SkillFlow [Scheduler]: Adaptive reschedule applied (${mins} mins). UI refreshed cleanly.`);

    // Broadcast change
    window.dispatchEvent(
      new CustomEvent('skillflow:schedule-adapted', {
        detail: adaptivePayload
      })
    );
  }

  /**
   * Render Today's Schedule and Upcoming Tasks
   */
  async function renderSchedule() {
    const container = document.getElementById('schedule-container');
    if (!container) return;

    const tracks = await fetchLearningPaths();
    if (!tracks || !tracks.length) {
      container.innerHTML = `<div class="state-box"><p>Unable to load learning paths.</p></div>`;
      return;
    }

    const profile = getUserProfile();
    const activeTrackId = profile ? profile.trackId : 'frontend-web-development';
    const standardDailyBudget = profile ? (parseInt(profile.dailyTime, 10) || parseInt(profile.dailyBudgetMin, 10) || 60) : 60;
    const activeTrack = tracks.find(t => t.id === activeTrackId) || tracks[0];
    const taskDict = buildTaskDictionary(tracks);
    const completions = getTaskCompletions();

    const schedule = computeDailySchedule(activeTrack, standardDailyBudget, completions);
    const todayTasks = schedule.todaysTasks;
    const upcomingTasks = schedule.upcomingTasks;

    // Metric Calculations
    const todayCompletedTasks = todayTasks.filter(t => completions[t.id]);
    const todayCompletedCount = todayCompletedTasks.length;
    const todayTotalCount = todayTasks.length;
    const todayCompletedMinutes = todayCompletedTasks.reduce((sum, t) => sum + (t.durationMin || 0), 0);
    const todayCompletionPct = todayTotalCount > 0 ? Math.round((todayCompletedCount / todayTotalCount) * 100) : 0;
    const budgetUtilizationPct = schedule.totalBudget > 0
      ? Math.min(100, Math.round((schedule.plannedTime / schedule.totalBudget) * 100))
      : 0;

    // Has unfinished tasks today
    const hasUnfinishedTasks = todayTasks.some(t => !completions[t.id]);

    // Overall Track Completion
    const totalTrackTasks = schedule.allOrderedTasks.length;
    const totalTrackCompleted = schedule.allOrderedTasks.filter(t => completions[t.id]).length;
    const overallTrackPct = totalTrackTasks > 0 ? Math.round((totalTrackCompleted / totalTrackTasks) * 100) : 0;

    // Summary Header text according to specification:
    // "Today's Budget: [Total] mins | Planned: [Total - remainingTime] mins | Remaining: [remainingTime] mins"
    const summaryHeaderText = `Today's Budget: ${schedule.totalBudget} mins | Planned: ${schedule.totalBudget - schedule.remainingTime} mins | Remaining: ${schedule.remainingTime} mins`;

    let html = `
      <!-- Schedule Hero & Daily Budget Gauge -->
      <div class="schedule-hero">
        <div class="schedule-hero-header">
          <div>
            <span class="schedule-track-pill">${activeTrack.title}</span>
            <h2 class="schedule-hero-title" style="margin-top: 0.5rem;">Today's Learning Schedule</h2>
          </div>
          
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            ${hasUnfinishedTasks ? `
              <button type="button" class="btn-rhythm" id="btn-open-reschedule" title="Plans change? Reorganize around available time">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                <span>Find My New Rhythm</span>
              </button>
            ` : ''}

            <button type="button" class="btn-preset" id="btn-recalculate-schedule" title="Re-evaluate schedule based on current progress">
              ↻ Refresh Plan
            </button>
          </div>
        </div>

        <!-- Summary Header Pill -->
        <div class="schedule-summary-header" id="schedule-summary-header">
          ${summaryHeaderText}
        </div>

        ${schedule.isAdaptive ? `
          <!-- Adaptive Plan Active Banner -->
          <div class="adaptive-banner">
            <div class="adaptive-banner-text">
              <span>✨ <strong>New Rhythm Active:</strong> Today's schedule adapted to ${schedule.totalBudget} mins. Overflow tasks gently queued for tomorrow.</span>
            </div>
            <button type="button" class="btn-link" id="btn-reset-adaptive">Reset to Standard Plan (${schedule.standardBudgetMin} mins)</button>
          </div>
        ` : ''}

        <!-- Budget Gauge -->
        <div class="budget-gauge-box">
          <div class="progress-meta">
            <span class="progress-label">Daily Study Time Budget ${schedule.isAdaptive ? '(Adapted)' : ''}</span>
            <span class="progress-value">${schedule.plannedTime} / ${schedule.totalBudget} mins allocated</span>
          </div>
          <div class="progress-track" role="progressbar" aria-valuenow="${budgetUtilizationPct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-fill ${budgetUtilizationPct >= 100 ? 'amber' : ''}" style="width: ${budgetUtilizationPct}%;"></div>
          </div>
          <div class="budget-gauge-details">
            <span>Budget Utilized: <strong>${budgetUtilizationPct}%</strong></span>
            <span>Active Target: <strong>${schedule.totalBudget} mins/day</strong></span>
          </div>
        </div>

        <!-- Today's Completion Progress Bar -->
        <div class="progress-container" style="margin-top: 1rem;">
          <div class="progress-meta">
            <span class="progress-label">Today's Goal Progress</span>
            <span class="progress-value">${todayCompletedCount} of ${todayTotalCount} tasks completed (${todayCompletionPct}%)</span>
          </div>
          <div class="progress-track" role="progressbar" aria-valuenow="${todayCompletionPct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-fill" style="width: ${todayCompletionPct}%;"></div>
          </div>
        </div>

        <!-- Overall Roadmap Context Bar -->
        <div class="progress-container" style="margin-top: 0.75rem;">
          <div class="progress-meta">
            <span class="progress-label" style="font-size: var(--font-size-xs); color: var(--color-text-muted);">Overall Track Progress</span>
            <span class="progress-value" style="font-size: var(--font-size-xs);">${totalTrackCompleted}/${totalTrackTasks} completed (${overallTrackPct}%)</span>
          </div>
          <div class="progress-track" style="height: 6px;">
            <div class="progress-fill peach" style="width: ${overallTrackPct}%;"></div>
          </div>
        </div>
      </div>
    `;

    // 1. Render 'Today's Schedule' Section
    html += `
      <section class="schedule-section" aria-labelledby="heading-today-tasks">
        <div class="schedule-section-header">
          <h3 id="heading-today-tasks" class="schedule-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>Today's Schedule</span>
          </h3>
          <span class="highlight-pill">${todayCompletedCount}/${todayTotalCount} Completed</span>
        </div>
        <div class="schedule-budget-summary">
          ${summaryHeaderText}
        </div>
    `;

    if (todayTasks.length === 0) {
      html += `
        <div class="state-box">
          <h3>No tasks scheduled for today</h3>
          <p>${schedule.isAdaptive ? "Your remaining tasks have been queued for tomorrow. Take some rest!" : "You have completed all ready tasks or need to refresh your plan."}</p>
          <div style="display: flex; justify-content: center; gap: 0.5rem; margin-top: 1rem;">
            <button type="button" class="btn-primary" id="btn-replan-today">Re-plan Today</button>
            ${schedule.isAdaptive ? '<button type="button" class="btn-preset" id="btn-reset-adaptive-empty">Reset to Standard Rhythm</button>' : ''}
          </div>
        </div>
      `;
    } else {
      html += `<div class="task-list">`;
      todayTasks.forEach(task => {
        const isDone = Boolean(completions[task.id]);
        const prereqs = task.prerequisites || [];

        html += `
          <div class="task-item ${isDone ? 'completed' : ''}" id="task-card-${task.id}">
            <div class="task-checkbox-wrapper">
              <input
                type="checkbox"
                class="task-checkbox schedule-task-checkbox"
                id="check-today-${task.id}"
                data-task-id="${task.id}"
                ${isDone ? 'checked' : ''}
                aria-label="Mark ${task.title} as completed"
              >
            </div>
            <div class="task-body">
              <div class="task-main-row">
                <label for="check-today-${task.id}" class="task-title" style="cursor: pointer;">
                  ${task.title}
                </label>
                <div class="task-meta-badges">
                  <span class="badge-duration">${task.durationMin} mins</span>
                  <span class="badge-stage">${task.stageTitle}</span>
                  <span class="badge-status scheduled">${isDone ? '✓ Completed' : 'Scheduled for Today'}</span>
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
      html += `</div>`;

      // If there are unfinished tasks, render an adaptive reschedule footer callout
      if (hasUnfinishedTasks) {
        html += `
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; margin-top: 1rem; padding: 0.75rem 1.25rem; background: rgba(249, 200, 180, 0.22); border-radius: var(--radius-md); font-size: var(--font-size-sm); color: var(--heading-color);">
            <span>Short on time today? Let's adapt your schedule around what you have available.</span>
            <button type="button" class="btn-rhythm" id="btn-open-reschedule-subtle">
              Find My New Rhythm &rarr;
            </button>
          </div>
        `;
      }

      // Celebratory banner if all today's tasks are checked
      if (todayTotalCount > 0 && todayCompletedCount === todayTotalCount) {
        html += `
          <div class="onboarding-feedback success" style="margin-top: 1rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
            <span>🎉 Outstanding! You have completed all of today's scheduled tasks (${todayCompletedMinutes} mins).</span>
            <button type="button" class="btn-link" id="btn-advance-schedule" style="color: var(--primary-action);">
              Advance to Next Study Session &rarr;
            </button>
          </div>
        `;
      }
    }
    html += `</section>`;

    // 2. Render 'Upcoming Tasks' Section (Exceeds budget, tomorrow's queue, or waiting on prereqs)
    html += `
      <section class="schedule-section" aria-labelledby="heading-upcoming-tasks">
        <div class="schedule-section-header">
          <h3 id="heading-upcoming-tasks" class="schedule-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <span>Upcoming Tasks &amp; Queue</span>
          </h3>
          <span class="badge-stage">${upcomingTasks.length} in Queue</span>
        </div>
        <p style="color: var(--color-text-muted); font-size: var(--font-size-sm); margin-bottom: var(--spacing-md);">
          Tasks queued for future sessions because they exceed today's budget, have been gently rescheduled for tomorrow, or are pending prerequisites.
        </p>
    `;

    if (upcomingTasks.length === 0) {
      html += `
        <div class="state-box">
          <p>No remaining upcoming tasks in this track!</p>
        </div>
      `;
    } else {
      html += `<div class="task-list">`;
      upcomingTasks.forEach(task => {
        const isDone = Boolean(completions[task.id]);
        const prereqs = task.prerequisites || [];
        const unmetPrereqs = prereqs.filter(pId => !completions[pId]);
        const arePrereqsMet = unmetPrereqs.length === 0;

        let reasonBadgeClass = 'locked';
        let reasonBadgeText = task.scheduleReason || 'Queued';

        if (isDone) {
          reasonBadgeClass = 'scheduled';
          reasonBadgeText = 'Completed';
        } else if (task.scheduleReason === "Rescheduled for tomorrow") {
          reasonBadgeClass = 'tomorrow';
          reasonBadgeText = "Rescheduled for tomorrow";
        } else if (task.scheduleReason === "Exceeds today's budget") {
          reasonBadgeClass = 'exceeded';
          reasonBadgeText = "Exceeds today's budget";
        } else if (!arePrereqsMet) {
          reasonBadgeClass = 'locked';
          reasonBadgeText = 'Prerequisites pending';
        }

        html += `
          <div class="task-item ${isDone ? 'completed' : ''} ${!isDone && !arePrereqsMet ? 'locked' : ''}">
            <div class="task-checkbox-wrapper">
              <input
                type="checkbox"
                class="task-checkbox schedule-upcoming-checkbox"
                id="check-upcoming-${task.id}"
                data-task-id="${task.id}"
                ${isDone ? 'checked' : ''}
                aria-label="Mark ${task.title} as completed"
              >
            </div>
            <div class="task-body">
              <div class="task-main-row">
                <label for="check-upcoming-${task.id}" class="task-title" style="cursor: pointer;">
                  ${task.title}
                </label>
                <div class="task-meta-badges">
                  <span class="badge-duration">${task.durationMin} mins</span>
                  <span class="badge-stage">${task.stageTitle}</span>
                  <span class="badge-status ${reasonBadgeClass}">${reasonBadgeText}</span>
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
      html += `</div>`;
    }

    html += `</section>`;

    container.innerHTML = html;

    // Attach event listeners for checkboxes
    container.querySelectorAll('.schedule-task-checkbox, .schedule-upcoming-checkbox').forEach(box => {
      box.addEventListener('change', (e) => {
        const taskId = e.target.dataset.taskId;
        setTaskCompletion(taskId, e.target.checked);
      });
    });

    // Wire 'Find My New Rhythm' trigger buttons
    const btnReschedule1 = container.querySelector('#btn-open-reschedule');
    const btnReschedule2 = container.querySelector('#btn-open-reschedule-subtle');
    if (btnReschedule1) btnReschedule1.addEventListener('click', openRescheduleModal);
    if (btnReschedule2) btnReschedule2.addEventListener('click', openRescheduleModal);

    // Reset adaptive plan buttons
    const btnResetAdaptive = container.querySelector('#btn-reset-adaptive');
    const btnResetAdaptiveEmpty = container.querySelector('#btn-reset-adaptive-empty');
    if (btnResetAdaptive) {
      btnResetAdaptive.addEventListener('click', () => {
        clearAdaptivePlan();
        renderSchedule();
      });
    }
    if (btnResetAdaptiveEmpty) {
      btnResetAdaptiveEmpty.addEventListener('click', () => {
        clearAdaptivePlan();
        renderSchedule();
      });
    }

    // Refresh Schedule button
    const btnRefresh = container.querySelector('#btn-recalculate-schedule');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        clearAdaptivePlan();
        renderSchedule();
      });
    }

    // Replan Today button
    const btnReplan = container.querySelector('#btn-replan-today');
    if (btnReplan) {
      btnReplan.addEventListener('click', () => {
        clearAdaptivePlan();
        renderSchedule();
      });
    }

    // Advance session button
    const btnAdvance = container.querySelector('#btn-advance-schedule');
    if (btnAdvance) {
      btnAdvance.addEventListener('click', () => {
        clearAdaptivePlan();
        renderSchedule();
      });
    }
  }

  /**
   * Wire Adaptive Reschedule Modal Event Handlers
   */
  function bindModalEvents() {
    const modal = document.getElementById('reschedule-modal');
    if (!modal) return;

    const btnClose = document.getElementById('btn-close-modal');
    const btnCancel = document.getElementById('btn-cancel-reschedule');
    const btnApply = document.getElementById('btn-apply-reschedule');
    const inputMins = document.getElementById('adaptive-time-input');
    const presetButtons = document.querySelectorAll('.modal-time-preset');

    if (btnClose) btnClose.addEventListener('click', closeRescheduleModal);
    if (btnCancel) btnCancel.addEventListener('click', closeRescheduleModal);

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeRescheduleModal();
      }
    });

    // Close on Esc key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) {
        closeRescheduleModal();
      }
    });

    // Quick time presets in modal
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = btn.dataset.mins;
        if (inputMins) {
          inputMins.value = mins;
          presetButtons.forEach(b => b.classList.toggle('active', b === btn));
          // Dispatch input event to recalculate preview
          inputMins.dispatchEvent(new Event('input'));
        }
      });
    });

    // Live preview on manual input
    if (inputMins) {
      inputMins.addEventListener('input', async (e) => {
        const val = parseInt(e.target.value, 10);
        presetButtons.forEach(b => {
          b.classList.toggle('active', Number(b.dataset.mins) === val);
        });

        const previewSummary = document.getElementById('modal-preview-summary');
        if (previewSummary) {
          const preview = await computeReschedulePreview(val || 0);
          if (preview.fittingCount > 0) {
            previewSummary.innerHTML = `
              <strong>⚡ Plan Preview:</strong>
              ${preview.fittingCount} task (${preview.minsAllocated} mins) fits into today's remaining time.<br>
              <span style="color: #B45309;">${preview.tomorrowCount} unfinished task(s) gently queued for tomorrow.</span>
            `;
          } else {
            previewSummary.innerHTML = `
              <strong>⚡ Plan Preview:</strong>
              No single task fits under ${val} mins.<br>
              <span style="color: #B45309;">All unfinished tasks will be rescheduled for tomorrow so you can rest guilt-free! 🎉</span>
            `;
          }
        }
      });
    }

    // Apply button
    if (btnApply) {
      btnApply.addEventListener('click', () => {
        const mins = inputMins ? parseInt(inputMins.value, 10) : 30;
        applyAdaptiveReschedule(mins);
      });
    }
  }

  /**
   * Bind global listeners
   */
  function bindEvents() {
    window.addEventListener('skillflow:task-toggled', () => {
      renderSchedule();
    });

    window.addEventListener('skillflow:profile-saved', () => {
      clearAdaptivePlan();
      renderSchedule();
    });

    bindModalEvents();
  }

  /**
   * Initialize module
   */
  function init() {
    bindEvents();
    renderSchedule();
  }

  // Public API
  window.SkillFlowScheduler = {
    renderSchedule,
    computeDailySchedule,
    computeReschedulePreview,
    applyAdaptiveReschedule,
    openRescheduleModal,
    closeRescheduleModal,
    clearAdaptivePlan,
    setTaskCompletion
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
