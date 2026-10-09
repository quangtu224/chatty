import { useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Brand, Avatar } from "./UI.jsx";
import { validateAuth } from "../model.js";
import { login, register } from "../services/api.js";
export default function Auth({ onLive, onDemo }) {
  const [signup, setSignup] = useState(false),
    [fields, setFields] = useState({ name: "", handle: "", email: "", password: "" }),
    [errors, setErrors] = useState({}),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const next = validateAuth(fields, signup);
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const { email, password, name, handle } = fields;
      const { user } = signup
        ? await register({ email, password, displayName: name, handle })
        : await login({ email, password });
      onLive(user);
    } catch (err) {
      setBusy(false);
      const { displayName, ...rest } = err.fieldErrors ?? {};
      setErrors(
        err.code === "validation_failed" || err.code === "already_exists"
          ? { ...rest, ...(displayName && { name: displayName }) }
          : {
              form: err.status < 500
                ? err.message
                : "We couldn’t reach the server. Try again, or enter the demo.",
            },
      );
    }
  }
  return (
    <main className="auth-screen">
      <section className="auth-story">
        <Brand />
        <div className="auth-illustration">
          <Avatar name="forest" size={230} />
          <div className="little-friends">
            <Avatar name="fox" size={65} />
            <Avatar name="raccoon" size={65} />
            <Avatar name="owl" size={65} />
          </div>
        </div>
        <h1>
          Small team.
          <br />
          Good conversations.
        </h1>
        <p>
          A calm corner to share ideas, untangle bugs,
          <br />
          and build something together.
        </p>
        <span className="auth-note">Made for humans who make things.</span>
      </section>
      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit} noValidate>
          <Brand />
          <h2>{signup ? "Find your people." : "Good to see you again."}</h2>
          <p>
            {signup
              ? "Make yourself at home. Your team is waiting."
              : "Pull up a chair. Let’s pick up where we left off."}
          </p>
          {signup && (
            <label className="field">
              Display name
              <input
                className={`form-control ${errors.name ? "is-invalid" : ""}`}
                autoComplete="nickname"
                maxLength={40}
                value={fields.name}
                onChange={(e) => setFields({ ...fields, name: e.target.value })}
                aria-invalid={!!errors.name}
              />
              {errors.name && (
                <small className="field-error">{errors.name}</small>
              )}
            </label>
          )}
          {signup && (
            <label className="field">
              Handle
              <input
                className={`form-control ${errors.handle ? "is-invalid" : ""}`}
                autoComplete="username"
                placeholder="e.g. alex_m"
                maxLength={24}
                value={fields.handle}
                onChange={(e) => setFields({ ...fields, handle: e.target.value })}
                aria-invalid={!!errors.handle}
              />
              {errors.handle && <small className="field-error">{errors.handle}</small>}
            </label>
          )}
          <label className="field">
            Email address
            <input
              className={`form-control ${errors.email ? "is-invalid" : ""}`}
              type="email"
              placeholder="you@yourteam.com"
              autoComplete="email"
              value={fields.email}
              onChange={(e) => setFields({ ...fields, email: e.target.value })}
              aria-invalid={!!errors.email}
            />
            {errors.email && (
              <small className="field-error">{errors.email}</small>
            )}
          </label>
          <label className="field">
            Password
            <input
              className={`form-control ${errors.password ? "is-invalid" : ""}`}
              type="password"
              placeholder={signup ? "10–128 characters" : "Your password"}
              autoComplete={signup ? "new-password" : "current-password"}
              value={fields.password}
              onChange={(e) =>
                setFields({ ...fields, password: e.target.value })
              }
              aria-invalid={!!errors.password}
            />
            {errors.password && (
              <small className="field-error">{errors.password}</small>
            )}
          </label>
          {errors.form && (
            <p className="field-error" role="alert">
              {errors.form}
            </p>
          )}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="spin" size={17} />{" "}
                {signup ? "Creating your account…" : "Signing in…"}
              </>
            ) : (
              <>
                {signup ? "Create account" : "Sign in"}
                <ArrowRight size={17} />
              </>
            )}
          </button>
          <div className="auth-or">
            <span>or take a look around</span>
          </div>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onDemo}
          >
            Try demo <ArrowRight size={16} />
          </button>
          <p className="auth-switch">
            {signup ? "Already have an account?" : "New around here?"}{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSignup(!signup);
                setErrors({});
              }}
            >
              {signup ? "Sign in" : "Sign up"}
            </button>
          </p>
          <div className="auth-disclosure">
            Accounts are stored on the Chatty server. Sign up with a 3–24
            character lowercase handle and a 10–128 character password. Try
            demo uses sample data in this browser and sends nothing.
          </div>
        </form>
      </section>
    </main>
  );
}
