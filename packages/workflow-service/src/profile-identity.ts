export type ProfileKind = "easydraft_user" | "easydraft_staff";
export type AccountType = "individual" | "corporate";

const PUBLIC_EMAIL_DOMAINS = new Set([
  "aol.com",
  "icloud.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "live.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "yahoo.ca",
  "yahoo.com",
  "ymail.com",
]);

function trimToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getEmailDomain(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return domain.replace(/\.+$/g, "") || null;
}

export function getVerifiedCorporateEmailDomain(email: string) {
  const domain = getEmailDomain(email);

  if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return null;
  }

  return domain;
}

export function deriveUsername(email: string, preferredUsername?: string | null) {
  const candidate = trimToNull(preferredUsername) ?? trimToNull(email.split("@")[0]) ?? "user";
  const normalized = candidate
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");

  return normalized || "user";
}

export function inferProfileKind(email: string, preferredProfileKind?: string | null): ProfileKind {
  if (preferredProfileKind === "easydraft_staff" || preferredProfileKind === "easydraft_user") {
    return preferredProfileKind;
  }

  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return domain === "agoperations.ca" ? "easydraft_staff" : "easydraft_user";
}

export function inferAccountType(
  preferredAccountType?: string | null,
  existingAccountType?: AccountType | null,
): AccountType {
  if (preferredAccountType === "corporate" || preferredAccountType === "individual") {
    return preferredAccountType;
  }

  return existingAccountType ?? "individual";
}

export function inferCompanyName(input: {
  email: string;
  preferredCompanyName?: string | null;
  workspaceName?: string | null;
  accountType?: AccountType | null;
  profileKind?: ProfileKind | null;
  existingCompanyName?: string | null;
}) {
  const preferredCompanyName = trimToNull(input.preferredCompanyName);
  if (preferredCompanyName) {
    return preferredCompanyName;
  }

  const existingCompanyName = trimToNull(input.existingCompanyName);
  if (existingCompanyName) {
    return existingCompanyName;
  }

  const workspaceName = trimToNull(input.workspaceName);
  if ((input.accountType ?? "individual") === "corporate" && workspaceName) {
    return workspaceName;
  }

  const domain = input.email.trim().toLowerCase().split("@")[1] ?? "";
  if ((input.profileKind ?? inferProfileKind(input.email)) === "easydraft_staff" || domain === "agoperations.ca") {
    return "AG Operations";
  }

  return null;
}

export function planDefaultAccountWorkspace(input: {
  email: string;
  name?: string | null;
  accountType?: AccountType | null;
  workspaceName?: string | null;
}) {
  const wantsCorporateAccount = input.accountType === "corporate";
  const requestedWorkspaceName = trimToNull(input.workspaceName);
  const displayName = trimToNull(input.name);
  const emailLocalPart = trimToNull(input.email.split("@")[0]);

  const organizationName = wantsCorporateAccount
    ? requestedWorkspaceName || (displayName ? `${displayName}'s organization` : "My organization")
    : requestedWorkspaceName || (displayName ? `${displayName}'s account` : "My account");
  const workspaceName = wantsCorporateAccount
    ? organizationName
    : requestedWorkspaceName || (displayName ? `${displayName}'s workspace` : "My workspace");

  return {
    accountType: wantsCorporateAccount ? ("corporate" as const) : ("individual" as const),
    workspaceType: wantsCorporateAccount ? ("team" as const) : ("personal" as const),
    organizationName,
    workspaceName,
    slugBase: wantsCorporateAccount ? organizationName : workspaceName || emailLocalPart || "workspace",
  };
}
