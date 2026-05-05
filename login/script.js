/* Kenji's Register and Login Page JS */

/* --- Shared validation rules (single source of truth for password length) --- */

/** Passwords must be at least this many characters on Sign In and Create Account */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Passwords must not exceed this many characters (consistent UX, request size,
 * and typical limits for hashing / storage on the server—re-validate server-side).
 */
const MAX_PASSWORD_LENGTH = 50;

/** Max length for name fields to avoid accidental paste abuse */
const MAX_NAME_LENGTH = 50;

/**
 * Returns true if the string looks like a valid email (practical check, not RFC-complete).
 * Trimming should be done by the caller before passing the value.
 */
function isValidEmail(email) {
    if (!email) return false;
    // One @, local and domain parts with a dot in the domain
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(email);
}

/**
 * Checks password length is within [MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH].
 * Does not trim: leading/trailing spaces count as characters if the user typed them.
 *
 * @param {string} password - raw value from the password field
 * @param {string} whenEmptyMessage - e.g. Sign In vs Create Account wording
 * @returns {string} Error message, or "" if length is acceptable
 */
function getPasswordLengthError(password, whenEmptyMessage) {
    if (typeof password !== 'string' || password.length === 0) {
        return whenEmptyMessage;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
    }
    return '';
}

/**
 * First / last names may use only:
 * - Letters (any language via Unicode `\p{L}` so names like "José" or "Müller" work)
 * - ASCII hyphen `-` between letter groups (e.g. "Anne-Marie", "Smith-Jones")
 * - Apostrophes `'` or the common typographic apostrophe U+2019 between letter groups (e.g. "O'Brien", "D'Angelo")
 *
 * The pattern requires the string to start and end with letters; hyphens and apostrophes
 * cannot lead, trail, or sit next to each other without letters in between.
 */
function nameContainsOnlyLettersHyphensApostrophes(trimmed) {
    /* Hyphen is first in the class so it is literal, not a range operator */
    const namePattern = /^[\p{L}]+(?:[-'\u2019][\p{L}]+)*$/u;
    return namePattern.test(trimmed);
}

/**
 * Returns an error message for a single person-name field, or "" if valid.
 * @param {string} rawValue - value straight from the input
 * @param {string} fieldLabel - lowercase label for messages, e.g. "first name", "last name"
 */
function getPersonNameFieldError(rawValue, fieldLabel) {
    const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';

    /* Require something after trimming spaces */
    if (!trimmed) {
        return `Please enter your ${fieldLabel}.`;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
        return `${fieldLabel.charAt(0).toUpperCase()}${fieldLabel.slice(1)} is too long.`;
    }
    if (!nameContainsOnlyLettersHyphensApostrophes(trimmed)) {
        return `${fieldLabel.charAt(0).toUpperCase()}${fieldLabel.slice(1)} may only contain letters, hyphens, and apostrophes.`;
    }
    return '';
}

/** Writes a validation message to the form error region (empty string clears it). */
function setFormError(errorEl, message) {
    if (!errorEl) return;
    errorEl.textContent = message || '';
}

/* --- Toggle between Sign In and Create Account views --- */

const wrapper = document.querySelector('.wrapper');
const loginLink = document.querySelector('.login-link');
const registerLink = document.querySelector('.register-link');

registerLink.addEventListener('click', () => {
    wrapper.classList.add('active');
});

/* When the login link is clicked, remove the 'active' class from the wrapper to show the login form */
loginLink.addEventListener('click', () => {
    wrapper.classList.remove('active');
});

/* --- Sign In: logic checks before submit --- */

const loginForm = document.querySelector('#loginForm');
const loginFormError = document.querySelector('#loginFormError');
const loginEmailInput = document.querySelector('#loginEmail');
const loginPasswordInput = document.querySelector('#loginPassword');

/**
 * Validates Sign In fields: non-empty trimmed email, email shape, password length (8–64).
 * Returns an error message string, or empty string if valid.
 */
function validateLoginFields() {
    const email = (loginEmailInput?.value ?? '').trim();
    const password = loginPasswordInput?.value ?? '';

    if (!email) {
        return 'Please enter your email.';
    }
    if (!isValidEmail(email)) {
        return 'Please enter a valid email address.';
    }
    const passwordLengthError = getPasswordLengthError(password, 'Please enter your password.');
    if (passwordLengthError) {
        return passwordLengthError;
    }
    return '';
}

if (loginForm) {
    loginForm.addEventListener('submit', (event) => {
        const message = validateLoginFields();
        if (message) {
            event.preventDefault();
            setFormError(loginFormError, message);
            return;
        }
        setFormError(loginFormError, '');
        /* Form passes checks; keep on page until `action` targets a real sign-in endpoint */
        event.preventDefault();
    });

    /* Clear stale error when the user edits either field */
    [loginEmailInput, loginPasswordInput].forEach((input) => {
        input?.addEventListener('input', () => setFormError(loginFormError, ''));
    });
}

/* --- Create Account: logic checks before submit --- */

const registerForm = document.querySelector('#registerForm');
const registerFormError = document.querySelector('#registerFormError');
const fNameInput = document.querySelector('#fName');
const lNameInput = document.querySelector('#lName');
const registerEmailInput = document.querySelector('#registerEmail');
const registerPasswordInput = document.querySelector('#registerPassword');

/**
 * Validates Create Account fields: names, email shape, password length (8–64).
 * Returns an error message string, or empty string if valid.
 */
function validateRegisterFields() {
    const fName = fNameInput?.value ?? '';
    const lName = lNameInput?.value ?? '';
    const email = (registerEmailInput?.value ?? '').trim();
    const password = registerPasswordInput?.value ?? '';

    /* First / last name: non-empty, max length, letters / hyphens / apostrophes only */
    const firstNameError = getPersonNameFieldError(fName, 'first name');
    if (firstNameError) return firstNameError;
    const lastNameError = getPersonNameFieldError(lName, 'last name');
    if (lastNameError) return lastNameError;
    if (!email) {
        return 'Please enter your email.';
    }
    if (!isValidEmail(email)) {
        return 'Please enter a valid email address.';
    }
    const registerPasswordError = getPasswordLengthError(password, 'Please choose a password.');
    if (registerPasswordError) {
        return registerPasswordError;
    }
    return '';
}

if (registerForm) {
    registerForm.addEventListener('submit', (event) => {
        const message = validateRegisterFields();
        if (message) {
            event.preventDefault();
            setFormError(registerFormError, message);
            return;
        }
        setFormError(registerFormError, '');
        /* Form passes checks; keep on page until `action` targets a real registration endpoint */
        event.preventDefault();
    });

    [fNameInput, lNameInput, registerEmailInput, registerPasswordInput].forEach((input) => {
        input?.addEventListener('input', () => setFormError(registerFormError, ''));
    });
}

/* End of Kenji's Register and Login Page JS */