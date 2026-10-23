// SPDX-License-Identifier: AGPL-3.0-or-later
// The user and day filters that the Jobs and runs and the Events tabs share (ADR-113: every table
// filters by date, user and status). Days are UTC, as every time on the dashboard.

import type { AdminUser } from "@clearfea/spec";
import { useEffect, useRef, useState } from "react";
import { fetchAdmin } from "../api/admin";

export interface UserAndDays {
  user: string;
  /** First day shown, `YYYY-MM-DD`, or "" for no bound. */
  from: string;
  /** Last day shown, `YYYY-MM-DD`, or "" for no bound. */
  to: string;
}

export const ANY_USER_OR_DAY: UserAndDays = { user: "", from: "", to: "" };

/** The days as the API's ?since= and ?before= times: from the start of `from` to the end of `to`. */
export function dayBounds({ from, to }: UserAndDays): { since?: string; before?: string } {
  const bounds: { since?: string; before?: string } = {};
  if (from !== "") bounds.since = `${from}T00:00:00.000Z`;
  if (to !== "") {
    const next = new Date(`${to}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    if (!Number.isNaN(next.getTime())) bounds.before = next.toISOString();
  }
  return bounds;
}

/** Every user, to pick from: read once, empty until then, and left empty if the read fails. */
function useUsers(onSignedOut: (notice?: string) => void): AdminUser[] {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;
  useEffect(() => {
    let current = true;
    void fetchAdmin().then((result) => {
      if (!current) return;
      if (result.kind === "signedOut") signedOut.current(result.problem);
      else if (result.kind === "ok") setUsers(result.value.users);
    });
    return () => {
      current = false;
    };
  }, []);
  return users;
}

export function UserAndDayFilters({
  value,
  onChange,
  onSignedOut,
}: {
  value: UserAndDays;
  onChange: (value: UserAndDays) => void;
  onSignedOut: (notice?: string) => void;
}) {
  const users = useUsers(onSignedOut);
  return (
    <>
      <label className="field">
        <span>User</span>
        <select value={value.user} onChange={(event) => onChange({ ...value, user: event.target.value })}>
          <option value="">Any user</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.email ?? user.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>From (UTC)</span>
        <input type="date" value={value.from} onChange={(event) => onChange({ ...value, from: event.target.value })} />
      </label>
      <label className="field">
        <span>To (UTC)</span>
        <input type="date" value={value.to} onChange={(event) => onChange({ ...value, to: event.target.value })} />
      </label>
    </>
  );
}
