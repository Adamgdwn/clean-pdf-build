export type AuthMode = "sign_in" | "sign_up";
export type AccountType = "individual" | "corporate";

function requireValue(value: string, label: string) {
  return value.trim() ? null : label;
}

export function validateAuthForm(input: {
  authMode: AuthMode;
  email: string;
  password: string;
  fullName: string;
  accountType: AccountType;
  workspaceName: string;
  jobTitle: string;
}) {
  const missing = [
    requireValue(input.email, "email"),
    requireValue(input.password, "password"),
    ...(input.authMode === "sign_up"
      ? [
          requireValue(input.fullName, "full name"),
          requireValue(
            input.workspaceName,
            input.accountType === "corporate" ? "organization name" : "workspace name",
          ),
          requireValue(input.jobTitle, "role or title"),
        ]
      : []),
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) {
    return `Add ${missing.join(", ")} before continuing.`;
  }

  if (!input.email.includes("@")) {
    return "Enter a valid email address before continuing.";
  }

  return null;
}
