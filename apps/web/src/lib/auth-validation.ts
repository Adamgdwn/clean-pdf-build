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
  username: string;
  accountType: AccountType;
  workspaceName: string;
  companyName: string;
  jobTitle: string;
  timezone: string;
  locale: string;
}) {
  const missing = [
    requireValue(input.email, "email"),
    requireValue(input.password, "password"),
    ...(input.authMode === "sign_up"
      ? [
          requireValue(input.fullName, "full name"),
          requireValue(input.username, "username"),
          requireValue(
            input.workspaceName,
            input.accountType === "corporate" ? "organization name" : "workspace name",
          ),
          requireValue(
            input.companyName,
            input.accountType === "corporate" ? "company legal name" : "company or account name",
          ),
          requireValue(input.jobTitle, "role or title"),
          requireValue(input.timezone, "timezone"),
          requireValue(input.locale, "locale"),
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
