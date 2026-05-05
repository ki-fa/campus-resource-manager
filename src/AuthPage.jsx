import { useId, useState } from "react";
import { postJson } from "./lib/api";

const minPasswordLength = 8;
const maxPasswordLength = 64;
const maxNameLength = 50;

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateName(value, fieldLabel) {
  const trimmed = value.trim();

  if (!trimmed) {
    return `Please enter your ${fieldLabel}.`;
  }

  if (trimmed.length > maxNameLength) {
    return `${fieldLabel.charAt(0).toUpperCase()}${fieldLabel.slice(1)} is too long.`;
  }

  if (!/^[\p{L}]+(?:[-'\u2019][\p{L}]+)*$/u.test(trimmed)) {
    return `${fieldLabel.charAt(0).toUpperCase()}${fieldLabel.slice(1)} may only contain letters, hyphens, and apostrophes.`;
  }

  return "";
}

function validatePassword(password, emptyMessage) {
  if (!password) {
    return emptyMessage;
  }

  if (password.length < minPasswordLength) {
    return `Password must be at least ${minPasswordLength} characters.`;
  }

  if (password.length > maxPasswordLength) {
    return `Password must be at most ${maxPasswordLength} characters.`;
  }

  return "";
}

function AuthField({ label, type = "text", value, onChange, autoComplete }) {
  const generatedId = useId();
  const id = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${generatedId}`;

  return (
    <label className="auth-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
      />
    </label>
  );
}

function AuthPage({ mode, onModeChange, onAuthenticated }) {
  const isRegistering = mode === "register";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetMessage() {
    if (message) {
      setMessage("");
    }
  }

  function validateForm() {
    const trimmedEmail = email.trim();

    if (isRegistering) {
      const firstNameError = validateName(firstName, "first name");
      if (firstNameError) return firstNameError;

      const lastNameError = validateName(lastName, "last name");
      if (lastNameError) return lastNameError;
    }

    if (!trimmedEmail) {
      return "Please enter your email.";
    }

    if (!isValidEmail(trimmedEmail)) {
      return "Please enter a valid email address.";
    }

    return validatePassword(
      password,
      isRegistering ? "Please choose a password." : "Please enter your password."
    );
  }

  async function submitForm(event) {
    event.preventDefault();
    const validationMessage = validateForm();

    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      const payload = isRegistering
        ? await postJson("/api/auth/register", {
            firstName,
            lastName,
            email,
            password
          })
        : await postJson("/api/auth/login", {
            email,
            password
          });

      onAuthenticated(payload);
    } catch (error) {
      setMessage(error.message || "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(nextMode) {
    setMessage("");
    onModeChange(nextMode);
  }

  return (
    <section className="auth-layout">
      <div className="auth-copy" aria-hidden="true">
        <img src="/squirrel-favicon.svg?v=2" alt="" />
        <h2>Campus Resource Wiki</h2>
      </div>

      <form className="auth-panel" onSubmit={submitForm} noValidate>
        <div className="auth-panel__heading">
          <h2>{isRegistering ? "Create Account" : "Sign In"}</h2>
        </div>

        {isRegistering && (
          <div className="auth-name-grid">
            <AuthField
              label="First Name"
              value={firstName}
              onChange={(value) => {
                setFirstName(value);
                resetMessage();
              }}
              autoComplete="given-name"
            />
            <AuthField
              label="Last Name"
              value={lastName}
              onChange={(value) => {
                setLastName(value);
                resetMessage();
              }}
              autoComplete="family-name"
            />
          </div>
        )}

        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            resetMessage();
          }}
          autoComplete="email"
        />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={(value) => {
            setPassword(value);
            resetMessage();
          }}
          autoComplete={isRegistering ? "new-password" : "current-password"}
        />

        <p className="auth-error" role="alert" aria-live="polite">
          {message}
        </p>

        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "Please wait..." : isRegistering ? "Create Account" : "Sign In"}
        </button>

        <p className="auth-switch">
          {isRegistering ? "Already have an account?" : "Don't have an account?"}
          <button
            type="button"
            className="text-button"
            onClick={() => switchMode(isRegistering ? "login" : "register")}
          >
            {isRegistering ? "Sign In" : "Sign Up"}
          </button>
        </p>
      </form>
    </section>
  );
}

export default AuthPage;
