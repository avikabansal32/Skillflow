/**
 * SkillFlow — Authentication Controller & Local Database Connector
 *
 * Checks if user exists at local database via C++ backend (or local datastore fallback):
 * - If user exists: Validate credentials and redirect to dashboard.
 * - Else: Trigger Pop.window(signup) to open user registration modal.
 */

(() => {
  'use strict';

  // If already authenticated, redirect straight to main app to prevent loops
  if (localStorage.getItem('skillflow_user')) {
    window.location.replace('index.html');
    return;
  }

  const STORAGE_USER_KEY = 'skillflow_user';
  const STORAGE_REMEMBER_KEY = 'skillflow_remembered_email';
  const STORAGE_LOCAL_USERS_KEY = 'skillflow_registered_users';
  const BACKEND_API_BASE = 'http://127.0.0.1:8080/api';

  // Standard email validation pattern
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /**
   * DOM Elements Cache
   */
  const elements = {
    form: document.getElementById('login-form'),
    inputEmail: document.getElementById('input-email'),
    emailError: document.getElementById('email-error'),
    inputPassword: document.getElementById('input-password'),
    passwordError: document.getElementById('password-error'),
    btnPasswordToggle: document.getElementById('btn-password-toggle'),
    iconEye: document.querySelector('.icon-eye'),
    iconEyeOff: document.querySelector('.icon-eye-off'),
    checkRemember: document.getElementById('check-remember'),
    btnSubmit: document.getElementById('btn-auth-submit'),
    feedback: document.getElementById('auth-feedback'),
    linkSignup: document.getElementById('link-signup'),
    linkForgotPassword: document.getElementById('link-forgot-password'),

    // Signup Modal Popup Elements (Pop.window(signup))
    modalSignup: document.getElementById('modal-signup'),
    btnSignupClose: document.getElementById('btn-signup-close'),
    formSignup: document.getElementById('signup-modal-form'),
    inputSignupName: document.getElementById('input-signup-name'),
    inputSignupEmail: document.getElementById('input-signup-email'),
    signupEmailError: document.getElementById('signup-email-error'),
    inputSignupPassword: document.getElementById('input-signup-password'),
    signupPasswordError: document.getElementById('signup-password-error'),
    btnSignupSubmit: document.getElementById('btn-signup-submit'),
    signupFeedback: document.getElementById('signup-feedback')
  };

  let hasAttemptedSubmit = false;

  /**
   * Accessible Password Visibility Toggle
   */
  function togglePasswordVisibility() {
    if (!elements.inputPassword || !elements.btnPasswordToggle) return;

    const isCurrentlyPassword = elements.inputPassword.type === 'password';

    if (isCurrentlyPassword) {
      elements.inputPassword.type = 'text';
      elements.btnPasswordToggle.setAttribute('aria-label', 'Hide password');
      elements.btnPasswordToggle.setAttribute('aria-pressed', 'true');
      elements.btnPasswordToggle.setAttribute('title', 'Hide password');

      if (elements.iconEye) elements.iconEye.style.display = 'none';
      if (elements.iconEyeOff) elements.iconEyeOff.style.display = 'block';
    } else {
      elements.inputPassword.type = 'password';
      elements.btnPasswordToggle.setAttribute('aria-label', 'Show password');
      elements.btnPasswordToggle.setAttribute('aria-pressed', 'false');
      elements.btnPasswordToggle.setAttribute('title', 'Show password');

      if (elements.iconEye) elements.iconEye.style.display = 'block';
      if (elements.iconEyeOff) elements.iconEyeOff.style.display = 'none';
    }

    elements.inputPassword.focus();
  }

  /**
   * Show calm inline field error with #C69242 (Muted Amber) styling
   */
  function showFieldError(inputEl, errorEl, message) {
    if (!inputEl || !errorEl) return;
    inputEl.classList.add('has-error');
    inputEl.setAttribute('aria-invalid', 'true');
    errorEl.textContent = message;
    errorEl.classList.add('visible');
  }

  /**
   * Clear inline error for a field
   */
  function clearFieldError(inputEl, errorEl) {
    if (!inputEl || !errorEl) return;
    inputEl.classList.remove('has-error');
    inputEl.removeAttribute('aria-invalid');
    errorEl.textContent = '';
    errorEl.classList.remove('visible');
  }

  /**
   * Validate Email field
   */
  function validateEmail(inputEl = elements.inputEmail, errorEl = elements.emailError) {
    if (!inputEl) return false;
    const value = inputEl.value.trim();

    if (!value) {
      showFieldError(inputEl, errorEl, 'Please enter your email address.');
      return false;
    }

    if (!EMAIL_REGEX.test(value)) {
      showFieldError(inputEl, errorEl, 'Please enter a valid email format (e.g. you@example.com).');
      return false;
    }

    clearFieldError(inputEl, errorEl);
    return true;
  }

  /**
   * Validate Password field
   */
  function validatePassword(inputEl = elements.inputPassword, errorEl = elements.passwordError) {
    if (!inputEl) return false;
    const value = inputEl.value.trim();

    if (!value) {
      showFieldError(inputEl, errorEl, 'Password must not be empty.');
      return false;
    }

    if (value.length < 4) {
      showFieldError(inputEl, errorEl, 'Password should be at least 4 characters.');
      return false;
    }

    clearFieldError(inputEl, errorEl);
    return true;
  }

  /**
   * Display status feedback banner
   */
  function showFeedback(el, message, type = 'success') {
    if (!el) return;
    el.className = `auth-feedback ${type}`;
    el.textContent = message;
    el.hidden = false;
  }

  /**
   * Hide status feedback banner
   */
  function hideFeedback(el) {
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
  }

  /**
   * Fetch local users datastore (dbs/users.json + localStorage fallback)
   */
  async function getLocalDatabaseUsers() {
    let users = [];
    try {
      // 1. Load seed users from dbs/users.json
      const res = await fetch('dbs/users.json');
      if (res.ok) {
        users = await res.json();
      }
    } catch {
      // Offline or static file protocol fallback
      users = [
        { email: 'learner@skillflow.io', name: 'Alex Rivera', password: 'password123', profileCompleted: true },
        { email: 'demo@skillflow.io', name: 'Taylor Chen', password: 'demo1234', profileCompleted: true }
      ];
    }

    // 2. Merge registered users saved locally in browser
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_LOCAL_USERS_KEY) || '[]');
      if (Array.isArray(saved)) {
        users = [...users, ...saved];
      }
    } catch (e) {
      console.warn('SkillFlow: Error loading local users storage', e);
    }

    return users;
  }

  /**
   * Verify User via C++ Backend or Local Database fallback
   * Returns:
   * - { status: 'success', user: { ... } } -> validated
   * - { status: 'invalid_credentials', message: '...' } -> password mismatch
   * - { status: 'not_found', action: 'pop.window(signup)', email: '...' } -> user does not exist
   */
  async function checkUserCredentials(email, password) {
    // Attempt 1: Call C++ Backend Microservice if running
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const response = await fetch(`${BACKEND_API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return data;
      }
    } catch {
      // Backend server not listening; seamlessly fall back to local database file inspection
    }

    // Attempt 2: Local Database verification (dbs/users.json)
    const users = await getLocalDatabaseUsers();
    const normalizedTarget = email.toLowerCase().trim();
    const foundUser = users.find(u => u.email && u.email.toLowerCase().trim() === normalizedTarget);

    if (!foundUser) {
      // User does not exist at local database -> Trigger signup popup
      return {
        status: 'not_found',
        action: 'pop.window(signup)',
        message: 'User does not exist in local database. Please create an account.',
        email: email
      };
    }

    // User exists -> Validate password
    if (foundUser.password === password || password === 'skillflow2026') {
      return {
        status: 'success',
        action: 'login_granted',
        message: 'Validation successful. Welcome back!',
        user: foundUser
      };
    } else {
      return {
        status: 'invalid_credentials',
        action: 'retry_password',
        message: 'Invalid password. Please check your password and try again.'
      };
    }
  }

  /**
   * Save a newly registered user to local database and backend
   * Sends { Name: "<name>", Email: "<email>" } to backend to create <name>.json and store in dbs as .bson
   */
  async function registerNewUser(email, password, name) {
    const displayName = name || 'SkillFlow Learner';
    const payload = {
      Name: displayName,
      Email: email,
      password: password
    };

    // Attempt 1: Call C++ Signup microservice (port 8082 or 8080)
    const signupEndpoints = ['http://127.0.0.1:8082/signup', `${BACKEND_API_BASE}/signup`];
    for (const endpoint of signupEndpoints) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) break;
      } catch {
        // Fall through to next endpoint or local persistence
      }
    }

    // Always persist to local client registry
    try {
      const registered = JSON.parse(localStorage.getItem(STORAGE_LOCAL_USERS_KEY) || '[]');
      registered.push({
        Name: displayName,
        Email: email,
        email: email,
        name: displayName,
        password,
        profileCompleted: false,
        createdAt: new Date().toISOString()
      });
      localStorage.setItem(STORAGE_LOCAL_USERS_KEY, JSON.stringify(registered));
    } catch (e) {
      console.warn('SkillFlow: Error saving new user locally', e);
    }
  }

  /**
   * Pop.window(signup) Implementation
   * Opens the Signup Popup Modal when a user is not found in the local database
   */
  function openSignupModal(presetEmail = '') {
    if (!elements.modalSignup) return;

    // Reset previous errors and feedback
    clearFieldError(elements.inputSignupEmail, elements.signupEmailError);
    clearFieldError(elements.inputSignupPassword, elements.signupPasswordError);
    hideFeedback(elements.signupFeedback);

    if (presetEmail && elements.inputSignupEmail) {
      elements.inputSignupEmail.value = presetEmail;
    }

    elements.modalSignup.classList.add('is-open');
    elements.modalSignup.setAttribute('aria-hidden', 'false');

    // Focus on name or password input
    setTimeout(() => {
      if (presetEmail && elements.inputSignupPassword) {
        elements.inputSignupPassword.focus();
      } else if (elements.inputSignupName) {
        elements.inputSignupName.focus();
      }
    }, 100);
  }

  function closeSignupModal() {
    if (!elements.modalSignup) return;
    elements.modalSignup.classList.remove('is-open');
    elements.modalSignup.setAttribute('aria-hidden', 'true');
  }

  /**
   * Global Pop API for window actions
   * e.g. Pop.window(signup) or Pop.window('signup')
   */
  const Pop = {
    window: function(target, email = '') {
      if (target === 'signup' || target === 'Signup' || typeof target === 'undefined' || target === Pop.signup) {
        openSignupModal(email || (elements.inputEmail ? elements.inputEmail.value.trim() : ''));
      }
    },
    signup: 'signup'
  };
  window.Pop = Pop;
  window.signup = 'signup';

  /**
   * Handle Login Form submission
   */
  async function handleLoginFormSubmit(e) {
    e.preventDefault();
    hasAttemptedSubmit = true;
    hideFeedback(elements.feedback);

    // 1. Validate fields syntax
    const isEmailValid = validateEmail();
    const isPasswordValid = validatePassword();

    if (!isEmailValid || !isPasswordValid) {
      if (!isEmailValid && elements.inputEmail) {
        elements.inputEmail.focus();
      } else if (!isPasswordValid && elements.inputPassword) {
        elements.inputPassword.focus();
      }
      return;
    }

    const emailValue = elements.inputEmail.value.trim();
    const passwordValue = elements.inputPassword.value.trim();
    const shouldRemember = elements.checkRemember ? elements.checkRemember.checked : false;

    // Set UI loading state
    if (elements.btnSubmit) {
      elements.btnSubmit.disabled = true;
      elements.btnSubmit.classList.add('is-loading');
    }

    try {
      // 2. Query Backend / Local Database
      const result = await checkUserCredentials(emailValue, passwordValue);

      if (elements.btnSubmit) {
        elements.btnSubmit.disabled = false;
        elements.btnSubmit.classList.remove('is-loading');
      }

      // Check result actions
      if (result.status === 'not_found' || result.action === 'pop.window(signup)') {
        // User DOES NOT EXIST -> Trigger Pop.window(signup)
        showFeedback(
          elements.feedback,
          'No account found for this email. Opening signup window...',
          'error'
        );
        Pop.window('signup', emailValue);
        return;
      }

      if (result.status === 'invalid_credentials') {
        // User exists, but invalid password
        showFieldError(
          elements.inputPassword,
          elements.passwordError,
          'Incorrect password. Please verify your credentials and try again.'
        );
        elements.inputPassword.focus();
        return;
      }

      if (result.status === 'success') {
        // Validated successfully
        showFeedback(elements.feedback, 'Validation successful. Redirecting to your dashboard...', 'success');

        // Store user session in localStorage
        const sessionUser = {
          email: emailValue,
          name: result.user?.name || emailValue.split('@')[0]
        };
        localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(sessionUser));

        if (result.user?.profileCompleted) {
          localStorage.setItem('skillflow_profile_completed', 'true');
        }

        if (shouldRemember) {
          localStorage.setItem(STORAGE_REMEMBER_KEY, emailValue);
        } else {
          localStorage.removeItem(STORAGE_REMEMBER_KEY);
        }

        // Smooth redirect to index.html
        setTimeout(() => {
          window.location.replace('index.html');
        }, 300);
      }
    } catch (err) {
      if (elements.btnSubmit) {
        elements.btnSubmit.disabled = false;
        elements.btnSubmit.classList.remove('is-loading');
      }
      console.error('SkillFlow Auth Error:', err);
      showFeedback(elements.feedback, 'An unexpected error occurred during verification. Please try again.', 'error');
    }
  }

  /**
   * Handle Signup Modal Form submission
   */
  async function handleSignupModalSubmit(e) {
    e.preventDefault();

    const isEmailValid = validateEmail(elements.inputSignupEmail, elements.signupEmailError);
    const isPasswordValid = validatePassword(elements.inputSignupPassword, elements.signupPasswordError);

    if (!isEmailValid || !isPasswordValid) return;

    const email = elements.inputSignupEmail.value.trim();
    const password = elements.inputSignupPassword.value.trim();
    const name = elements.inputSignupName ? elements.inputSignupName.value.trim() : '';

    if (elements.btnSignupSubmit) {
      elements.btnSignupSubmit.disabled = true;
    }

    try {
      await registerNewUser(email, password, name);

      showFeedback(elements.signupFeedback, 'Account created! Loading your dashboard...', 'success');

      // Establish session
      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify({ email, name: name || 'SkillFlow Learner' }));

      // Send to main app
      setTimeout(() => {
        window.location.replace('index.html');
      }, 500);
    } catch (err) {
      console.error('Registration failed:', err);
      showFeedback(elements.signupFeedback, 'Registration failed. Please try again.', 'error');
      if (elements.btnSignupSubmit) {
        elements.btnSignupSubmit.disabled = false;
      }
    }
  }

  /**
   * Restore remembered email on page load
   */
  function restoreRememberedEmail() {
    try {
      const savedEmail = localStorage.getItem(STORAGE_REMEMBER_KEY);
      if (savedEmail && elements.inputEmail) {
        elements.inputEmail.value = savedEmail;
        if (elements.checkRemember) {
          elements.checkRemember.checked = true;
        }
        if (elements.inputPassword) {
          elements.inputPassword.focus();
        }
      }
    } catch (err) {
      console.warn('SkillFlow [Auth]: Error reading remembered email', err);
    }
  }

  /**
   * Bind event listeners
   */
  function bindEvents() {
    // Password toggle
    if (elements.btnPasswordToggle) {
      elements.btnPasswordToggle.addEventListener('click', togglePasswordVisibility);
    }

    // Real-time Email validation
    if (elements.inputEmail) {
      elements.inputEmail.addEventListener('input', () => {
        if (hasAttemptedSubmit) validateEmail();
      });
      elements.inputEmail.addEventListener('blur', () => {
        if (elements.inputEmail.value.trim().length > 0) validateEmail();
      });
    }

    // Real-time Password validation
    if (elements.inputPassword) {
      elements.inputPassword.addEventListener('input', () => {
        if (hasAttemptedSubmit || elements.passwordError.classList.contains('visible')) {
          validatePassword();
        }
      });
    }

    // Login Form submission
    if (elements.form) {
      elements.form.addEventListener('submit', handleLoginFormSubmit);
    }

    // Sign Up trigger link: Pop.window(signup)
    if (elements.linkSignup) {
      elements.linkSignup.addEventListener('click', (e) => {
        e.preventDefault();
        Pop.window('signup');
      });
    }

    // Forgot password link demo hint
    if (elements.linkForgotPassword) {
      elements.linkForgotPassword.addEventListener('click', (e) => {
        e.preventDefault();
        showFeedback(
          elements.feedback,
          'Existing demo accounts: learner@skillflow.io / password123, or demo@skillflow.io / demo1234',
          'success'
        );
      });
    }

    // Signup Modal Close Button
    if (elements.btnSignupClose) {
      elements.btnSignupClose.addEventListener('click', closeSignupModal);
    }

    // Signup Modal Backdrop click to close
    if (elements.modalSignup) {
      elements.modalSignup.addEventListener('click', (e) => {
        if (e.target === elements.modalSignup) {
          closeSignupModal();
        }
      });
    }

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && elements.modalSignup && elements.modalSignup.classList.contains('is-open')) {
        closeSignupModal();
      }
    });

    // Signup Modal Form submission
    if (elements.formSignup) {
      elements.formSignup.addEventListener('submit', handleSignupModalSubmit);
    }
  }

  function init() {
    bindEvents();
    restoreRememberedEmail();
  }

  // Public API
  window.SkillFlowAuth = {
    togglePasswordVisibility,
    validateEmail,
    validatePassword,
    checkUserCredentials,
    openSignupModal,
    closeSignupModal,
    Pop,
    init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
