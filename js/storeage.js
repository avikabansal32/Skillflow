// js/storage.js

const StorageDB = {
  // KEYS
  KEYS: {
    USER: 'skillflow_user',
    PROFILE: 'skillflow_profile',
    TASKS: 'skillflow_tasks'
  },

  // Initialize DB with seed tasks if empty
  async initDB() {
    if (!localStorage.getItem(this.KEYS.TASKS)) {
      try {
        const res = await fetch('data/learning-paths.json');
        const data = await res.json();
        // Flatten tasks and mark default completed: false
        const allTasks = {};
        data.tracks.forEach(track => {
          track.tasks.forEach(t => {
            allTasks[t.id] = { ...t, trackId: track.id, completed: false };
          });
        });
        localStorage.setItem(this.KEYS.TASKS, JSON.stringify(allTasks));
      } catch (err) {
        console.error("Failed to seed database:", err);
      }
    }
  },

  // GET User Profile
  getProfile() {
    return JSON.parse(localStorage.getItem(this.KEYS.PROFILE)) || null;
  },

  // SAVE User Profile
  saveProfile(profile) {
    localStorage.setItem(this.KEYS.PROFILE, JSON.stringify(profile));
    localStorage.setItem('skillflow_profile_completed', 'true');
  },

  // GET All Tasks
  getTasks() {
    return JSON.parse(localStorage.getItem(this.KEYS.TASKS)) || {};
  },

  // UPDATE Single Task Status
  setTaskStatus(taskId, isCompleted) {
    const tasks = this.getTasks();
    if (tasks[taskId]) {
      tasks[taskId].completed = isCompleted;
      localStorage.setItem(this.KEYS.TASKS, JSON.stringify(tasks));
    }
  },

  // RESET All Data (For Demo testing)
  resetDatabase() {
    localStorage.clear();
    window.location.reload();
  }
};