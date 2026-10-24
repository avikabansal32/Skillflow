/**
 * SkillFlow — Authentication Controller
 * Real-time / on-submit validation with calm inline errors (#C69242 Muted Amber),
 * accessible password visibility toggle, session persistence, and redirection.
 */

(() => {
  'use strict';

  // If already authenticated, redirect straight to main app to prevent infinite loops
  if (localStorage.getItem('skillflow_user')) {
    window.location.replace('index.html');
    return;
  }

  const STORAGE_USER_KEY = 'skillflow_user';
  const STORAGE_REMEMBER_KEY = 'skillflow_remembered_email';

  // Standard email validation pattern (RFC 5322 compliant subset)
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
    linkForgotPassword: document.getElementById('link-forgot-password')
  };

  // State to track if user has submitted at least once (for real-time feedback calibration)
  let hasAttemptedSubmit = false;

  /**
   * Toggle password input visibility between 'password' and 'text'
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
   * @param {HTMLInputElement} inputEl
   * @param {HTMLElement} errorEl
   * @param {string} message
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
   * @param {HTMLInputElement} inputEl
   * @param {HTMLElement} errorEl
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
   * @returns {boolean}
   */
  function validateEmail() {
    if (!elements.inputEmail) return false;
    const value = elements.inputEmail.value.trim();

    if (!value) {
      showFieldError(elements.inputEmail, elements.emailError, 'Please enter your email address.');
      return false;
    }

    if (!EMAIL_REGEX.test(value)) {
      showFieldError(
        elements.inputEmail,
        elements.emailError,
        'Please enter a valid email format (e.g. you@example.com).'
      );
      return false;
    }

    clearFieldError(elements.inputEmail, elements.emailError);
    return true;
  }

  /**
   * Validate Password field
   * @returns {boolean}
   */
  function validatePassword() {
    if (!elements.inputPassword) return false;
    const value = elements.inputPassword.value.trim();

    if (!value) {
      showFieldError(elements.inputPassword, elements.passwordError, 'Password must not be empty.');
      return false;
    }

    clearFieldError(elements.inputPassword, elements.passwordError);
    return true;
  }

  /**
   * Display global status feedback banner
   * @param {string} message
   * @param {'success'|'error'} type
   */
  function showFeedback(message, type = 'success') {
    if (!elements.feedback) return;
    elements.feedback.className = `auth-feedback ${type}`;
    elements.feedback.textContent = message;
    elements.feedback.hidden = false;
  }

  /**
   * Handle Login Form submission
   * @param {Event} e
   */
  function handleFormSubmit(e) {
    e.preventDefault();
    hasAttemptedSubmit = true;

    // Validate fields
    const isEmailValid = validateEmail();
    const isPasswordValid = validatePassword();

    // Stop on any validation failure
    if (!isEmailValid || !isPasswordValid) {
      if (!isEmailValid && elements.inputEmail) {
        elements.inputEmail.focus();
      } else if (!isPasswordValid && elements.inputPassword) {
        elements.inputPassword.focus();
      }
      return;
    }

    const emailValue = elements.inputEmail.value.trim();
    const shouldRemember = elements.checkRemember ? elements.checkRemember.checked : false;

    try {
      // Store session in localStorage as requested:
      // localStorage.setItem('skillflow_user', JSON.stringify({ email: emailInput.value }));
      localStorage.setItem('skillflow_user', JSON.stringify({ email: emailValue }));

      if (shouldRemember) {
        localStorage.setItem(STORAGE_REMEMBER_KEY, emailValue);
      } else {
        localStorage.removeItem(STORAGE_REMEMBER_KEY);
      }
    } catch (err) {
      console.warn('SkillFlow [Auth]: Could not persist user session to localStorage', err);
    }

    // Immediately redirect to main app using window.location.replace
    window.location.replace('index.html');
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
   * Bind DOM event listeners for real-time validation and actions
   */
  function bindEvents() {
    // Password toggle
    if (elements.btnPasswordToggle) {
      elements.btnPasswordToggle.addEventListener('click', togglePasswordVisibility);
    }

    // Real-time Email validation
    if (elements.inputEmail) {
      elements.inputEmail.addEventListener('input', () => {
        if (hasAttemptedSubmit) {
          validateEmail();
        }
      });

      elements.inputEmail.addEventListener('blur', () => {
        // If user entered something, validate format on blur
        if (elements.inputEmail.value.trim().length > 0) {
          validateEmail();
        }
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

    // Form submission
    if (elements.form) {
      elements.form.addEventListener('submit', handleFormSubmit);
    }

    // Footer link for future Sign Up toggle
    if (elements.linkSignup) {
      elements.linkSignup.addEventListener('click', (e) => {
        e.preventDefault();
        showFeedback('Ready to explore! Sign up is open — enter your email and password above to begin your roadmap.', 'success');
        if (elements.inputEmail) elements.inputEmail.focus();
      });
    }

    // Forgot password hint
    if (elements.linkForgotPassword) {
      elements.linkForgotPassword.addEventListener('click', (e) => {
        e.preventDefault();
        showFeedback('Demo mode active: Simply enter any email and password to access the app.', 'success');
      });
    }
  }

  /**
   * Initialize Auth Module
   */
  function init() {
    bindEvents();
    restoreRememberedEmail();
  }

  // Public API
  window.SkillFlowAuth = {
    togglePasswordVisibility,
    validateEmail,
    validatePassword,
    init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
