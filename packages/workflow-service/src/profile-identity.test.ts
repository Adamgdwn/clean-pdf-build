import { describe, expect, it } from "vitest";

import {
  deriveUsername,
  inferAccountType,
  inferCompanyName,
  inferProfileKind,
  planDefaultAccountWorkspace,
} from "./profile-identity.js";

describe("profile identity helpers", () => {
  it("derives a stable username from email when none is provided", () => {
    expect(deriveUsername("Adam.Goodwin+pilot@gmail.com")).toBe("adam.goodwin-pilot");
  });

  it("prefers an explicit profile kind before falling back to the email domain", () => {
    expect(inferProfileKind("user@example.com", "easydraft_staff")).toBe("easydraft_staff");
    expect(inferProfileKind("staff@agoperations.ca")).toBe("easydraft_staff");
  });

  it("keeps corporate account type and workspace name aligned for company inference", () => {
    expect(
      inferCompanyName({
        email: "owner@example.com",
        accountType: inferAccountType("corporate"),
        workspaceName: "Acme Corp",
      }),
    ).toBe("Acme Corp");
  });

  it("falls back to AG Operations for staff accounts without explicit company data", () => {
    expect(
      inferCompanyName({
        email: "ops@agoperations.ca",
      }),
    ).toBe("AG Operations");
  });

  it("keeps an individual signup personal even when the required workspace name is present", () => {
    expect(
      planDefaultAccountWorkspace({
        email: "solo@example.com",
        name: "Solo User",
        accountType: "individual",
        workspaceName: "Solo Desk",
      }),
    ).toMatchObject({
      accountType: "individual",
      workspaceType: "personal",
      organizationName: "Solo Desk",
      workspaceName: "Solo Desk",
    });
  });

  it("creates a corporate team workspace only for explicit corporate account signups", () => {
    expect(
      planDefaultAccountWorkspace({
        email: "owner@example.com",
        name: "Org Owner",
        accountType: "corporate",
        workspaceName: "Acme Operations",
      }),
    ).toMatchObject({
      accountType: "corporate",
      workspaceType: "team",
      organizationName: "Acme Operations",
      workspaceName: "Acme Operations",
    });
  });
});
