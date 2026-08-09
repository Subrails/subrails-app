/**
 * Shared UI primitives for the Subrails reference frontend.
 *
 * Everything here is a thin wrapper over the design tokens in globals.css.
 */

"use client";

import { useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

import type { MandateStatus } from "@subrails/sdk";

// -- Button ------------------------------------------------------------------

type ButtonVariant = "primary" | "ghost" | "danger" | "teal";

export function Button(props: {
  variant?: ButtonVariant;
  loading?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>): React.ReactElement {
  const { variant = "primary", loading = false, children, disabled, className = "", ...rest } = props;
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`btn btn-${variant} ${className}`}
      data-loading={loading || undefined}
    >
      {loading ? <Spinner /> : null}
      <span>{children}</span>
    </button>
  );
}

// -- Spinner -----------------------------------------------------------------

export function Spinner(): React.ReactElement {
  return <span className="spinner" aria-hidden="true" />;
}

// -- Field -------------------------------------------------------------------

export function Field(props: {
  label: string;
  hint?: string;
  mono?: boolean;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}): React.ReactElement {
  const { label, hint, mono = false, inputProps } = props;
  const id = inputProps?.id ?? `field-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input
        {...inputProps}
        id={id}
        className={`field-input ${mono ? "mono" : ""} ${inputProps?.className ?? ""}`}
      />
      {hint !== undefined ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

// -- Status chip -------------------------------------------------------------

const STATUS_META: Readonly<Record<MandateStatus, { className: string; label: string }>> = {
  Active: { className: "chip-active", label: "Active" },
  Revoked: { className: "chip-revoked", label: "Revoked" },
  Expired: { className: "chip-expired", label: "Expired" },
};

export function StatusChip(props: { status: MandateStatus }): React.ReactElement {
  const meta = STATUS_META[props.status];
  return (
    <span className={`chip ${meta.className}`}>
      <span className="chip-dot" />
      {meta.label}
    </span>
  );
}

// -- Panel -------------------------------------------------------------------

export function Panel(props: {
  title: string;
  kicker?: string;
  accent: "violet" | "teal";
  actions?: ReactNode;
  children: ReactNode;
}): React.ReactElement {
  return (
    <section className={`panel panel-${props.accent}`}>
      <header className="panel-head">
        <div>
          {props.kicker !== undefined ? <p className="panel-kicker">{props.kicker}</p> : null}
          <h2 className="panel-title">{props.title}</h2>
        </div>
        {props.actions !== undefined ? <div className="panel-actions">{props.actions}</div> : null}
      </header>
      <div className="panel-body">{props.children}</div>
    </section>
  );
}

// -- KV row (for mandate details) --------------------------------------------

export function KvRow(props: { label: string; children: ReactNode }): React.ReactElement {
  return (
    <div className="kv-row">
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

// -- Empty state -------------------------------------------------------------

export function EmptyState(props: { title: string; body: string }): React.ReactElement {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{props.title}</p>
      <p className="empty-state-body">{props.body}</p>
    </div>
  );
}

// -- Copy button -------------------------------------------------------------

export function CopyButton(props: { text: string; label?: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={`Copy ${props.label ?? "value"}`}
      onClick={() => {
        void navigator.clipboard.writeText(props.text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
