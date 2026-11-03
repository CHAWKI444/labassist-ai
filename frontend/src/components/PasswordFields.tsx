import { useState } from "react";
import { Icon } from "./icons";
import { IconInput } from "./ui";

/** Heuristic strength estimate for user guidance only; the backend enforces the minimum length. */
export function passwordStrength(password: string): { score: number; label: string; color: string } {
  if (!password) return { score: 0, label: "", color: "bg-slate-200" };
  let score = Math.min(40, password.length * 3);
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 15;
  if (/\d/.test(password)) score += 15;
  if (/[^A-Za-z0-9]/.test(password)) score += 20;
  if (password.length >= 14) score += 10;
  score = Math.min(100, score);
  if (password.length < 8) return { score: Math.min(score, 25), label: "Too short", color: "bg-red-500" };
  if (score < 50) return { score, label: "Weak", color: "bg-amber-500" };
  if (score < 75) return { score, label: "Good", color: "bg-brand-500" };
  return { score, label: "Strong", color: "bg-mint-800" };
}

export function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const strength = passwordStrength(password);
  const matches = confirm.length > 0 && confirm === password;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Create password</span>
        <IconInput
          icon="key"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          trailing={
            <button type="button" onClick={() => setShow((v) => !v)} className="rounded p-1 text-slate-400 hover:text-slate-600" aria-label={show ? "Hide password" : "Show password"}>
              <Icon name={show ? "eyeOff" : "eye"} />
            </button>
          }
        />
        <span className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>Strength</span>
          <span className="font-semibold text-slate-700">{strength.label || "At least 8 characters"}</span>
        </span>
        <span className="mt-1 block h-1.5 rounded-full bg-slate-100">
          <span className={`block h-1.5 rounded-full transition-all ${strength.color}`} style={{ width: `${strength.score}%` }} />
        </span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Confirm password</span>
        <IconInput icon="lock" type={show ? "text" : "password"} autoComplete="new-password" required value={confirm} onChange={(e) => onConfirm(e.target.value)} />
        {confirm.length > 0 && (
          <span className={`mt-2 flex items-center gap-1 text-[11px] font-medium ${matches ? "text-mint-800" : "text-red-600"}`}>
            <Icon name={matches ? "check" : "x"} className="h-3.5 w-3.5" />
            {matches ? "Passwords match" : "Passwords do not match"}
          </span>
        )}
      </label>
    </div>
  );
}
