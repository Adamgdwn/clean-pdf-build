import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { Session } from "@supabase/supabase-js";
import { getDocumentSendReadiness } from "@clean-pdf/domain";

import { apiFetch } from "./lib/api";
import {
  clearStoredSession,
  clearStoredWorkspaceId,
  loadStoredSession,
  loadStoredWorkspaceId,
  persistSession,
  persistWorkspaceId,
} from "./lib/session-storage";
import { AuthPanel } from "./components/AuthPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FeedbackPanel } from "./components/FeedbackPanel";
import { OwnerPortal } from "./components/OwnerPortal";
import { PublicSite, type PublicPage } from "./components/public/PublicSite";
import type {
  AccountProfile,
  AdminFeedbackRequest,
  AdminManagedUser,
  AdminOverview,
  BillingOverview,
  DigitalSignatureProfile,
  GuestSigningSession,
  SavedSignature,
  SessionUser,
  WorkflowDocument,
  WorkspaceDirectory,
  WorkspaceOption,
  WorkspaceTeam,
} from "./types";

type PortalView = "workspace" | "org_admin";

const shouldRestoreSessionFromRedirect =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("signedIn") === "1";

const documentBucket = import.meta.env.VITE_SUPABASE_DOCUMENT_BUCKET ?? "documents";
const signatureBucket = import.meta.env.VITE_SUPABASE_SIGNATURE_BUCKET ?? "signatures";
const isCertificateSigningEnabled = import.meta.env.VITE_EASYDRAFT_ENABLE_CERTIFICATE_SIGNING === "true";

function formatState(state: string) {
  return state.replaceAll("_", " ");
}

function formatWorkspaceRoleLabel(role: string | null) {
  if (!role) {
    return null;
  }

  if (role === "owner") return "Owner";
  if (role === "billing_admin") return "Billing admin";
  return formatState(role);
}

const AUDIT_EVENT_LABELS: Record<string, string> = {
  "document.uploaded": "Uploaded",
  "document.prepared": "Prepared",
  "document.sent": "Sent for signatures",
  "document.completed": "Completed",
  "document.locked": "Locked",
  "document.reopened": "Reopened",
  "document.changes_requested": "Changes requested",
  "document.rejected": "Rejected",
  "document.canceled": "Canceled",
  "document.signer_reassigned": "Participant reassigned",
  "document.due_date.updated": "Due date updated",
  "document.exported": "Exported",
  "document.retention.updated": "Retention updated",
  "document.purged": "Stored files purged",
  "document.delivery_mode.updated": "Delivery mode updated",
  "field.created": "Field added",
  "field.assigned": "Field assigned",
  "field.completed": "Field completed",
  "processing.ocr.requested": "OCR requested",
  "processing.ocr.completed": "OCR completed",
  "processing.field_detection.requested": "Field detection requested",
  "processing.field_detection.completed": "Field detection completed",
  "notification.queued": "Notification queued",
  "notification.sent": "Notification sent",
};

function formatAuditEventType(type: string) {
  return AUDIT_EVENT_LABELS[type] ?? formatState(type);
}

function getSignerFieldStatus(
  signer: { id: string },
  fields: Array<{ assigneeSignerId: string | null; required: boolean; kind: string; completedAt: string | null }>,
  sentAt: string | null,
  eligibleSignerIds: string[],
): { label: string; completedAt: string | null; active: boolean } {
  const actionKinds = new Set(["signature", "initial", "approval"]);
  const assigned = fields.filter(
    (f) => f.assigneeSignerId === signer.id && f.required && actionKinds.has(f.kind),
  );
  if (assigned.length === 0) return { label: "No required fields", completedAt: null, active: false };
  const completed = assigned.filter((f) => f.completedAt);
  if (completed.length === assigned.length) {
    const latest = completed.reduce((a, b) =>
      (a.completedAt ?? "") > (b.completedAt ?? "") ? a : b,
    );
    return { label: "Signed", completedAt: latest.completedAt, active: false };
  }
  if (!sentAt) return { label: "Not sent", completedAt: null, active: false };
  if (completed.length > 0) return { label: "In progress", completedAt: null, active: eligibleSignerIds.includes(signer.id) };
  if (eligibleSignerIds.includes(signer.id)) return { label: "Awaiting action", completedAt: null, active: true };
  return { label: "Waiting", completedAt: null, active: false };
}

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return "Not set";
  }

  return new Date(timestamp).toLocaleString();
}

function toDateTimeLocalValue(timestamp: string | null) {
  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string) {
  if (!value.trim()) {
    return null;
  }

  return new Date(value).toISOString();
}

function filenameToTitle(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
}

function formatRoleLabel(document: Pick<WorkflowDocument, "currentUserRole" | "currentUserIsSigner">) {
  if (!document.currentUserRole) {
    return document.currentUserIsSigner ? "signer" : "none";
  }

  if (document.currentUserIsSigner && document.currentUserRole !== "signer") {
    return `${document.currentUserRole} + signer`;
  }

  return document.currentUserRole;
}

function isActionFieldKind(kind: WorkflowDocument["fields"][number]["kind"]) {
  return kind === "signature" || kind === "initial" || kind === "approval";
}

function getDeliveryModeLabel(deliveryMode: WorkflowDocument["deliveryMode"]) {
  if (deliveryMode === "platform_managed") {
    return "Managed routing + notifications";
  }

  if (deliveryMode === "internal_use_only") {
    return "Internal EasyDraft actions";
  }

  return "Self-managed distribution";
}

function getLockPolicyLabel(lockPolicy: WorkflowDocument["lockPolicy"]) {
  if (lockPolicy === "owner_and_editors") {
    return "Owner and editors can lock";
  }

  if (lockPolicy === "owner_editors_and_active_signer") {
    return "Owner, editors, and the active signer can lock";
  }

  return "Only the owner can lock";
}

function getParticipantTypeLabel(participantType: WorkflowDocument["signers"][number]["participantType"]) {
  return participantType === "internal" ? "Internal" : "External";
}

function getOperationalStatusLabel(status: WorkflowDocument["operationalStatus"]) {
  if (status === "changes_requested") {
    return "Changes requested";
  }

  if (status === "canceled") {
    return "Canceled";
  }

  return formatState(status);
}

function canCurrentUserLockDocument(document: WorkflowDocument | null) {
  if (!document || !document.signable || document.workflowState === "draft" || document.operationalStatus !== "active") {
    return false;
  }

  if (document.currentUserRole === "owner") {
    return true;
  }

  if (
    document.currentUserRole === "editor" &&
    (document.lockPolicy === "owner_and_editors" ||
      document.lockPolicy === "owner_editors_and_active_signer")
  ) {
    return true;
  }

  if (
    document.lockPolicy === "owner_editors_and_active_signer" &&
    document.currentUserSignerId &&
    document.fields.some(
      (field) =>
        field.assigneeSignerId === document.currentUserSignerId &&
        field.required &&
        isActionFieldKind(field.kind) &&
        !field.completedAt,
    )
  ) {
    return true;
  }

  return false;
}

function getDeliveryModeActionLabel(
  deliveryMode: WorkflowDocument["deliveryMode"],
  hasBeenSent: boolean,
) {
  if (deliveryMode === "platform_managed") {
    return hasBeenSent ? "Send current routing again" : "Send for actions";
  }

  if (deliveryMode === "internal_use_only") {
    return hasBeenSent ? "Refresh internal ready state" : "Open for internal actions";
  }

  return hasBeenSent ? "Refresh ready state" : "Mark ready to distribute";
}

function getDeliveryModeCompletionCopy(document: WorkflowDocument) {
  if (document.deliveryMode === "platform_managed") {
    return "EasyDraft will queue the next eligible action request and can notify the originator as signatures or approvals complete.";
  }

  if (document.deliveryMode === "internal_use_only") {
    return "Internal-use-only documents are completed by authenticated EasyDraft users. They stay inside EasyDraft and are not third-party certified.";
  }

  return `This file stays in the workspace while you edit it, then you can download or share it${
    document.distributionTarget ? ` through ${document.distributionTarget}` : ""
  }.`;
}

function getDeliveryModeReadyCopy(document: WorkflowDocument, hasBeenSent: boolean) {
  if (document.deliveryMode === "platform_managed") {
    return hasBeenSent
      ? "The workflow has been sent. Use reopen or send again if routing changes."
      : "EasyDraft will queue the next eligible participant when you send.";
  }

  if (document.deliveryMode === "internal_use_only") {
    return hasBeenSent
      ? "This document is open for internal signing inside EasyDraft."
      : "Open the document for internal actions once setup is complete, then ask participants to log in and complete their assigned fields.";
  }

  return hasBeenSent
    ? "This document has been marked ready for self-managed distribution."
    : "Mark the document ready once setup is complete, then share or download it yourself.";
}

function getPortalQueryPreference() {
  if (typeof window === "undefined") {
    return null;
  }

  const requestedPortal = new URLSearchParams(window.location.search).get("portal");
  return requestedPortal === "workspace" || requestedPortal === "org_admin" ? requestedPortal : null;
}

function getPublicPage(pathname: string): PublicPage {
  if (pathname === "/pricing") return "pricing";
  if (pathname === "/privacy") return "privacy";
  if (pathname === "/terms") return "terms";
  if (pathname === "/security") return "security";
  return "home";
}

function getQuickRouteLabels(deliveryMode: WorkflowDocument["deliveryMode"]) {
  if (deliveryMode === "internal_use_only") {
    return {
      heading: "Internal participant setup",
      primary: "Add next internal participant",
      secondary: "Add parallel internal participant",
    };
  }

  return {
    heading: "Next step",
    primary: "Queue next participant",
    secondary: "Add parallel participant",
  };
}

function getFallbackSessionUser(currentSession: Session): SessionUser | null {
  const user = currentSession.user;
  const email = user.email ?? null;

  if (!user.id || !email) {
    return null;
  }

  const rawName = user.user_metadata?.full_name;
  const name =
    typeof rawName === "string" && rawName.trim().length > 0
      ? rawName.trim()
      : email.split("@")[0] || "EasyDraft user";

  return {
    id: user.id,
    name,
    email,
    isAdmin: false,
  };
}

type ChecklistStep = {
  label: string;
  detail: string;
  done: boolean;
};

// ---------------------------------------------------------------------------
// Onboarding prompt — shown once after first sign-up
// ---------------------------------------------------------------------------

function OnboardingPrompt({
  session,
  workspaceTeam,
  userName,
  onComplete,
}: {
  session: Session;
  workspaceTeam: WorkspaceTeam;
  userName: string;
  onComplete: () => void;
}) {
  const [workspaceName, setWorkspaceName] = useState(workspaceTeam.workspace.name);
  const [inviteEmails, setInviteEmails] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Rename workspace if changed
      if (workspaceName.trim() && workspaceName.trim() !== workspaceTeam.workspace.name) {
        await apiFetch("/workspace-update", session, {
          method: "PATCH",
          body: JSON.stringify({ name: workspaceName.trim() }),
        });
      }

      // Send invitations for each email entered
      const emails = inviteEmails
        .split(/[\n,;]+/)
        .map((e) => e.trim())
        .filter((e) => e.includes("@"));

      await Promise.allSettled(
        emails.map((email) =>
          apiFetch("/workspace-invite", session, {
            method: "POST",
            body: JSON.stringify({ email, role: "member" }),
          }),
        ),
      );

      onComplete();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  const firstName = userName.split(" ")[0] || "there";

  return (
    <section className="card">
      <div className="section-heading compact">
        <p className="eyebrow">You're in, {firstName}. Let's set up your workspace.</p>
      </div>
      <p className="muted">Upload PDFs, assign signers, and send for signatures — your audit trail builds automatically.</p>
      {errorMessage ? <div className="alert">{errorMessage}</div> : null}
      <form className="stack" onSubmit={handleSubmit}>
        <label className="form-field">
          <span>Workspace name</span>
          <input
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span>Invite teammates <span className="muted">(optional — one email per line or comma-separated)</span></span>
          <textarea
            rows={3}
            placeholder="alice@company.com, bob@company.com"
            value={inviteEmails}
            onChange={(e) => setInviteEmails(e.target.value)}
          />
        </label>
        <div className="action-row">
          <button className="primary-button" disabled={isLoading} type="submit">
            {isLoading ? "Saving…" : "Get started"}
          </button>
          <button
            className="ghost-button"
            disabled={isLoading}
            onClick={onComplete}
            type="button"
          >
            I'll set this up later
          </button>
        </div>
      </form>
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [documents, setDocuments] = useState<WorkflowDocument[]>([]);
  const [billingOverview, setBillingOverview] = useState<BillingOverview | null>(null);
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const [digitalSignatureProfiles, setDigitalSignatureProfiles] = useState<DigitalSignatureProfile[]>([]);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminManagedUser[]>([]);
  const [adminFeedbackRequests, setAdminFeedbackRequests] = useState<AdminFeedbackRequest[]>([]);
  const [workspaceTeam, setWorkspaceTeam] = useState<WorkspaceTeam | null>(null);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<WorkspaceOption[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    () => (typeof window === "undefined" ? null : loadStoredWorkspaceId()),
  );
  const [portalView, setPortalView] = useState<PortalView>("workspace");
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const [joinedWorkspaceBanner, setJoinedWorkspaceBanner] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isWorkspaceSwitching, setIsWorkspaceSwitching] = useState(false);
  const [publicPage, setPublicPage] = useState<PublicPage>(() =>
    typeof window === "undefined" ? "home" : getPublicPage(window.location.pathname),
  );
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [isScannedUpload, setIsScannedUpload] = useState(false);
  const [uploadRouting, setUploadRouting] = useState<"sequential" | "parallel">("sequential");
  const [deliveryMode, setDeliveryMode] =
    useState<"self_managed" | "internal_use_only" | "platform_managed">("self_managed");
  const [distributionTarget, setDistributionTarget] = useState("");
  const [lockPolicy, setLockPolicy] = useState<
    "owner_only" | "owner_and_editors" | "owner_editors_and_active_signer"
  >("owner_only");
  const [notifyOriginatorOnEachSignature, setNotifyOriginatorOnEachSignature] = useState(true);
  const [dueAt, setDueAt] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signerParticipantType, setSignerParticipantType] = useState<"internal" | "external">(
    "external",
  );
  const [signerRequired, setSignerRequired] = useState(true);
  const [signerStage, setSignerStage] = useState("1");
  const [signerOrder, setSignerOrder] = useState("1");
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldKind, setFieldKind] =
    useState<"signature" | "initial" | "approval" | "date" | "text">("signature");
  const [fieldRequired, setFieldRequired] = useState(true);
  const [fieldPage, setFieldPage] = useState("1");
  const [fieldAssigneeSignerId, setFieldAssigneeSignerId] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [savedSignatureLabel, setSavedSignatureLabel] = useState("");
  const [savedSignatureTitle, setSavedSignatureTitle] = useState("");
  const [savedSignatureType, setSavedSignatureType] = useState<"typed" | "uploaded">("typed");
  const [savedSignatureTypedText, setSavedSignatureTypedText] = useState("");
  const [selectedSavedSignatureId, setSelectedSavedSignatureId] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileCompanyName, setProfileCompanyName] = useState("");
  const [profileJobTitle, setProfileJobTitle] = useState("");
  const [profileTimezone, setProfileTimezone] = useState("");
  const [profileLocale, setProfileLocale] = useState("");
  const [profileMarketingOptIn, setProfileMarketingOptIn] = useState(false);
  const [profileProductUpdatesOptIn, setProfileProductUpdatesOptIn] = useState(true);
  const [digitalSignatureLabel, setDigitalSignatureLabel] = useState("");
  const [digitalSignatureTitle, setDigitalSignatureTitle] = useState("");
  const [digitalSignatureSignerName, setDigitalSignatureSignerName] = useState("");
  const [digitalSignatureSignerEmail, setDigitalSignatureSignerEmail] = useState("");
  const [digitalSignatureOrganizationName, setDigitalSignatureOrganizationName] = useState("");
  const [digitalSignatureProvider, setDigitalSignatureProvider] =
    useState<"easy_draft_remote" | "qualified_remote" | "organization_hsm">("easy_draft_remote");
  const [digitalSignatureAssuranceLevel, setDigitalSignatureAssuranceLevel] = useState("advanced");
  const [activeSigningReason, setActiveSigningReason] = useState("approve");
  const [activeSigningLocation, setActiveSigningLocation] = useState("");
  const [nextSignerName, setNextSignerName] = useState("");
  const [nextSignerEmail, setNextSignerEmail] = useState("");
  const [fieldX, setFieldX] = useState("120");
  const [fieldY, setFieldY] = useState("540");
  const [fieldWidth, setFieldWidth] = useState("180");
  const [fieldHeight, setFieldHeight] = useState("40");
  const [workflowNote, setWorkflowNote] = useState("");
  const [reassignSignerId, setReassignSignerId] = useState("");
  const [reassignSignerName, setReassignSignerName] = useState("");
  const [reassignSignerEmail, setReassignSignerEmail] = useState("");
  const [guestSigningSession, setGuestSigningSession] = useState<GuestSigningSession | null>(null);
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null);
  const [renameDocName, setRenameDocName] = useState("");
  const [deleteAccountConfirmEmail, setDeleteAccountConfirmEmail] = useState("");
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [freeSignX, setFreeSignX] = useState("120");
  const [freeSignY, setFreeSignY] = useState("200");
  const [freeSignW, setFreeSignW] = useState("200");
  const [freeSignH, setFreeSignH] = useState("60");
  const [freeSignPage, setFreeSignPage] = useState("1");
  const portalQueryPreferenceRef = useRef<PortalView | null>(getPortalQueryPreference());
  const dragStateRef = useRef<{
    mode: "move" | "resize";
    target: "field" | "freesign";
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0] ?? null;
  const selectedSavedSignature =
    savedSignatures.find((signature) => signature.id === selectedSavedSignatureId) ??
    savedSignatures[0] ??
    null;
  const canEdit =
    selectedDocument?.currentUserRole === "owner" || selectedDocument?.currentUserRole === "editor";
  const canManageAccess = selectedDocument?.currentUserRole === "owner";
  const canManageWorkflow = canEdit;
  const sendReadiness = selectedDocument ? getDocumentSendReadiness(selectedDocument) : null;
  const requiredActionFields =
    selectedDocument?.fields.filter((field) => field.required && isActionFieldKind(field.kind)) ?? [];
  const signerLabelById = new Map(
    (selectedDocument?.signers ?? []).map((signer) => [
      signer.id,
      signer.email ? `${signer.name} (${signer.email})` : signer.name,
    ]),
  );
  const assignedRequiredActionFields = requiredActionFields.filter((field) => field.assigneeSignerId);
  const currentUserAssignedOpenFields =
    selectedDocument?.currentUserSignerId
      ? selectedDocument.fields.filter(
          (field) =>
            !field.completedAt && field.assigneeSignerId === selectedDocument.currentUserSignerId,
        )
      : [];
  const hasBeenSent = Boolean(selectedDocument?.sentAt);
  const hasCompletedSigning =
    (selectedDocument?.completionSummary.completedRequiredAssignedFields ?? 0) > 0;
  const currentUserIsActiveWorkflowSigner = Boolean(
    selectedDocument?.currentUserSignerId &&
      selectedDocument.waitingOn.signerId === selectedDocument.currentUserSignerId &&
      selectedDocument.operationalStatus !== "changes_requested" &&
      selectedDocument.operationalStatus !== "rejected" &&
      selectedDocument.operationalStatus !== "canceled",
  ) || Boolean(
    guestSigningSession &&
      selectedDocument?.currentUserSignerId === guestSigningSession.signerId &&
      selectedDocument?.operationalStatus !== "changes_requested" &&
      selectedDocument?.operationalStatus !== "rejected" &&
      selectedDocument?.operationalStatus !== "canceled",
  );
  const quickRouteLabels = selectedDocument
    ? getQuickRouteLabels(selectedDocument.deliveryMode)
    : null;
  const sendActionLabel = selectedDocument
    ? getDeliveryModeActionLabel(selectedDocument.deliveryMode, hasBeenSent)
    : "Send";
  const canLockDocument = canCurrentUserLockDocument(selectedDocument);
  const canReopenDocument = Boolean(
    selectedDocument &&
      (selectedDocument.lockedAt ||
        selectedDocument.completedAt ||
        selectedDocument.workflowState === "sent" ||
        selectedDocument.workflowState === "partially_signed"),
  );
  const checklistSteps: ChecklistStep[] = selectedDocument
    ? [
        {
          label: "Upload",
          detail: "PDF stored privately and preview ready.",
          done: true,
        },
        {
          label: "Add participants",
          detail:
            selectedDocument.signers.length > 0
              ? `${selectedDocument.signers.length} participant${selectedDocument.signers.length === 1 ? "" : "s"} added.`
              : "Add at least one participant so the workflow has an owner for each signing action.",
          done: selectedDocument.signers.length > 0,
        },
        {
          label: "Place required fields",
          detail:
            requiredActionFields.length > 0
              ? `${requiredActionFields.length} required action field${requiredActionFields.length === 1 ? "" : "s"} placed.`
              : "Add at least one required signature, initial, or approval field.",
          done: requiredActionFields.length > 0,
        },
        {
          label: "Assign routing",
          detail:
            requiredActionFields.length > 0 &&
            assignedRequiredActionFields.length === requiredActionFields.length
              ? selectedDocument.routingStrategy === "sequential"
                ? "Every required action field is assigned and ordered for sequential routing."
                : "Every required action field is assigned for parallel routing."
              : "Assign every required action field to a participant before sending.",
          done:
            requiredActionFields.length > 0 &&
            assignedRequiredActionFields.length === requiredActionFields.length &&
            sendReadiness?.blockers.every(
              (blocker) =>
                blocker !==
                "Set an action order for each participant assigned to a required signature, initial, or approval field.",
            ) !== false,
        },
        {
          label:
            selectedDocument.deliveryMode === "platform_managed"
              ? "Send and route"
              : selectedDocument.deliveryMode === "internal_use_only"
                ? "Open internal actions"
                : "Ready to distribute",
          detail: getDeliveryModeReadyCopy(selectedDocument, hasBeenSent),
          done: hasBeenSent,
        },
        {
          label: "Complete",
          detail:
            selectedDocument.workflowState === "completed"
              ? "All required assigned action fields are complete."
              : hasCompletedSigning
                ? `${selectedDocument.completionSummary.remainingRequiredAssignedFields} required field${selectedDocument.completionSummary.remainingRequiredAssignedFields === 1 ? "" : "s"} still open.`
                : "No required actions have been completed yet.",
          done: selectedDocument.workflowState === "completed",
        },
      ]
    : [];
  const activeChecklistIndex = checklistSteps.findIndex((step) => !step.done);
  const nextActionMessage = selectedDocument
    ? selectedDocument.workflowState === "completed"
      ? "Completed. Download or share this document, or duplicate it to start a new workflow run."
      : selectedDocument.operationalStatus === "changes_requested" ||
          selectedDocument.operationalStatus === "rejected" ||
          selectedDocument.operationalStatus === "canceled" ||
          selectedDocument.operationalStatus === "overdue"
        ? selectedDocument.waitingOn.summary
      : selectedDocument.lockedAt
        ? "This workflow is locked. Reopen it when you need additional edits, signatures, or approvals."
        : hasBeenSent && currentUserAssignedOpenFields.length > 0
          ? `You're up next. Complete ${currentUserAssignedOpenFields.length} assigned field${currentUserAssignedOpenFields.length === 1 ? "" : "s"}.`
        : !sendReadiness?.ready
          ? sendReadiness?.blockers[0] ?? "Finish setup before sending."
          : !hasBeenSent
            ? selectedDocument.deliveryMode === "platform_managed"
              ? "Ready to send. EasyDraft will notify the next eligible participant."
              : selectedDocument.deliveryMode === "internal_use_only"
                ? "Ready to open for internal actions in EasyDraft."
                : "Ready to distribute. Mark it ready, then share or download it on your terms."
            : hasCompletedSigning
              ? `In progress. ${selectedDocument.completionSummary.remainingRequiredAssignedFields} required field${selectedDocument.completionSummary.remainingRequiredAssignedFields === 1 ? "" : "s"} still need completion.`
              : selectedDocument.deliveryMode === "platform_managed"
                ? "Sent and waiting for the first participant to act."
                : selectedDocument.deliveryMode === "internal_use_only"
                  ? "Open for internal actions. Participants can log in and complete their assigned fields."
                : "Ready for self-managed distribution."
    : "";

  async function refreshSession(currentSession: Session | null) {
    setSession(currentSession);

    if (!currentSession) {
      clearStoredSession();
      clearStoredWorkspaceId();
      setSessionUser(null);
      setDocuments([]);
      setBillingOverview(null);
      setSavedSignatures([]);
      setAccountProfile(null);
      setDigitalSignatureProfiles([]);
      setAdminOverview(null);
      setAdminUsers([]);
      setAdminFeedbackRequests([]);
      setWorkspaceTeam(null);
      setAvailableWorkspaces([]);
      setActiveWorkspaceId(null);
      setSelectedDocumentId(null);
      return;
    }

    persistSession(currentSession);
    const fallbackUser = getFallbackSessionUser(currentSession);
    if (fallbackUser) {
      setSessionUser(fallbackUser);
    }

    try {
      const payload = await apiFetch<{ user: SessionUser }>("/session", currentSession);
      setSessionUser(payload.user);
      return payload.user;
    } catch (error) {
      if (!fallbackUser) {
        throw error;
      }
    }
    return fallbackUser;
  }

  async function refreshWorkspaceDirectory(activeSession: Session) {
    const payload = await apiFetch<WorkspaceDirectory>("/workspaces", activeSession);
    setAvailableWorkspaces(payload.workspaces);
    setActiveWorkspaceId(payload.currentWorkspace.id);
    persistWorkspaceId(payload.currentWorkspace.id);
    return payload.currentWorkspace;
  }

  async function refreshBilling(activeSession: Session) {
    const payload = await apiFetch<BillingOverview>("/billing-overview", activeSession);
    setBillingOverview(payload);
  }

  async function refreshTeam(activeSession: Session) {
    const payload = await apiFetch<WorkspaceTeam>("/workspace-team", activeSession);
    setWorkspaceTeam(payload);
  }

  async function refreshProfile(activeSession: Session) {
    const payload = await apiFetch<{ profile: AccountProfile }>("/profile", activeSession);
    setAccountProfile(payload.profile);
    setProfileDisplayName(payload.profile.displayName);
    setProfileCompanyName(payload.profile.companyName ?? "");
    setProfileJobTitle(payload.profile.jobTitle ?? "");
    setProfileTimezone(payload.profile.timezone ?? "");
    setProfileLocale(payload.profile.locale ?? "");
    setProfileMarketingOptIn(payload.profile.marketingOptIn);
    setProfileProductUpdatesOptIn(payload.profile.productUpdatesOptIn);
  }

  async function refreshSavedSignatures(activeSession: Session) {
    const payload = await apiFetch<{ signatures: SavedSignature[] }>("/saved-signatures", activeSession);
    setSavedSignatures(payload.signatures);
    setSelectedSavedSignatureId((currentValue) => currentValue || payload.signatures[0]?.id || "");
  }

  async function refreshDigitalSignatureProfiles(activeSession: Session) {
    if (!isCertificateSigningEnabled) {
      setDigitalSignatureProfiles([]);
      return;
    }

    const payload = await apiFetch<{ profiles: DigitalSignatureProfile[] }>(
      "/digital-signatures",
      activeSession,
    );
    setDigitalSignatureProfiles(payload.profiles);
  }

  async function refreshAdminOverview(activeSession: Session) {
    const payload = await apiFetch<AdminOverview>("/admin-overview", activeSession);
    setAdminOverview(payload);
  }

  async function refreshAdminUsers(activeSession: Session) {
    const payload = await apiFetch<{ users: AdminManagedUser[] }>("/admin-users", activeSession);
    setAdminUsers(payload.users);
  }

  async function refreshAdminFeedback(activeSession: Session) {
    const payload = await apiFetch<{ feedbackRequests: AdminFeedbackRequest[] }>("/admin-feedback", activeSession);
    setAdminFeedbackRequests(payload.feedbackRequests);
  }

  async function refreshDocuments(activeSession: Session) {
    const payload = await apiFetch<{ documents: WorkflowDocument[] }>("/documents-list", activeSession, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setDocuments(payload.documents);
    setSelectedDocumentId((currentId) =>
      currentId && payload.documents.some((document) => document.id === currentId)
        ? currentId
        : payload.documents[0]?.id ?? null,
    );
  }

  async function refreshDocument(documentId: string, activeSession: Session) {
    const payload = await apiFetch<{ document: WorkflowDocument }>(
      `/document?documentId=${encodeURIComponent(documentId)}`,
      activeSession,
    );

    setDocuments((currentDocuments) => {
      const nextDocuments = currentDocuments.filter((document) => document.id !== documentId);
      return [payload.document, ...nextDocuments];
    });
    setSelectedDocumentId(documentId);
  }

  async function loadPreview(documentId: string, activeSession: Session) {
    const payload = await apiFetch<{ signedUrl: string }>(
      `/document-download?documentId=${encodeURIComponent(documentId)}`,
      activeSession,
    );
    setPreviewUrl(payload.signedUrl);
  }

  async function handleWorkspaceChange(nextWorkspaceId: string) {
    if (!session || nextWorkspaceId === activeWorkspaceId) {
      return;
    }

    persistWorkspaceId(nextWorkspaceId);
    setActiveWorkspaceId(nextWorkspaceId);
    setIsWorkspaceSwitching(true);
    setErrorMessage(null);
    setNoticeMessage(null);
    setSelectedDocumentId(null);
    setPreviewUrl(null);
    setLocalPreviewUrl(null);

    try {
      await refreshWorkspaceDirectory(session);
      await Promise.allSettled([
        refreshBilling(session),
        refreshTeam(session),
        refreshDocuments(session),
      ]);
      showToast("Workspace updated.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsWorkspaceSwitching(false);
    }
  }

  async function runDocumentAction(path: string, body: Record<string, unknown>) {
    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch(path, session, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await refreshDocument(selectedDocument.id, session);
      await refreshDocuments(session);
      await loadPreview(selectedDocument.id, session);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function runGuestFieldComplete(
    fieldId: string,
    signingReason?: string | null,
    signingLocation?: string | null,
    value?: string | null,
  ) {
    if (!guestSigningSession) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const res = await fetch("/api/document-field-complete-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: guestSigningSession.signerToken,
          documentId: guestSigningSession.documentId,
          fieldId,
          signingReason: signingReason ?? null,
          signingLocation: signingLocation ?? null,
          value: value ?? null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error((data as { message?: string }).message ?? "Failed to complete field.");
      }

      const payload = await res.json() as { document: WorkflowDocument };
      setDocuments([payload.document]);
      setGuestSigningSession((prev) => prev ? { ...prev, document: payload.document } : prev);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpdateWorkflowDueDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch("/document-workflow", session, {
        method: "POST",
        body: JSON.stringify({
          documentId: selectedDocument.id,
          dueAt: fromDateTimeLocalValue(dueAt),
        }),
      });
      await refreshDocument(selectedDocument.id, session);
      await refreshDocuments(session);
      setNoticeMessage(dueAt ? "Workflow due date updated." : "Workflow due date cleared.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSignerWorkflowResponse(path: "/document-request-changes" | "/document-reject") {
    if (!session || !selectedDocument) {
      return;
    }

    const note = workflowNote.trim();

    if (!note) {
      setErrorMessage("Add a short note before sending this workflow response.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch(path, session, {
        method: "POST",
        body: JSON.stringify({
          documentId: selectedDocument.id,
          note,
        }),
      });
      await refreshDocument(selectedDocument.id, session);
      await refreshDocuments(session);
      setWorkflowNote("");
      setNoticeMessage(
        path === "/document-request-changes"
          ? "Changes requested and returned to the initiator."
          : "Workflow rejected.",
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCancelWorkflow() {
    if (!session || !selectedDocument) {
      return;
    }

    const note = workflowNote.trim();

    if (!note) {
      setErrorMessage("Add a short reason before canceling this workflow.");
      return;
    }

    if (!window.confirm("Cancel this workflow? The audit trail is kept but the current run will be closed.")) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch("/document-cancel", session, {
        method: "POST",
        body: JSON.stringify({
          documentId: selectedDocument.id,
          note,
        }),
      });
      await refreshDocument(selectedDocument.id, session);
      await refreshDocuments(session);
      setWorkflowNote("");
      setNoticeMessage("Workflow canceled.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleReassignSigner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch("/document-signer-reassign", session, {
        method: "POST",
        body: JSON.stringify({
          documentId: selectedDocument.id,
          signerId: reassignSignerId,
          name: reassignSignerName,
          email: reassignSignerEmail,
        }),
      });
      await refreshDocument(selectedDocument.id, session);
      await refreshDocuments(session);
      setReassignSignerId("");
      setReassignSignerName("");
      setReassignSignerEmail("");
      setNoticeMessage("Participant reassigned.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function copyTextToClipboard(value: string) {
    await navigator.clipboard.writeText(value);
  }

  async function handleDownloadDocument() {
    if (!previewUrl && !localPreviewUrl) {
      setErrorMessage("Choose or load a document before downloading.");
      return;
    }

    window.open(previewUrl ?? localPreviewUrl ?? undefined, "_blank", "noopener,noreferrer");
  }

  function handleDownloadCertificate() {
    if (!selectedDocument) return;

    const doc = selectedDocument;
    const ts = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

    const signerRows = doc.signers
      .map((s) => {
        const completedFields = doc.fields.filter(
          (f) => f.assigneeSignerId === s.id && f.completedAt,
        );
        const lastCompleted = completedFields.reduce<string | null>(
          (latest, f) => (!latest || (f.completedAt ?? "") > latest ? (f.completedAt ?? null) : latest),
          null,
        );
        return `<tr>
          <td>${s.name}</td>
          <td>${s.email}</td>
          <td>${s.participantType}</td>
          <td>${lastCompleted ? ts(lastCompleted) : "—"}</td>
        </tr>`;
      })
      .join("");

    const auditRows = doc.auditTrail
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(
        (e) =>
          `<tr><td>${ts(e.createdAt)}</td><td>${AUDIT_EVENT_LABELS[e.type] ?? e.type}</td><td>${e.summary}</td></tr>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Completion Certificate — ${doc.name}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 860px; margin: 40px auto; color: #18241d; }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    .meta { color: #6b7280; font-size: 0.9rem; margin-bottom: 32px; }
    h2 { font-size: 1rem; font-weight: 600; margin: 28px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th { text-align: left; padding: 6px 10px; background: #f6f2eb; }
    td { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
    .footer { margin-top: 40px; font-size: 0.8rem; color: #9ca3af; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <h1>${doc.name}</h1>
  <p class="meta">
    Workflow completed: ${ts(doc.completedAt)} &nbsp;·&nbsp;
    Sent: ${ts(doc.sentAt)} &nbsp;·&nbsp;
    Delivery: ${doc.deliveryMode.replaceAll("_", " ")} &nbsp;·&nbsp;
    Routing: ${doc.routingStrategy}
  </p>

  <h2>Signers</h2>
  <table>
    <thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Last action</th></tr></thead>
    <tbody>${signerRows}</tbody>
  </table>

  <h2>Audit trail</h2>
  <table>
    <thead><tr><th>Timestamp</th><th>Event</th><th>Detail</th></tr></thead>
    <tbody>${auditRows}</tbody>
  </table>

  <h2>Document integrity</h2>
  <table>
    <thead><tr><th>Property</th><th>Value</th></tr></thead>
    <tbody>
      <tr>
        <td>Document ID</td>
        <td style="font-family:monospace">${doc.id}</td>
      </tr>
      <tr>
        <td>SHA-256 (last export)</td>
        <td style="font-family:monospace;font-size:0.8rem;word-break:break-all">${doc.exportSha256 ?? "Not yet exported — download the document to generate the hash."}</td>
      </tr>
      <tr>
        <td>Latest change impact</td>
        <td>${doc.latestChangeImpact ? doc.latestChangeImpact.replaceAll("_", " ") : "No post-sign change impact recorded."}</td>
      </tr>
    </tbody>
  </table>
  <p style="font-size:0.8rem;color:#9ca3af;margin-top:8px">
    The SHA-256 digest is computed server-side over the final rendered PDF bytes at download time and stored
    alongside the document record. To verify your copy: <code>sha256sum your-file.pdf</code> and compare to
    the value above. Certificate-backed PDF signing is not part of the current beta release.
  </p>
  ${doc.latestChangeImpactSummary ? `<p style="font-size:0.8rem;color:#cbd5e1;margin-top:8px">${doc.latestChangeImpactSummary}</p>` : ""}

  <p class="footer">Generated by EasyDraft · ${new Date().toLocaleString()} · Document ID: ${doc.id}</p>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function handleShareDocument() {
    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const payload = await apiFetch<{ url: string; expiresInSeconds: number }>("/document-share", session, {
        method: "POST",
        body: JSON.stringify({ documentId: selectedDocument.id }),
      });
      await copyTextToClipboard(payload.url);
      setNoticeMessage(
        `Secure share link copied. It expires in ${Math.round(payload.expiresInSeconds / 3600)} hours.`,
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDuplicateDocument() {
    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const payload = await apiFetch<{ document: WorkflowDocument }>("/document-duplicate", session, {
        method: "POST",
        body: JSON.stringify({ documentId: selectedDocument.id }),
      });
      await refreshDocuments(session);
      await refreshDocument(payload.document.id, session);
      await loadPreview(payload.document.id, session);
      setNoticeMessage("A saved copy was created in your EasyDraft workspace.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRenameDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !renamingDocumentId) {
      return;
    }

    const name = renameDocName.trim();

    if (!name) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch("/document-rename", session, {
        method: "POST",
        body: JSON.stringify({ documentId: renamingDocumentId, name }),
      });
      setRenamingDocumentId(null);
      setRenameDocName("");
      await refreshDocuments(session);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteDocument() {
    if (!session || !selectedDocument) {
      return;
    }

    if (!window.confirm(`Delete "${selectedDocument.name}"? Stored files will be purged from EasyDraft and this cannot be undone.`)) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch("/document-delete", session, {
        method: "POST",
        body: JSON.stringify({ documentId: selectedDocument.id }),
      });
      setPreviewUrl(null);
      setLocalPreviewUrl(null);
      await refreshBilling(session);
      await refreshDocuments(session);
      setNoticeMessage("Document files were purged from EasyDraft and removed from the active workspace list.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpdateDocumentRetention(retentionMode: "temporary" | "retained") {
    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch("/document-retention", session, {
        method: "POST",
        body: JSON.stringify({
          documentId: selectedDocument.id,
          retentionMode,
        }),
      });
      await refreshDocument(selectedDocument.id, session);
      await refreshDocuments(session);
      await refreshBilling(session);
      await loadPreview(selectedDocument.id, session);
      setNoticeMessage(
        retentionMode === "retained"
          ? "Document storage is now kept until you delete it."
          : "Document storage is now temporary and will purge automatically when eligible.",
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const payload = await apiFetch<{ profile: AccountProfile }>("/profile", session, {
        method: "POST",
        body: JSON.stringify({
          displayName: profileDisplayName,
          companyName: profileCompanyName.trim() || null,
          jobTitle: profileJobTitle.trim() || null,
          timezone: profileTimezone.trim() || null,
          locale: profileLocale.trim() || null,
          marketingOptIn: profileMarketingOptIn,
          productUpdatesOptIn: profileProductUpdatesOptIn,
        }),
      });
      setAccountProfile(payload.profile);
      setNoticeMessage("Account preferences updated.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateDigitalSignatureProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const payload = await apiFetch<{ profile: DigitalSignatureProfile }>("/digital-signatures", session, {
        method: "POST",
        body: JSON.stringify({
          label: digitalSignatureLabel,
          titleText: digitalSignatureTitle.trim() || null,
          signerName: digitalSignatureSignerName.trim(),
          signerEmail: digitalSignatureSignerEmail.trim() || null,
          organizationName: digitalSignatureOrganizationName.trim() || null,
          provider: digitalSignatureProvider,
          assuranceLevel: digitalSignatureAssuranceLevel,
        }),
      });
      setDigitalSignatureProfiles((current) => [payload.profile, ...current.filter((profile) => profile.id !== payload.profile.id)]);
      setDigitalSignatureLabel("");
      setDigitalSignatureTitle("");
      setDigitalSignatureSignerName("");
      setDigitalSignatureSignerEmail("");
      setDigitalSignatureOrganizationName("");
      refreshDigitalSignatureProfiles(session).catch(() => null);
      setNoticeMessage(
        "Digital-signature profile request saved. Certificate-backed signing still requires provider verification before it can be used on PDFs.",
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleQuickRoute(routeMode: "sequential" | "parallel") {
    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      if (selectedDocument.routingStrategy !== routeMode) {
        await apiFetch("/document-routing", session, {
          method: "POST",
          body: JSON.stringify({
            documentId: selectedDocument.id,
            routingStrategy: routeMode,
          }),
        });
      }

      await apiFetch("/document-signers", session, {
        method: "POST",
        body: JSON.stringify({
          documentId: selectedDocument.id,
          name: nextSignerName,
          email: nextSignerEmail,
          participantType:
            selectedDocument.deliveryMode === "internal_use_only" ? "internal" : "external",
          required: true,
          routingStage:
            routeMode === "sequential"
              ? Math.max(0, ...selectedDocument.signers.map((signer) => signer.routingStage ?? 1)) + 1
              : Math.max(1, ...selectedDocument.signers.map((signer) => signer.routingStage ?? 1)),
          signingOrder:
            routeMode === "sequential"
              ? 1
              : null,
        }),
      });

      await apiFetch("/document-send", session, {
        method: "POST",
        body: JSON.stringify({ documentId: selectedDocument.id }),
      });

      await refreshDocument(selectedDocument.id, session);
      await refreshDocuments(session);
      setNextSignerName("");
      setNextSignerEmail("");
      setNoticeMessage(
        routeMode === "sequential"
          ? "Next-stage participant added and routing updated."
          : "Parallel participant added and parallel routing updated.",
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateSavedSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !sessionUser) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      let storagePath: string | null = null;

      if (savedSignatureType === "uploaded") {
        const uploadInput = document.getElementById("saved-signature-upload") as HTMLInputElement | null;
        const file = uploadInput?.files?.[0];

        if (!file) {
          throw new Error("Choose an image file for this saved signature.");
        }

        storagePath = `${sessionUser.id}/saved-signatures/${crypto.randomUUID()}-${file.name}`;
        let uploadResponse: Response;
        try {
          uploadResponse = await fetch(
            `/api/storage-upload?bucket=${encodeURIComponent(signatureBucket)}&path=${encodeURIComponent(storagePath)}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                "Content-Type": file.type || "image/png",
              },
              body: file,
            },
          );
        } catch (error) {
          throw new Error(`Network error calling /storage-upload: ${(error as Error).message}`);
        }

        if (!uploadResponse.ok) {
          const payload = (await uploadResponse.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message ?? "Failed to upload saved signature.");
        }
      }

      const payload = await apiFetch<{ signature: SavedSignature }>("/saved-signatures", session, {
        method: "POST",
        body: JSON.stringify({
          label: savedSignatureLabel,
          titleText: savedSignatureTitle.trim() || null,
          signatureType: savedSignatureType,
          typedText: savedSignatureType === "typed" ? savedSignatureTypedText : null,
          storagePath,
          isDefault: savedSignatures.length === 0,
        }),
      });
      setSavedSignatures((current) => [
        payload.signature,
        ...current.filter((signature) => signature.id !== payload.signature.id),
      ]);

      setSavedSignatureLabel("");
      setSavedSignatureTitle("");
      setSavedSignatureTypedText("");
      setSelectedSavedSignatureId(payload.signature.id);

      const uploadInput = document.getElementById("saved-signature-upload") as HTMLInputElement | null;
      if (uploadInput) {
        uploadInput.value = "";
      }

      refreshSavedSignatures(session).catch(() => null);
      setNoticeMessage("Saved signature added to your EasyDraft profile.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  function scrollSidebarTo(id: string) {
    const section = document.getElementById(id);
    if (!sidebarRef.current || !section) return;
    sidebarRef.current.scrollTo({ top: section.offsetTop - 24, behavior: "smooth" });
  }

  function scrollMainTo(id: string) {
    const section = document.getElementById(id);
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    function handlePopState() {
      setPublicPage(getPublicPage(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigatePublicPage(nextPage: PublicPage) {
    const nextPath =
      nextPage === "pricing"
        ? "/pricing"
        : nextPage === "privacy"
        ? "/privacy"
        : nextPage === "terms"
        ? "/terms"
        : nextPage === "security"
        ? "/security"
        : "/";
    window.history.pushState({}, "", nextPath);
    setPublicPage(nextPage);
  }

  function handleSignOut() {
    clearStoredSession();
    clearStoredWorkspaceId();
    showToast("You've been signed out.");
    setPreviewUrl(null);
    setLocalPreviewUrl(null);
    setUploadName(null);
    setWorkspaceTeam(null);
    setBillingOverview(null);
    setAvailableWorkspaces([]);
    setActiveWorkspaceId(null);
    setSelectedDocumentId(null);
    setJoinedWorkspaceBanner(null);
    setSession(null);
    setSessionUser(null);
  }

  async function handleDeleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !accountProfile) {
      return;
    }

    setIsDeletingAccount(true);
    setDeleteAccountError(null);

    try {
      await apiFetch("/account-delete", session, {
        method: "POST",
        body: JSON.stringify({ confirmEmail: deleteAccountConfirmEmail }),
      });
      // Account is gone — sign out and clear state
      handleSignOut();
      setSession(null);
      setSessionUser(null);
    } catch (error) {
      setDeleteAccountError((error as Error).message);
      setIsDeletingAccount(false);
    }
  }

  async function handleUpload(file: File) {
    if (!session || !sessionUser) {
      setErrorMessage("Sign in before uploading a PDF.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    const documentId = crypto.randomUUID();
    const storagePath = `${sessionUser.id}/${documentId}/${file.name}`;

    try {
      setLocalPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }

        return URL.createObjectURL(file);
      });
      setUploadName(file.name);

      const uploadResponse = await fetch(
        `/api/storage-upload?bucket=${encodeURIComponent(documentBucket)}&path=${encodeURIComponent(storagePath)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": file.type || "application/pdf",
          },
          body: file,
        },
      );

      if (!uploadResponse.ok) {
        const payload = (await uploadResponse.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Failed to upload PDF.");
      }

      const payload = await apiFetch<{ document: WorkflowDocument }>("/documents", session, {
        method: "POST",
        body: JSON.stringify({
          id: documentId,
          name: filenameToTitle(file.name),
          fileName: file.name,
          storagePath,
          fileSize: file.size,
          pageCount: null,
          routingStrategy: uploadRouting,
          deliveryMode,
          distributionTarget: distributionTarget.trim() || null,
          lockPolicy,
          notifyOriginatorOnEachSignature,
          dueAt: fromDateTimeLocalValue(dueAt),
          isScanned: isScannedUpload,
        }),
      });

      setSelectedDocumentId(payload.document.id);
      await refreshDocuments(session);
      await loadPreview(payload.document.id, session);
      setDistributionTarget("");
      setDueAt("");
      setNoticeMessage("PDF uploaded and document created.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddSigner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDocument) {
      return;
    }

    await runDocumentAction("/document-signers", {
      documentId: selectedDocument.id,
      name: signerName,
      email: signerEmail,
      participantType: signerParticipantType,
      required: signerRequired,
      routingStage: Number(signerStage),
      signingOrder: signerOrder.trim() ? Number(signerOrder) : null,
    });

    setSignerName("");
    setSignerEmail("");
    setSignerParticipantType(selectedDocument.deliveryMode === "internal_use_only" ? "internal" : "external");
    setSignerRequired(true);
    setSignerStage("1");
    setSignerOrder(String((selectedDocument.signers.length || 0) + 1));
  }

  async function handleAddField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDocument) {
      return;
    }

    await runDocumentAction("/document-fields", {
      documentId: selectedDocument.id,
      page: Number(fieldPage),
      kind: fieldKind,
      label: fieldLabel,
      required: fieldRequired,
      assigneeSignerId: fieldAssigneeSignerId || null,
      source: "manual",
      x: Number(fieldX),
      y: Number(fieldY),
      width: Number(fieldWidth),
      height: Number(fieldHeight),
    });

    setFieldLabel("");
    setFieldRequired(true);
  }

  async function handleInviteCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDocument) {
      return;
    }

    await runDocumentAction("/document-access", {
      documentId: selectedDocument.id,
      email: inviteEmail,
      role: inviteRole,
    });

    setInviteEmail("");
    setInviteRole("viewer");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get("checkout");
    const billingStatus = params.get("billing");
    const checkoutPlan = params.get("plan");
    const signingToken = params.get("signingToken");
    const signingDocumentId = params.get("documentId");
    const inviteToken = params.get("invite");
    const requestedPortal = params.get("portal");
    const authError = params.get("authError");
    const signedIn = params.get("signedIn");

    if (requestedPortal === "workspace" || requestedPortal === "org_admin") {
      portalQueryPreferenceRef.current = requestedPortal;
      setPortalView(requestedPortal);
    }

    if (inviteToken) {
      setPendingInviteToken(inviteToken);
      params.delete("invite");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }

    if (checkoutStatus === "success") {
      setNoticeMessage("Billing updated. Stripe redirected back successfully.");
      // Refresh billing data when Stripe returns so the UI reflects the new subscription
      const storedSession = loadStoredSession();
      if (storedSession) {
        refreshBilling(storedSession).catch(() => null);
      }
    }

    if (checkoutStatus === "cancelled") {
      setNoticeMessage("Checkout was cancelled. Your workspace billing did not change.");
    }

    if (checkoutStatus === "placeholder") {
      setNoticeMessage(
        `Stripe placeholder opened for ${checkoutPlan ?? "the selected"} plan. Add Stripe keys when you are ready to make billing live.`,
      );
    }

    if (billingStatus === "portal_placeholder") {
      setNoticeMessage("Billing portal placeholder opened. Live billing will activate once Stripe is configured.");
    }

    if (authError) {
      setErrorMessage(authError);
    }

    if (signingToken && signingDocumentId) {
      fetch("/api/signing-token-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: signingToken, documentId: signingDocumentId }),
      })
        .then((res) => {
          if (!res.ok) return res.json().then((data) => Promise.reject(new Error(data.message ?? "Invalid signing link.")));
          return res.json();
        })
        .then((data) => {
          setGuestSigningSession(data as GuestSigningSession);
          setDocuments([data.document as WorkflowDocument]);
          setSelectedDocumentId(data.documentId as string);
          if (data.previewUrl) setPreviewUrl(data.previewUrl as string);
        })
        .catch((error: Error) => setErrorMessage(error.message));
    }

    params.delete("checkout");
    params.delete("plan");
    params.delete("billing");
    params.delete("signingToken");
    params.delete("authError");
    params.delete("signedIn");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  useEffect(() => {
    const storedSession = loadStoredSession();
    refreshSession(storedSession)
      .then((user) => {
        // Show toast only on an explicit sign-in redirect, not on every page load
        if (shouldRestoreSessionFromRedirect && user) {
          showToast(`Welcome back, ${user.name.split(" ")[0]}.`);
        }
      })
      .catch(() => {
        clearStoredSession();
        return refreshSession(null);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (!session || !sessionUser) {
      return;
    }

    const activeSession = session;
    let cancelled = false;

    async function loadWorkspaceState() {
      try {
        if (pendingInviteToken) {
          const payload = await apiFetch<{
            joined: boolean;
            alreadyMember: boolean;
            workspace: { id: string; name: string; slug: string } | null;
            role: string | null;
          }>("/workspace-invite-accept", activeSession, {
            method: "POST",
            body: JSON.stringify({ token: pendingInviteToken }),
          });

          if (!cancelled) {
            const workspaceName = payload.workspace?.name ?? "the workspace";
            if (payload.workspace?.id) {
              persistWorkspaceId(payload.workspace.id);
              setActiveWorkspaceId(payload.workspace.id);
            }
            setPendingInviteToken(null);
            setJoinedWorkspaceBanner(workspaceName);
            setNoticeMessage(
              payload.alreadyMember
                ? `You're already part of ${workspaceName}.`
                : `You've joined ${workspaceName}.`,
            );
            updatePortalView("workspace");
          }
        }

        await refreshWorkspaceDirectory(activeSession);

        await Promise.allSettled([
          refreshBilling(activeSession),
          refreshTeam(activeSession),
          refreshDocuments(activeSession),
          refreshSavedSignatures(activeSession),
          refreshProfile(activeSession),
          ...(isCertificateSigningEnabled ? [refreshDigitalSignatureProfiles(activeSession)] : []),
          ...(sessionUser?.isAdmin
            ? [
                refreshAdminOverview(activeSession),
                refreshAdminUsers(activeSession),
                refreshAdminFeedback(activeSession),
              ]
            : []),
        ]);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage((error as Error).message);
        }
      }
    }

    loadWorkspaceState();

    return () => {
      cancelled = true;
    };
  }, [session, sessionUser, sessionUser?.isAdmin, pendingInviteToken]);

  useEffect(() => {
    setSignerParticipantType(deliveryMode === "internal_use_only" ? "internal" : "external");
  }, [deliveryMode]);

  // Show onboarding prompt for users who haven't completed it (server-side flag)
  useEffect(() => {
    if (accountProfile && !accountProfile.onboardingCompletedAt) {
      setShowOnboarding(true);
    } else {
      setShowOnboarding(false);
    }
  }, [accountProfile?.onboardingCompletedAt]);

  useEffect(() => {
    if (!session || !selectedDocument?.id) {
      return;
    }

    setFieldAssigneeSignerId((currentValue) => currentValue || selectedDocument.signers[0]?.id || "");
    setReassignSignerId((currentValue) => currentValue || selectedDocument.signers[0]?.id || "");
    loadPreview(selectedDocument.id, session).catch((error) => setErrorMessage((error as Error).message));
  }, [selectedDocument?.id, session]);

  useEffect(() => {
    setDueAt(toDateTimeLocalValue(selectedDocument?.dueAt ?? null));
  }, [selectedDocument?.dueAt, selectedDocument?.id]);

  useEffect(() => {
    setErrorMessage(null);
    setNoticeMessage(null);
  }, [selectedDocument?.id]);

  useEffect(() => {
    const documentId = new URLSearchParams(window.location.search).get("documentId");

    if (!documentId) {
      return;
    }

    if (documents.some((document) => document.id === documentId)) {
      setSelectedDocumentId(documentId);
    }
  }, [documents]);

  useEffect(() => {
    if (!selectedDocument || !reassignSignerId) {
      return;
    }

    const signer = selectedDocument.signers.find((candidate) => candidate.id === reassignSignerId);

    if (!signer) {
      return;
    }

    setReassignSignerName(signer.name);
    setReassignSignerEmail(signer.email);
  }, [reassignSignerId, selectedDocument?.id]);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    };
  }, [localPreviewUrl]);

  const workspaceMembershipRole =
    billingOverview?.workspace.membershipRole ??
    workspaceTeam?.members.find((member) => member.isCurrentUser)?.role ??
    availableWorkspaces.find((workspace) => workspace.id === activeWorkspaceId)?.role ??
    null;
  const activeWorkspace =
    availableWorkspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const currentWorkspaceName =
    activeWorkspace?.organization?.name ??
    activeWorkspace?.name ??
    workspaceTeam?.organization.name ??
    workspaceTeam?.workspace.name ??
    billingOverview?.organization.name ??
    billingOverview?.workspace.name ??
    accountProfile?.companyName ??
    "Workspace";
  const currentWorkspaceRoleLabel = formatWorkspaceRoleLabel(workspaceMembershipRole);
  const isWorkspaceHydrating = Boolean(
    sessionUser &&
      session &&
      !guestSigningSession &&
      (isWorkspaceSwitching ||
        (!workspaceTeam && !billingOverview && !accountProfile && availableWorkspaces.length === 0)),
  );
  const orgAdminAccessResolved = Boolean(sessionUser && (sessionUser.isAdmin || billingOverview || workspaceTeam));
  const canAccessOrgAdmin = Boolean(
    sessionUser &&
      (sessionUser.isAdmin || ["owner", "admin", "billing_admin"].includes(workspaceMembershipRole ?? "")),
  );

  function updatePortalView(nextView: PortalView) {
    portalQueryPreferenceRef.current = nextView;
    setPortalView(nextView);
    const params = new URLSearchParams(window.location.search);
    params.set("portal", nextView);
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  useEffect(() => {
    if (portalView === "org_admin" && !canAccessOrgAdmin) {
      setPortalView("workspace");
    }
  }, [portalView, canAccessOrgAdmin]);

  useEffect(() => {
    if (!sessionUser || portalQueryPreferenceRef.current || !orgAdminAccessResolved) {
      return;
    }

    setPortalView(canAccessOrgAdmin ? "org_admin" : "workspace");
  }, [sessionUser, canAccessOrgAdmin, orgAdminAccessResolved]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current;

      if (!dragState) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;

      if (dragState.target === "freesign") {
        if (dragState.mode === "move") {
          setFreeSignX(String(Math.max(0, Math.round(dragState.originX + deltaX))));
          setFreeSignY(String(Math.max(0, Math.round(dragState.originY + deltaY))));
        } else {
          setFreeSignW(String(Math.max(80, Math.round(dragState.originWidth + deltaX))));
          setFreeSignH(String(Math.max(32, Math.round(dragState.originHeight + deltaY))));
        }
        return;
      }

      if (dragState.mode === "move") {
        setFieldX(String(Math.max(0, Math.round(dragState.originX + deltaX))));
        setFieldY(String(Math.max(0, Math.round(dragState.originY + deltaY))));
        return;
      }

      setFieldWidth(String(Math.max(48, Math.round(dragState.originWidth + deltaX))));
      setFieldHeight(String(Math.max(28, Math.round(dragState.originHeight + deltaY))));
    }

    function handlePointerUp() {
      dragStateRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  // Unauthenticated, non-guest users: dedicated landing page (sign-in + product info only)
  if (!sessionUser && !guestSigningSession) {
    return (
      <PublicSite
        publicPage={publicPage}
        pendingInviteToken={pendingInviteToken}
        errorMessage={errorMessage}
        noticeMessage={noticeMessage}
        onNavigatePublicPage={navigatePublicPage}
        onSessionCreated={(nextSession) => {
          refreshSession(nextSession).catch((error) => setErrorMessage((error as Error).message));
        }}
        onRegistered={() => updatePortalView("org_admin")}
      />
    );
  }

  if (!sessionUser && guestSigningSession && selectedDocument) {
    const guestWorkspaceName =
      workspaceTeam?.workspace.name ??
      billingOverview?.workspace.name ??
      accountProfile?.companyName ??
      "Workspace";
    const documentOwner =
      selectedDocument.accessParticipants.find((entry) => entry.role === "owner")?.displayName ??
      "The sender";
    const guestAssignedFields = selectedDocument.fields.filter(
      (field) =>
        field.assigneeSignerId === selectedDocument.currentUserSignerId &&
        !field.completedAt,
    );
    const guestCompletedFields = selectedDocument.fields.filter(
      (field) =>
        field.assigneeSignerId === selectedDocument.currentUserSignerId &&
        Boolean(field.completedAt),
    );
    const guestHasFinished = guestAssignedFields.length === 0 && guestCompletedFields.length > 0;

    return (
      <div className="signer-shell">
        <header className="signer-header">
          <div className="brand">
            <span className="brand-mark">ED</span>
            <div>
              <h1>EasyDraft</h1>
              <p>Secure signing for invited participants.</p>
            </div>
          </div>
          <a className="hero-guide-link" href="/guide.html" rel="noopener noreferrer" target="_blank">
            Need help?
          </a>
        </header>

        <main className="signer-main">
          <section className="signer-summary panel">
            <div className="section-heading compact">
              <p className="eyebrow">Requested signature</p>
              <span>{formatState(selectedDocument.workflowState)}</span>
            </div>
            <h2>{selectedDocument.name}</h2>
            <p className="muted">
              {documentOwner} asked <strong>{guestSigningSession.signerName}</strong> to review and complete this document through EasyDraftDocs.
            </p>
            <div className="signer-meta-grid">
              <div className="meta-item">
                <span>Organization</span>
                <strong>{guestWorkspaceName}</strong>
              </div>
              <div className="meta-item">
                <span>Waiting on</span>
                <strong>{selectedDocument.waitingOn.signerName ?? formatState(selectedDocument.waitingOn.kind)}</strong>
              </div>
              <div className="meta-item">
                <span>Due date</span>
                <strong>{formatTimestamp(selectedDocument.dueAt)}</strong>
              </div>
              <div className="meta-item">
                <span>Audit trail</span>
                <strong>Tracked automatically</strong>
              </div>
            </div>
          </section>

          {errorMessage ? <div className="alert">{errorMessage}</div> : null}
          {noticeMessage ? <div className="alert success">{noticeMessage}</div> : null}

          <div className="signer-grid">
            <section className="panel">
              <div className="section-heading compact">
                <p className="eyebrow">Document preview</p>
                <span>{previewUrl || localPreviewUrl ? "Ready" : "Loading…"}</span>
              </div>
              <div className="preview-frame signer-preview-frame">
                {previewUrl || localPreviewUrl ? (
                  <object data={previewUrl ?? localPreviewUrl ?? undefined} type="application/pdf">
                    <p>Preview unavailable for this browser.</p>
                  </object>
                ) : (
                  <div className="preview-empty">
                    <strong>Loading your document preview.</strong>
                    <p>EasyDraft is preparing the file so you can review and sign it securely.</p>
                  </div>
                )}
              </div>
            </section>

            <section className="panel signer-actions-panel">
              <div className="section-heading compact">
                <p className="eyebrow">Your actions</p>
                <span>{guestAssignedFields.length} remaining</span>
              </div>
              <p className="muted">
                Review the document, then complete the highlighted fields assigned to you. No account is required for this signing link.
              </p>

              {guestAssignedFields.length > 0 ? (
                <>
                  <div className="row-card">
                    <label className="form-field" style={{ flex: 1, margin: 0 }}>
                      <span>Reason for signing</span>
                      <select
                        value={activeSigningReason}
                        onChange={(event) => setActiveSigningReason(event.target.value)}
                      >
                        <option value="author">Author</option>
                        <option value="approve">Approve</option>
                        <option value="verify">Verify</option>
                        <option value="review">Review</option>
                        <option value="acknowledge">Acknowledge</option>
                        <option value="witness">Witness</option>
                        <option value="certify">Certify</option>
                      </select>
                    </label>
                  </div>
                  <label className="form-field">
                    <span>Signing location <span className="muted">(optional)</span></span>
                    <input
                      placeholder="Edmonton, Alberta"
                      value={activeSigningLocation}
                      onChange={(event) => setActiveSigningLocation(event.target.value)}
                    />
                  </label>
                  <div className="stack">
                    {guestAssignedFields.map((field) => (
                      <div key={field.id} className="row-card signer-task-card">
                        <div>
                          <strong>{field.label}</strong>
                          <p className="muted">Page {field.page} · {field.kind}</p>
                        </div>
                        <button
                          className="primary-button"
                          disabled={isLoading}
                          onClick={() =>
                            runGuestFieldComplete(
                              field.id,
                              activeSigningReason,
                              activeSigningLocation || null,
                            )
                          }
                          type="button"
                        >
                          {isLoading ? "Saving…" : "Complete field"}
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : guestHasFinished ? (
                <div className="signer-complete-card">
                  <p className="eyebrow">Completed</p>
                  <h3>You&apos;ve completed your part</h3>
                  <p className="muted">
                    {guestWorkspaceName} now has your signed response, and the workflow audit trail has been updated automatically.
                  </p>
                  <div className="signer-complete-actions">
                    {(previewUrl || localPreviewUrl) ? (
                      <a
                        className="ghost-button"
                        href={previewUrl ?? localPreviewUrl ?? undefined}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Review current document
                      </a>
                    ) : null}
                    {(previewUrl || localPreviewUrl) && selectedDocument.workflowState === "completed" ? (
                      <a
                        className="primary-button"
                        href={previewUrl ?? localPreviewUrl ?? undefined}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Download final signed copy
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="row-card">
                  <div>
                    <strong>No active fields yet</strong>
                    <p className="muted">
                      This document is waiting on another participant or stage before your action becomes available.
                    </p>
                  </div>
                </div>
              )}

              {guestCompletedFields.length > 0 ? (
                <div className="stack">
                  <div className="section-heading compact">
                    <p className="eyebrow">Completed</p>
                    <span>{guestCompletedFields.length}</span>
                  </div>
                  {guestCompletedFields.map((field) => (
                    <div key={field.id} className="row-card">
                      <div>
                        <strong>{field.label}</strong>
                        <p className="muted">Completed {formatTimestamp(field.completedAt)}</p>
                      </div>
                      <span>Done</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {(previewUrl || localPreviewUrl) && selectedDocument.workflowState === "completed" && !guestHasFinished ? (
                <a
                  className="ghost-button"
                  href={previewUrl ?? localPreviewUrl ?? undefined}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Open signed document
                </a>
              ) : null}
            </section>
          </div>
        </main>
        {toast ? <div className="toast">{toast}</div> : null}
      </div>
    );
  }

  return (
    <div className="shell">
      <aside ref={sidebarRef} className="sidebar">
        <div className="brand">
          <span className="brand-mark">ED</span>
          <div>
            <h1>EasyDraft</h1>
            <p>Private document workflows, reusable signatures, and clean handoffs.</p>
          </div>
        </div>

        {sessionUser ? (
          <div className="user-identity">
            <span className="user-avatar">{sessionUser.name.charAt(0).toUpperCase()}</span>
            <div className="user-identity-info">
              <p className="user-name">{sessionUser.name}</p>
              <p className="muted user-email">{sessionUser.email}</p>
              <p className="muted user-workspace">
                {currentWorkspaceName}
                {currentWorkspaceRoleLabel ? ` · ${currentWorkspaceRoleLabel}` : ""}
              </p>
              <button className="ghost-button small" onClick={handleSignOut} type="button">Sign out</button>
            </div>
          </div>
        ) : null}

        {sessionUser && availableWorkspaces.length > 0 ? (
          <section className="card workspace-switcher-card">
            <div className="section-heading compact">
              <p className="eyebrow">Active workspace</p>
              <span>
                {activeWorkspace?.organization?.accountType === "corporate"
                  ? "Corporate account"
                  : "Individual account"}
              </span>
            </div>
            <label className="form-field">
              <span>Working in</span>
              <select
                disabled={isWorkspaceSwitching}
                value={activeWorkspaceId ?? ""}
                onChange={(event) => {
                  handleWorkspaceChange(event.target.value).catch(
                    (error) => setErrorMessage((error as Error).message),
                  );
                }}
              >
                {availableWorkspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.organization?.name ?? workspace.name}
                    {workspace.role ? ` (${formatWorkspaceRoleLabel(workspace.role)})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              {activeWorkspace?.organization?.accountType === "corporate"
                ? "Billing, shared tokens, and member management are scoped to this corporate account."
                : "Individual accounts keep billing and document work private to the owner unless they later join a corporate account."}
            </p>
          </section>
        ) : null}

        {sessionUser && canAccessOrgAdmin && billingOverview?.subscription &&
          ["active", "trialing"].includes(billingOverview.subscription.status) ? (
          <div className="billing-gauge">
            <span className="billing-gauge-status">
              {billingOverview.subscription.status === "trialing" && billingOverview.subscription.trialEndsAt
                ? `Trial: ${Math.max(0, Math.ceil((new Date(billingOverview.subscription.trialEndsAt).getTime() - Date.now()) / 86_400_000))}d left`
                : "Active"}
            </span>
            <span aria-hidden="true" className="billing-gauge-dot">·</span>
            <span>{billingOverview.externalTokens.available} token{billingOverview.externalTokens.available !== 1 ? "s" : ""}</span>
            <button className="ghost-button small billing-gauge-link" onClick={() => updatePortalView("org_admin")} type="button">
              Billing →
            </button>
          </div>
        ) : null}

        <AuthPanel
          sessionUser={sessionUser}
          guestSigningSession={guestSigningSession}
          hasPendingInvite={pendingInviteToken !== null}
          onSessionCreated={(nextSession) => {
            refreshSession(nextSession).catch((error) => setErrorMessage((error as Error).message));
          }}
          onRegistered={() => updatePortalView("org_admin")}
        />

        {sessionUser ? (
          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">View</p>
              <span>{portalView === "org_admin" ? "Organization admin" : "My workspace"}</span>
            </div>
            <div className="pill-row portal-switcher">
              <button
                className={`pill-button ${portalView === "workspace" ? "active" : ""}`}
                onClick={() => updatePortalView("workspace")}
                type="button"
              >
                My workspace
              </button>
              {canAccessOrgAdmin ? (
                <button
                  className={`pill-button ${portalView === "org_admin" ? "active" : ""}`}
                  onClick={() => updatePortalView("org_admin")}
                  type="button"
                >
                  Organization admin
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {sessionUser ? (
          <nav className="sidebar-nav">
            <p className="eyebrow sidebar-nav-label">Tools</p>
            {portalView === "workspace" ? (
              <>
                <button className="sidebar-nav-item" onClick={() => scrollSidebarTo("section-documents")} type="button">Documents</button>
                <button className="sidebar-nav-item" onClick={() => scrollSidebarTo("section-signatures")} type="button">Signatures</button>
                {canAccessOrgAdmin ? (
                  <button className="sidebar-nav-item" onClick={() => updatePortalView("org_admin")} type="button">Team</button>
                ) : null}
                {canAccessOrgAdmin ? (
                  <button className="sidebar-nav-item" onClick={() => updatePortalView("org_admin")} type="button">Billing</button>
                ) : null}
                <button className="sidebar-nav-item" onClick={() => scrollSidebarTo("section-account")} type="button">Account</button>
                <a className="sidebar-nav-item" href="/guide.html" rel="noopener noreferrer" target="_blank">Help &amp; guide</a>
              </>
            ) : (
              <>
                <button className="sidebar-nav-item" onClick={() => scrollMainTo("section-team")} type="button">Team</button>
                <button className="sidebar-nav-item" onClick={() => scrollMainTo("section-billing")} type="button">Billing</button>
                {sessionUser.isAdmin ? (
                  <button className="sidebar-nav-item" onClick={() => scrollMainTo("section-admin")} type="button">Admin console</button>
                ) : null}
                <button className="sidebar-nav-item" onClick={() => scrollSidebarTo("section-account")} type="button">Account</button>
                <button className="sidebar-nav-item" onClick={() => scrollSidebarTo("section-signatures")} type="button">Signatures</button>
                <a className="sidebar-nav-item" href="/guide.html" rel="noopener noreferrer" target="_blank">Help &amp; guide</a>
              </>
            )}
          </nav>
        ) : null}

        <ErrorBoundary label="profile and billing">
        {sessionUser && accountProfile ? (
          <section className="card" id="section-account">
            <div className="section-heading compact">
              <p className="eyebrow">Account</p>
              <span>{accountProfile.companyName ?? "Personal"}</span>
            </div>
            <form className="stack form-block account-form" onSubmit={handleSaveProfile}>
              <label className="form-field">
                <span>Display name</span>
                <input
                  required
                  value={profileDisplayName}
                  onChange={(event) => setProfileDisplayName(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Company</span>
                <input
                  value={profileCompanyName}
                  onChange={(event) => setProfileCompanyName(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Job title</span>
                <input
                  value={profileJobTitle}
                  onChange={(event) => setProfileJobTitle(event.target.value)}
                />
              </label>
              <div className="form-grid compact-grid">
                <label className="form-field">
                  <span>Timezone</span>
                  <input
                    value={profileTimezone}
                    onChange={(event) => setProfileTimezone(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Locale</span>
                  <input
                    value={profileLocale}
                    onChange={(event) => setProfileLocale(event.target.value)}
                  />
                </label>
              </div>
              <label className="checkbox-row">
                <input
                  checked={profileProductUpdatesOptIn}
                  onChange={(event) => setProfileProductUpdatesOptIn(event.target.checked)}
                  type="checkbox"
                />
                <span>Product updates</span>
              </label>
              <label className="checkbox-row">
                <input
                  checked={profileMarketingOptIn}
                  onChange={(event) => setProfileMarketingOptIn(event.target.checked)}
                  type="checkbox"
                />
                <span>Marketing emails</span>
              </label>
              <button className="ghost-button" disabled={isLoading} type="submit">
                Save account
              </button>
            </form>
          </section>
        ) : null}

        {sessionUser ? (
          <FeedbackPanel
            session={session}
            sessionUser={sessionUser}
            source="workspace_shell"
            compact
          />
        ) : null}

        {sessionUser && accountProfile ? (
          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">Your data</p>
              <span>Privacy</span>
            </div>
            <div className="stack">
              <p className="muted">
                Your account includes the following data stored on our servers:
              </p>
              <ul className="muted" style={{ paddingLeft: "1.25rem", margin: 0 }}>
                <li>Your profile and preferences</li>
                <li>Uploaded PDF documents and their fields</li>
                <li>Saved signatures</li>
                <li>Workflow audit trail and signer records</li>
                <li>Workspace and team membership data</li>
              </ul>
              <p className="muted">
                You can export or download any document at any time from the document list.
                Deleting your account permanently removes all of the above and cannot be undone.
              </p>
              <div className="action-row action-wrap">
                <a className="ghost-button" href="/privacy">Privacy</a>
                <a className="ghost-button" href="/terms">Terms</a>
                <a className="ghost-button" href="/security">Security</a>
              </div>

              <div className="row-card" style={{ marginTop: "0.5rem" }}>
                <p className="eyebrow" style={{ margin: 0, color: "var(--color-danger, #c0392b)" }}>
                  Danger zone
                </p>
              </div>

              <p className="muted">
                Permanently delete your account and all associated data. Your Stripe subscription
                will be canceled immediately. This action cannot be reversed.
              </p>

              <form className="stack form-block" onSubmit={handleDeleteAccount}>
                <label className="form-field">
                  <span>Type your email address to confirm</span>
                  <input
                    required
                    autoComplete="off"
                    placeholder={accountProfile.email}
                    type="email"
                    value={deleteAccountConfirmEmail}
                    onChange={(event) => setDeleteAccountConfirmEmail(event.target.value)}
                  />
                </label>
                {deleteAccountError ? (
                  <div className="alert">{deleteAccountError}</div>
                ) : null}
                <button
                  className="ghost-button"
                  disabled={isDeletingAccount || deleteAccountConfirmEmail.trim() === ""}
                  style={{ color: "var(--color-danger, #c0392b)" }}
                  type="submit"
                >
                  {isDeletingAccount ? "Deleting account…" : "Delete my account and all data"}
                </button>
              </form>
            </div>
          </section>
        ) : null}

        {sessionUser ? (
          <section className="card" id="section-signatures">
            <div className="section-heading compact">
              <p className="eyebrow">Signature Library</p>
              <span>{savedSignatures.length}</span>
            </div>
            <div className="stack">
              <p className="muted">Re-use your signatures and initials across documents. Save once, select on any document.</p>
              {savedSignatures.length === 0 ? null : (
                savedSignatures.map((signature) => (
                  <button
                    key={signature.id}
                    className={`document-button ${selectedSavedSignatureId === signature.id ? "active" : ""}`}
                    onClick={() => setSelectedSavedSignatureId(signature.id)}
                    type="button"
                  >
                    <span>{signature.label}</span>
                    <small>
                      {signature.signatureType}
                      {signature.titleText ? ` · ${signature.titleText}` : ""}
                    </small>
                  </button>
                ))
              )}

              {selectedSavedSignature ? (
                <div className="row-card">
                  <div>
                    <strong>{selectedSavedSignature.label}</strong>
                    <p className="muted">
                      {selectedSavedSignature.signatureType === "typed"
                        ? selectedSavedSignature.typedText
                        : "Uploaded signature image"}
                    </p>
                    {selectedSavedSignature.titleText ? (
                      <p className="muted">{selectedSavedSignature.titleText}</p>
                    ) : null}
                  </div>
                  {selectedSavedSignature.previewUrl ? (
                    <img
                      alt={`${selectedSavedSignature.label} preview`}
                      src={selectedSavedSignature.previewUrl}
                      style={{
                        maxHeight: "48px",
                        maxWidth: "120px",
                        objectFit: "contain",
                      }}
                    />
                  ) : null}
                </div>
              ) : null}

              <form className="stack form-block" onSubmit={handleCreateSavedSignature}>
                <label className="form-field">
                  <span>Label</span>
                  <input
                    required
                    placeholder="President, Director, Personal"
                    value={savedSignatureLabel}
                    onChange={(event) => setSavedSignatureLabel(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Title text</span>
                  <input
                    placeholder="VP Operations"
                    value={savedSignatureTitle}
                    onChange={(event) => setSavedSignatureTitle(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Signature type</span>
                  <select
                    value={savedSignatureType}
                    onChange={(event) => setSavedSignatureType(event.target.value as "typed" | "uploaded")}
                  >
                    <option value="typed">Typed</option>
                    <option value="uploaded">Uploaded image</option>
                  </select>
                </label>
                {savedSignatureType === "typed" ? (
                  <label className="form-field">
                    <span>Typed signature text</span>
                    <input
                      required
                      placeholder="Adam Goodwin"
                      value={savedSignatureTypedText}
                      onChange={(event) => setSavedSignatureTypedText(event.target.value)}
                    />
                  </label>
                ) : (
                  <label className="form-field">
                    <span>Signature image</span>
                    <input
                      id="saved-signature-upload"
                      accept="image/png,image/jpeg,image/webp"
                      required
                      type="file"
                    />
                  </label>
                )}
                <button className="ghost-button" disabled={isLoading} type="submit">
                  Save signature
                </button>
              </form>
            </div>
          </section>
        ) : null}

        {sessionUser && isCertificateSigningEnabled ? (
          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">Digital Signing</p>
              <span>{digitalSignatureProfiles.length}</span>
            </div>
            <div className="stack">
              <p className="muted">
                Reusable e-signatures are live today. Certificate-backed digital signatures are
                modeled here as provider-managed profiles and require verification before they can
                be used to sign PDF bytes securely.
              </p>
              {digitalSignatureProfiles.map((profile) => (
                <div key={profile.id} className="row-card">
                  <div>
                    <strong>{profile.label}</strong>
                    <p className="muted">
                      Digitally signed by {profile.signerName}
                    </p>
                    <p className="muted">
                      {profile.titleText ? `${profile.titleText} · ` : ""}
                      {profile.organizationName ? `${profile.organizationName} · ` : ""}
                      {profile.signerEmail ?? "Email not set"}
                    </p>
                    <p className="muted">
                      {profile.provider} · {profile.assuranceLevel}
                    </p>
                  </div>
                  <span>{profile.status}</span>
                </div>
              ))}
              <form className="stack form-block" onSubmit={handleCreateDigitalSignatureProfile}>
                <label className="form-field">
                  <span>Profile label</span>
                  <input
                    required
                    placeholder="Corporate signing cert"
                    value={digitalSignatureLabel}
                    onChange={(event) => setDigitalSignatureLabel(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Signer full name</span>
                  <input
                    required
                    placeholder="Adam Goodwin"
                    value={digitalSignatureSignerName}
                    onChange={(event) => setDigitalSignatureSignerName(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Signer email</span>
                  <input
                    type="email"
                    placeholder="admin@agoperations.ca"
                    value={digitalSignatureSignerEmail}
                    onChange={(event) => setDigitalSignatureSignerEmail(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Title text</span>
                  <input
                    placeholder="VP Operations"
                    value={digitalSignatureTitle}
                    onChange={(event) => setDigitalSignatureTitle(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Organization</span>
                  <input
                    placeholder="AG Operations"
                    value={digitalSignatureOrganizationName}
                    onChange={(event) => setDigitalSignatureOrganizationName(event.target.value)}
                  />
                </label>
                <div className="form-grid compact-grid">
                  <label className="form-field">
                    <span>Provider</span>
                    <select
                      value={digitalSignatureProvider}
                      onChange={(event) =>
                        setDigitalSignatureProvider(
                          event.target.value as
                            | "easy_draft_remote"
                            | "qualified_remote"
                            | "organization_hsm",
                        )
                      }
                    >
                      <option value="easy_draft_remote">EasyDraft remote</option>
                      <option value="qualified_remote">Qualified remote</option>
                      <option value="organization_hsm">Organization HSM</option>
                    </select>
                  </label>
                  <label className="form-field">
                    <span>Assurance</span>
                    <select
                      value={digitalSignatureAssuranceLevel}
                      onChange={(event) => setDigitalSignatureAssuranceLevel(event.target.value)}
                    >
                      <option value="advanced">Advanced</option>
                      <option value="qualified">Qualified</option>
                    </select>
                  </label>
                </div>
                <div className="row-card">
                  <div>
                    <strong>Preview appearance</strong>
                    <p className="muted">
                      Digitally signed by {digitalSignatureSignerName || "Signer name"}
                    </p>
                    <p className="muted">
                      {digitalSignatureTitle || "Title"} · {digitalSignatureOrganizationName || "Organization"}
                    </p>
                    <p className="muted">
                      Reason will be selected at signing time. Date will be stamped at signing time.
                    </p>
                  </div>
                </div>
                <button className="ghost-button" disabled={isLoading} type="submit">
                  Request digital signing profile
                </button>
              </form>
            </div>
          </section>
        ) : null}

        {/* Onboarding prompt — shown once to new users */}
        {portalView === "workspace" && sessionUser && session && showOnboarding && workspaceTeam && workspaceMembershipRole === "owner" ? (
          <OnboardingPrompt
            session={session}
            workspaceTeam={workspaceTeam}
            userName={sessionUser.name}
            onComplete={() => {
              apiFetch("/onboarding-complete", session, { method: "PATCH" })
                .then(() => refreshProfile(session))
                .catch(() => null);
              refreshTeam(session).catch(() => null);
            }}
          />
        ) : null}

        {portalView === "workspace" ? (
        <section className="card" id="section-documents">
          <div className="section-heading compact">
            <p className="eyebrow">Documents</p>
            <span>{documents.length}</span>
          </div>
          <div className="stack">
            {isWorkspaceHydrating ? (
              <div className="stack skeleton-stack">
                <div className="skeleton-line skeleton-line-title" />
                <div className="skeleton-card" />
                <div className="skeleton-card" />
                <div className="skeleton-card" />
              </div>
            ) : documents.length === 0 && sessionUser && !showOnboarding ? (
              <div className="empty-state">
                <p className="empty-state-heading">Start with a document</p>
                <p className="muted">Upload a PDF to prepare a workflow, assign signers, and send for signatures.</p>
                <button
                  className="primary-button upload-cta"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  Upload PDF
                </button>
              </div>
            ) : documents.length === 0 ? (
              <div className="stack">
                <p className="muted">Sign in and upload a PDF to start a workflow.</p>
              </div>
            ) : (
              documents.map((document) => (
                <div key={document.id} className="document-button-row">
                  {renamingDocumentId === document.id ? (
                    <form
                      className="rename-form"
                      onSubmit={handleRenameDocument}
                    >
                      <input
                        autoFocus
                        className="rename-input"
                        type="text"
                        value={renameDocName}
                        onChange={(e) => setRenameDocName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setRenamingDocumentId(null);
                            setRenameDocName("");
                          }
                        }}
                        disabled={isLoading}
                      />
                      <button className="secondary-button" type="submit" disabled={isLoading || !renameDocName.trim()}>
                        Save
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={isLoading}
                        onClick={() => { setRenamingDocumentId(null); setRenameDocName(""); }}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      className={`document-button ${document.id === selectedDocument?.id ? "active" : ""}`}
                      onClick={() => setSelectedDocumentId(document.id)}
                    >
                      <span>{document.name}</span>
                      <small>
                        {formatState(document.workflowState)} · {formatRoleLabel(document)}
                        {document.isOverdue ? <span className="badge badge-overdue">Overdue</span> : null}
                        {!document.isOverdue && document.operationalStatus === "changes_requested" ? <span className="badge badge-action">Action needed</span> : null}
                      </small>
                    </button>
                  )}
                  {renamingDocumentId !== document.id ? (
                    <button
                      className="rename-trigger"
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingDocumentId(document.id);
                        setRenameDocName(document.name);
                      }}
                    >
                      ✎
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
        ) : null}
        </ErrorBoundary>
      </aside>

      <main className="main">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">
              {portalView === "org_admin" ? "Organization admin" : "Document workspace"}
            </p>
            <h2>
              {portalView === "org_admin"
                ? "Organization control center"
                : sessionUser
                  ? currentWorkspaceName
                  : "Complete your assigned fields"}
            </h2>
            {portalView === "org_admin" ? (
              <p className="muted">
                Monitor business health, billing posture, team access, and workflows that need action today.
              </p>
            ) : (
              <p className="muted">
                Working in <strong>{currentWorkspaceName}</strong>
                {currentWorkspaceRoleLabel ? ` as ${currentWorkspaceRoleLabel}.` : "."}
              </p>
            )}
          </div>
          <a className="hero-guide-link" href="/guide.html" target="_blank" rel="noopener noreferrer">
            Help &amp; guide →
          </a>
        </header>

        {errorMessage ? <div className="alert">{errorMessage}</div> : null}
        {noticeMessage ? <div className="alert success">{noticeMessage}</div> : null}
        {isWorkspaceSwitching ? <div className="alert success">Switching workspace and refreshing team, billing, and documents…</div> : null}
        {joinedWorkspaceBanner ? (
          <div className="team-summary-bar joined-banner">
            <span className="muted">You&apos;re now part of {joinedWorkspaceBanner}.</span>
            <button className="ghost-button small" onClick={() => setJoinedWorkspaceBanner(null)} type="button">
              Dismiss
            </button>
          </div>
        ) : null}

        {portalView === "workspace" && sessionUser && !isWorkspaceHydrating ? (
          <div className="quick-actions">
            <p className="eyebrow">Quick actions</p>
            <div className="quick-actions-grid">
              <button className="quick-action-item" onClick={() => fileInputRef.current?.click()} type="button">
                <strong className="quick-action-label">Upload PDF</strong>
                <span className="muted">Start a new workflow</span>
              </button>
              {documents.length > 0 ? (
                <button className="quick-action-item" onClick={() => setSelectedDocumentId(documents[0].id)} type="button">
                  <strong className="quick-action-label">Resume last</strong>
                  <span className="muted">{documents[0].name}</span>
                </button>
              ) : null}
              <button className="quick-action-item" onClick={() => scrollSidebarTo("section-signatures")} type="button">
                <strong className="quick-action-label">Create signature</strong>
                <span className="muted">Save for reuse across documents</span>
              </button>
              {canAccessOrgAdmin ? (
                <button className="quick-action-item" onClick={() => updatePortalView("org_admin")} type="button">
                  <strong className="quick-action-label">Team &amp; billing</strong>
                  <span className="muted">Invite teammates, manage plan</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {portalView === "workspace" && sessionUser && workspaceTeam && documents.length === 0 && !isWorkspaceHydrating ? (
          <section className="card activation-card">
            <div className="section-heading compact">
              <p className="eyebrow">Do this next</p>
              <span>{workspaceTeam.members.length === 1 ? "First workflow" : "Team rollout"}</span>
            </div>
            {workspaceTeam.members.length === 1 ? (
              <div className="stack">
                <p className="muted">
                  You&apos;re the owner of <strong>{currentWorkspaceName}</strong>. Start with one complete solo workflow so you can see the full send, sign, and export path.
                </p>
                <div className="checklist-grid">
                  <div className="checklist-step checklist-step-active">
                    <div className="checklist-step-index">1</div>
                    <div className="checklist-step-copy">
                      <strong>Upload a PDF</strong>
                      <p className="muted">Create your first workflow document in the secure vault.</p>
                    </div>
                  </div>
                  <div className="checklist-step checklist-step-pending">
                    <div className="checklist-step-index">2</div>
                    <div className="checklist-step-copy">
                      <strong>Add yourself as signer</strong>
                      <p className="muted">Test the complete internal flow before inviting others.</p>
                    </div>
                  </div>
                  <div className="checklist-step checklist-step-pending">
                    <div className="checklist-step-index">3</div>
                    <div className="checklist-step-copy">
                      <strong>Send, sign, and download</strong>
                      <p className="muted">Confirm the audit trail and exported document feel sales-ready.</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="stack">
                <p className="muted">
                  Your workspace is ready for team use. Invite collaborators, upload your first document, and review the guide so everyone starts from the same operating model.
                </p>
                <div className="action-row action-wrap">
                  <button className="secondary-button" onClick={() => updatePortalView("org_admin")} type="button">
                    Open organization admin
                  </button>
                  <a className="ghost-button" href="/guide.html" rel="noopener noreferrer" target="_blank">
                    Review quick guide
                  </a>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {portalView === "org_admin" && sessionUser && session ? (
          <ErrorBoundary label="Organization admin">
            {isWorkspaceHydrating ? (
              <section className="owner-portal">
                <div className="panel owner-hero-panel skeleton-stack">
                  <div className="skeleton-line skeleton-line-title" />
                  <div className="skeleton-line" />
                  <div className="owner-kpi-grid">
                    <div className="skeleton-card" />
                    <div className="skeleton-card" />
                    <div className="skeleton-card" />
                    <div className="skeleton-card" />
                  </div>
                </div>
              </section>
            ) : (
              <OwnerPortal
                session={session}
                sessionUser={sessionUser}
                documents={documents}
                workspaceTeam={workspaceTeam}
                billingOverview={billingOverview}
                adminOverview={adminOverview}
                adminUsers={adminUsers}
                adminFeedbackRequests={adminFeedbackRequests}
                onRefreshTeam={() => refreshTeam(session)}
                onRefreshBilling={() => refreshBilling(session)}
                onRefreshAdmin={() => {
                  const requests = sessionUser.isAdmin
                    ? [refreshAdminOverview(session), refreshAdminUsers(session), refreshAdminFeedback(session)]
                    : [];
                  return Promise.all(requests).then(() => undefined);
                }}
                onSwitchToWorkspace={() => updatePortalView("workspace")}
                onNavigateToDocument={(documentId) => {
                  setSelectedDocumentId(documentId);
                  updatePortalView("workspace");
                }}
              />
            )}
          </ErrorBoundary>
        ) : null}

        {portalView === "workspace" ? (
        <ErrorBoundary label="document workspace">
        {canAccessOrgAdmin && workspaceTeam ? (
          <div className="team-summary-bar">
            <span className="muted">
              {workspaceTeam.workspace.name} · {workspaceTeam.members.length} member{workspaceTeam.members.length !== 1 ? "s" : ""}
            </span>
            <button className="ghost-button small" onClick={() => updatePortalView("org_admin")} type="button">
              Manage team →
            </button>
          </div>
        ) : null}
        {isWorkspaceHydrating ? (
          <section className="grid">
            <div className="panel skeleton-stack">
              <div className="skeleton-line skeleton-line-title" />
              <div className="skeleton-line" />
              <div className="preview-frame signer-preview-frame skeleton-card" />
            </div>
            <div className="panel skeleton-stack">
              <div className="skeleton-line skeleton-line-title" />
              <div className="skeleton-card" />
              <div className="skeleton-card" />
              <div className="skeleton-card" />
            </div>
          </section>
        ) : (
        <section className="grid">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Upload and preview</p>
                <h3>Private storage upload with signed preview URLs</h3>
              </div>
              <button
                className="primary-button"
                disabled={!sessionUser || isLoading}
                onClick={() => fileInputRef.current?.click()}
              >
                Choose PDF
              </button>
            </div>

            <div className="form-grid compact-grid">
              <label className="form-field">
                <span>Routing</span>
                <select
                  value={uploadRouting}
                  onChange={(event) =>
                    setUploadRouting(event.target.value as "sequential" | "parallel")
                  }
                >
                  <option value="sequential">Sequential</option>
                  <option value="parallel">Parallel</option>
                </select>
              </label>
              <label className="checkbox-row">
                <input
                  checked={isScannedUpload}
                  onChange={(event) => setIsScannedUpload(event.target.checked)}
                  type="checkbox"
                />
                <span>Scanned PDF</span>
              </label>
            </div>

            <div className="form-grid">
              <label className="form-field">
                <span>Workflow path</span>
                <select
                  value={deliveryMode}
                  onChange={(event) =>
                    setDeliveryMode(
                      event.target.value as "self_managed" | "internal_use_only" | "platform_managed",
                    )
                  }
                >
                  <option value="self_managed">Store, edit, then distribute it myself</option>
                  <option value="internal_use_only">Store, edit, and collect internal signatures or approvals in EasyDraft</option>
                  <option value="platform_managed">Store, edit, and let EasyDraft route signatures and approvals</option>
                </select>
              </label>
              <label className="form-field">
                <span>Lock policy</span>
                <select
                  value={lockPolicy}
                  onChange={(event) =>
                    setLockPolicy(
                      event.target.value as
                        | "owner_only"
                        | "owner_and_editors"
                        | "owner_editors_and_active_signer",
                    )
                  }
                >
                  <option value="owner_only">Only the owner can lock</option>
                  <option value="owner_and_editors">Owner and editors can lock</option>
                  <option value="owner_editors_and_active_signer">
                    Owner, editors, and the active signer can lock
                  </option>
                </select>
              </label>
              <label className="form-field">
                <span>Workflow due date</span>
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </label>
              {deliveryMode === "self_managed" ? (
                <label className="form-field">
                  <span>Shared storage or distribution target</span>
                  <input
                    placeholder="Dropbox, SharePoint, network folder, email, etc."
                    value={distributionTarget}
                    onChange={(event) => setDistributionTarget(event.target.value)}
                  />
                </label>
              ) : deliveryMode === "platform_managed" ? (
                <label className="checkbox-row">
                  <input
                    checked={notifyOriginatorOnEachSignature}
                    onChange={(event) => setNotifyOriginatorOnEachSignature(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Notify the originator after each signature or approval is completed</span>
                </label>
              ) : (
                <div className="row-card">
                  <strong>Internal use only</strong>
                  <p className="muted">
                    Participants complete assigned fields inside EasyDraft after signing in. This path is
                    intended for internal documents and is not third-party certified.
                  </p>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              accept="application/pdf"
              className="visually-hidden"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (!file) {
                  return;
                }

                handleUpload(file).catch((error) => setErrorMessage((error as Error).message));
                event.target.value = "";
              }}
            />

            <div className="preview-frame">
              {previewUrl || localPreviewUrl ? (
                <object data={previewUrl ?? localPreviewUrl ?? undefined} type="application/pdf">
                  <p>Preview unavailable for this browser.</p>
                </object>
              ) : (
                <div className="preview-empty">
                  <strong>Upload a PDF to create the first workflow document.</strong>
                  <p>The file is stored privately in Supabase Storage and previewed through a signed URL.</p>
                </div>
              )}
            </div>

            <p className="muted">{uploadName ? `Last selected file: ${uploadName}` : "No upload yet."}</p>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Selected workflow</p>
                <h3>{selectedDocument?.name ?? "No document selected"}</h3>
              </div>
              {selectedDocument ? (
                <span className={`status-badge ${selectedDocument.signable ? "open" : "closed"}`}>
                  {selectedDocument.signable ? "Signable" : "Closed to signing"}
                </span>
              ) : null}
            </div>

            {selectedDocument ? (
              <>
                <div className="meta-grid">
                  <div className="meta-item">
                    <span>State</span>
                    <strong>{formatState(selectedDocument.workflowState)}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Workflow status</span>
                    <strong>{getOperationalStatusLabel(selectedDocument.operationalStatus)}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Path</span>
                    <strong>{getDeliveryModeLabel(selectedDocument.deliveryMode)}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Routing</span>
                    <strong>{selectedDocument.routingStrategy}</strong>
                  </div>
                  <div className="meta-item">
                    <span>OCR</span>
                    <strong>{selectedDocument.isOcrComplete ? "Ready" : "Queued or pending"}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Field detection</span>
                    <strong>
                      {selectedDocument.isFieldDetectionComplete ? "Ready" : "Queued or pending"}
                    </strong>
                  </div>
                  <div className="meta-item">
                    <span>Signature security</span>
                    <strong>
                      {selectedDocument.deliveryMode === "internal_use_only"
                        ? "Internal-use-only approval trail"
                        : isCertificateSigningEnabled &&
                          digitalSignatureProfiles.some((profile) => profile.status === "verified")
                        ? "Verified digital profile available"
                        : "SHA-256 export integrity"}
                    </strong>
                  </div>
                  <div className="meta-item">
                    <span>Lock policy</span>
                    <strong>{getLockPolicyLabel(selectedDocument.lockPolicy)}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Waiting on</span>
                    <strong>{selectedDocument.waitingOn.signerName ?? formatState(selectedDocument.waitingOn.kind)}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Due date</span>
                    <strong>{formatTimestamp(selectedDocument.dueAt)}</strong>
                  </div>
                </div>

                <div className="completion-card">
                  <p className="eyebrow">Completion logic</p>
                  <h4>
                    {selectedDocument.completionSummary.completedRequiredAssignedFields}/
                    {selectedDocument.completionSummary.requiredAssignedFields} required assigned action
                    fields complete
                  </h4>
                  <p className="muted">
                    The document remains signable until every required assigned action field is complete
                    or someone explicitly locks it.
                  </p>
                  <p className="muted">
                    {getDeliveryModeCompletionCopy(selectedDocument)}
                  </p>
                  <p className="muted">
                    {selectedDocument.waitingOn.summary}
                  </p>
                  {sendReadiness ? (
                    <div className="stack">
                      <p className="muted">
                        {sendReadiness.ready
                          ? selectedDocument.deliveryMode === "platform_managed"
                            ? "Ready to send. The current routing and required action fields are set."
                            : selectedDocument.deliveryMode === "internal_use_only"
                              ? "Ready to open for internal actions in EasyDraft."
                            : "Ready to mark for self-managed distribution."
                          : selectedDocument.deliveryMode === "platform_managed"
                            ? "Before sending for signatures or approvals:"
                            : selectedDocument.deliveryMode === "internal_use_only"
                              ? "Before opening this for internal actions:"
                            : "Before marking this ready to distribute:"}
                      </p>
                      {!sendReadiness.ready
                        ? sendReadiness.blockers.map((blocker) => (
                            <div key={blocker} className="row-card">
                              <p className="muted">{blocker}</p>
                            </div>
                          ))
                        : null}
                    </div>
                  ) : null}
                </div>

                <div className="toolbar-card">
                  <div className="section-heading compact">
                    <p className="eyebrow">Setup checklist</p>
                    <span>
                      {checklistSteps.filter((step) => step.done).length}/{checklistSteps.length} complete
                    </span>
                  </div>
                  <p className="muted action-note">{nextActionMessage}</p>
                  <div className="checklist-grid">
                    {checklistSteps.map((step, index) => {
                      const stepState = step.done
                        ? "done"
                        : activeChecklistIndex === index
                          ? "active"
                          : "pending";

                      return (
                        <div
                          key={step.label}
                          className={`checklist-step checklist-step-${stepState}`}
                        >
                          <div className="checklist-step-index">{index + 1}</div>
                          <div className="checklist-step-copy">
                            <strong>{step.label}</strong>
                            <p className="muted">{step.detail}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="toolbar-card">
                  <div className="section-heading compact">
                    <p className="eyebrow">Document actions</p>
                    <span>
                      Undo {selectedDocument.editorHistory.currentIndex}/{selectedDocument.editorHistory.latestIndex}
                    </span>
                  </div>
                  <div className="action-row action-wrap">
                    <button className="secondary-button" disabled={isLoading} onClick={handleDownloadDocument}>
                      Download
                    </button>
                    {selectedDocument.workflowState === "completed" ? (
                      <button className="secondary-button" onClick={handleDownloadCertificate} type="button">
                        Certificate
                      </button>
                    ) : null}
                    <button className="secondary-button" disabled={isLoading} onClick={handleDuplicateDocument}>
                      Save as copy
                    </button>
                    <button className="secondary-button" disabled={isLoading} onClick={handleShareDocument}>
                      Share
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isLoading}
                      onClick={() =>
                        handleUpdateDocumentRetention(
                          selectedDocument.retentionMode === "temporary" ? "retained" : "temporary",
                        )
                      }
                      type="button"
                    >
                      {selectedDocument.retentionMode === "temporary" ? "Keep stored" : "Make temporary"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isLoading || !sendReadiness?.ready}
                      onClick={() => runDocumentAction("/document-send", { documentId: selectedDocument.id })}
                    >
                      {sendActionLabel}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isLoading}
                      onClick={() => runDocumentAction("/document-clear", { documentId: selectedDocument.id })}
                    >
                      Clear all
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isLoading || !selectedDocument.editorHistory.canUndo}
                      onClick={() => runDocumentAction("/document-undo", { documentId: selectedDocument.id })}
                    >
                      Undo
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isLoading || !selectedDocument.editorHistory.canRedo}
                      onClick={() => runDocumentAction("/document-redo", { documentId: selectedDocument.id })}
                    >
                      Redo
                    </button>
                    <button className="secondary-button danger-button" disabled={isLoading} onClick={handleDeleteDocument}>
                      Delete
                    </button>
                  </div>
                  <p className="muted action-note">
                    {!sendReadiness?.ready
                      ? sendReadiness?.blockers[0]
                      : selectedDocument.deliveryMode === "platform_managed"
                        ? "Sending keeps the current field map and routing, then notifies the next eligible participant."
                        : selectedDocument.deliveryMode === "internal_use_only"
                          ? "Opening this for internal actions keeps the document inside EasyDraft. Participants can complete their assigned fields after they log in."
                        : "Marking this ready does not send emails. It simply records that the file is ready for self-managed distribution."}
                  </p>
                  <p className="muted action-note">
                    {selectedDocument.retentionMode === "retained"
                      ? "Storage is retained until someone deletes this document from EasyDraft."
                      : selectedDocument.purgeScheduledAt
                        ? `Temporary storage is enabled. EasyDraft is scheduled to purge stored files on ${formatTimestamp(selectedDocument.purgeScheduledAt)} unless you keep them stored.`
                        : "Temporary storage is enabled. EasyDraft keeps active workflows stored only while they are needed, then schedules purge automatically when the workflow becomes eligible."}
                  </p>
                  {selectedDocument.deliveryMode === "platform_managed" &&
                  selectedDocument.signers.some((s) => s.participantType === "external") ? (
                    <p className="muted action-note">
                      {(() => {
                        const externalCount = selectedDocument.signers.filter(
                          (s) => s.participantType === "external",
                        ).length;
                        const available = billingOverview?.externalTokens.available ?? 0;
                        return `This document has ${externalCount} external signer${externalCount !== 1 ? "s" : ""}. Sending will use ${externalCount} external signer token${externalCount !== 1 ? "s" : ""} (${available} available). Internal team approvals do not consume tokens.`;
                      })()}
                    </p>
                  ) : null}
                </div>

                {canManageWorkflow ? (
                  <div className="toolbar-card">
                    <div className="section-heading compact">
                      <p className="eyebrow">Workflow controls</p>
                      <span>{selectedDocument.isOverdue ? "Overdue" : "On track"}</span>
                    </div>
                    <form className="stack" onSubmit={handleUpdateWorkflowDueDate}>
                      <label className="form-field">
                        <span>Due date</span>
                        <input
                          type="datetime-local"
                          value={dueAt}
                          onChange={(event) => setDueAt(event.target.value)}
                        />
                      </label>
                      <div className="action-row action-wrap">
                        <button className="secondary-button" disabled={isLoading} type="submit">
                          Save due date
                        </button>
                        <button
                          className="secondary-button danger-button"
                          disabled={isLoading}
                          onClick={handleCancelWorkflow}
                          type="button"
                        >
                          Cancel workflow
                        </button>
                        {selectedDocument.deliveryMode === "platform_managed" &&
                          selectedDocument.sentAt &&
                          selectedDocument.operationalStatus !== "canceled" &&
                          selectedDocument.operationalStatus !== "rejected" &&
                          selectedDocument.workflowState !== "completed" ? (
                          <button
                            className="secondary-button"
                            disabled={isLoading}
                            onClick={() => runDocumentAction("/document-remind", { documentId: selectedDocument.id })}
                            type="button"
                          >
                            Remind signers
                          </button>
                        ) : null}
                      </div>
                    </form>
                    <p className="muted action-note">
                      Use the due date to make overdue work obvious. Cancel keeps the audit trail but closes the current run.
                      {selectedDocument.deliveryMode === "platform_managed" && selectedDocument.sentAt && selectedDocument.workflowState !== "completed"
                        ? " Remind re-sends the pending signature request to the next eligible signer."
                        : null}
                    </p>
                  </div>
                ) : null}

                {(currentUserIsActiveWorkflowSigner || canManageWorkflow) ? (
                  <div className="toolbar-card">
                    <div className="section-heading compact">
                      <p className="eyebrow">Workflow note</p>
                      <span>{selectedDocument.waitingOn.summary}</span>
                    </div>
                    <label className="form-field">
                      <span>Comment or reason</span>
                      <textarea
                        rows={3}
                        value={workflowNote}
                        onChange={(event) => setWorkflowNote(event.target.value)}
                      />
                    </label>
                    {currentUserIsActiveWorkflowSigner ? (
                      <div className="action-row action-wrap">
                        <button
                          className="secondary-button"
                          disabled={isLoading || !workflowNote.trim()}
                          onClick={() =>
                            handleSignerWorkflowResponse("/document-request-changes").catch((error) =>
                              setErrorMessage((error as Error).message),
                            )
                          }
                        >
                          Request changes
                        </button>
                        <button
                          className="secondary-button danger-button"
                          disabled={isLoading || !workflowNote.trim()}
                          onClick={() => {
                            if (!window.confirm("Reject this workflow? This cannot be undone.")) return;
                            handleSignerWorkflowResponse("/document-reject").catch((error) =>
                              setErrorMessage((error as Error).message),
                            );
                          }}
                        >
                          Reject workflow
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                    {canEdit && selectedDocument.deliveryMode !== "self_managed" ? (
                      <div className="toolbar-card">
                        <div className="section-heading compact">
                          <p className="eyebrow">{quickRouteLabels?.heading ?? "Next step"}</p>
                          <span>{selectedDocument.routingStrategy}</span>
                        </div>
                    <div className="form-grid compact-grid">
                      <label className="form-field">
                        <span>Next participant name</span>
                        <input
                          value={nextSignerName}
                          onChange={(event) => setNextSignerName(event.target.value)}
                        />
                      </label>
                      <label className="form-field">
                        <span>Next participant email</span>
                        <input
                          type="email"
                          value={nextSignerEmail}
                          onChange={(event) => setNextSignerEmail(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="action-row action-wrap">
                      <button
                        className="secondary-button"
                        disabled={isLoading || !nextSignerName.trim() || !nextSignerEmail.trim()}
                        onClick={() => handleQuickRoute("sequential").catch((error) => setErrorMessage((error as Error).message))}
                      >
                        {quickRouteLabels?.primary ?? "Queue next participant"}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={isLoading || !nextSignerName.trim() || !nextSignerEmail.trim()}
                        onClick={() => handleQuickRoute("parallel").catch((error) => setErrorMessage((error as Error).message))}
                      >
                        {quickRouteLabels?.secondary ?? "Add parallel participant"}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="action-row action-wrap">
                  {canEdit ? (
                    <>
                      <button
                        className="secondary-button"
                        disabled={isLoading}
                        onClick={() =>
                          runDocumentAction("/document-processing", {
                            documentId: selectedDocument.id,
                            jobType: "ocr",
                          })
                        }
                      >
                        Queue OCR
                      </button>
                      <button
                        className="secondary-button"
                        disabled={isLoading}
                        onClick={() =>
                          runDocumentAction("/document-processing", {
                            documentId: selectedDocument.id,
                            jobType: "field_detection",
                          })
                        }
                      >
                        Detect fields
                      </button>
                    </>
                  ) : null}
                  <button
                    className="secondary-button"
                    disabled={isLoading || !canLockDocument}
                    onClick={() => runDocumentAction("/document-lock", { documentId: selectedDocument.id })}
                  >
                    {selectedDocument.lockedAt ? "Document locked" : "Lock document"}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={isLoading || !canReopenDocument}
                    onClick={() =>
                      runDocumentAction("/document-reopen", { documentId: selectedDocument.id })
                    }
                  >
                    Reopen document
                  </button>
                </div>
                <p className="muted action-note">
                  {selectedDocument.lockedAt
                    ? "Locked documents stay closed to workflow actions until they are explicitly reopened."
                    : canReopenDocument
                      ? "Reopen is available after send, partial completion, lock, or completion so changes stay explicit and auditable."
                      : "Lock is available once the document has moved beyond draft. Reopen appears when there is a sent, locked, or completed workflow to resume."}
                </p>

                <section className="subpanel split">
                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Participants</p>
                      <span>{selectedDocument.signers.length}</span>
                    </div>
                    <div className="stack">
                      {selectedDocument.signers.map((signer) => {
                        const signerStatus = getSignerFieldStatus(
                          signer,
                          selectedDocument.fields,
                          selectedDocument.sentAt,
                          selectedDocument.eligibleSignerIds,
                        );
                        const lastNotification = selectedDocument.notifications
                          .filter((n) => n.recipientSignerId === signer.id)
                          .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))[0] ?? null;
                        const canResend =
                          selectedDocument.deliveryMode === "platform_managed" &&
                          selectedDocument.sentAt &&
                          selectedDocument.workflowState !== "completed" &&
                          selectedDocument.operationalStatus !== "canceled" &&
                          selectedDocument.operationalStatus !== "rejected" &&
                          selectedDocument.eligibleSignerIds.includes(signer.id);
                        return (
                          <div key={signer.id} className="row-card">
                            <div>
                              <strong>{signer.name}</strong>
                              <p className="muted">
                                {signer.email}
                                {` · ${getParticipantTypeLabel(signer.participantType)}`}
                                {` · stage ${signer.routingStage}`}
                                {signer.signingOrder ? ` · order ${signer.signingOrder}` : " · any order"}
                              </p>
                              {signerStatus.completedAt ? (
                                <p className="muted">Signed {formatTimestamp(signerStatus.completedAt)}</p>
                              ) : null}
                              {lastNotification ? (
                                <p className="muted">
                                  Last emailed {formatTimestamp(lastNotification.queuedAt)}
                                  {" · "}
                                  <span className={lastNotification.status === "failed" ? "text-danger" : undefined}>
                                    {lastNotification.status}
                                  </span>
                                </p>
                              ) : selectedDocument.deliveryMode === "platform_managed" && selectedDocument.sentAt ? (
                                <p className="muted">No email on record</p>
                              ) : null}
                            </div>
                            <div className="field-actions">
                              <span
                                className={
                                  signerStatus.label === "Signed"
                                    ? "status-signed"
                                    : signerStatus.active
                                    ? "status-active"
                                    : undefined
                                }
                              >
                                {signerStatus.label}
                              </span>
                              {canResend ? (
                                <button
                                  className="ghost-button"
                                  disabled={isLoading}
                                  onClick={() =>
                                    runDocumentAction("/document-remind", {
                                      documentId: selectedDocument.id,
                                      signerIds: [signer.id],
                                    })
                                  }
                                  type="button"
                                >
                                  Resend
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {canEdit ? (
                      <form className="stack form-block" onSubmit={handleAddSigner}>
                        <label className="form-field">
                          <span>Name</span>
                          <input
                            required
                            value={signerName}
                            onChange={(event) => setSignerName(event.target.value)}
                          />
                        </label>
                        <label className="form-field">
                          <span>Email</span>
                          <input
                            required
                            type="email"
                            value={signerEmail}
                            onChange={(event) => setSignerEmail(event.target.value)}
                          />
                        </label>
                        <div className="form-grid compact-grid">
                          <label className="form-field">
                            <span>Participant type</span>
                            <select
                              value={signerParticipantType}
                              onChange={(event) =>
                                setSignerParticipantType(event.target.value as "internal" | "external")
                              }
                            >
                              <option value="internal">Internal</option>
                              <option value="external">External</option>
                            </select>
                          </label>
                          <label className="form-field">
                            <span>Stage</span>
                            <input
                              value={signerStage}
                              onChange={(event) => setSignerStage(event.target.value)}
                            />
                          </label>
                        </div>
                        <label className="checkbox-row">
                          <input
                            checked={signerRequired}
                            onChange={(event) => setSignerRequired(event.target.checked)}
                            type="checkbox"
                          />
                          <span>Required participant</span>
                        </label>
                        <label className="form-field">
                          <span>Action order</span>
                          <input
                            value={signerOrder}
                            onChange={(event) => setSignerOrder(event.target.value)}
                          />
                        </label>
                        <button className="ghost-button" disabled={isLoading} type="submit">
                          Add participant
                        </button>
                      </form>
                    ) : null}

                    {canManageWorkflow && selectedDocument.signers.length > 0 ? (
                      <form className="stack form-block" onSubmit={handleReassignSigner}>
                        <p className="muted">
                          Reassign the selected participant slot when someone is unavailable or was chosen incorrectly.
                        </p>
                        <label className="form-field">
                          <span>Participant slot</span>
                          <select
                            value={reassignSignerId}
                            onChange={(event) => setReassignSignerId(event.target.value)}
                          >
                            {selectedDocument.signers.map((signer) => (
                              <option key={signer.id} value={signer.id}>
                                {signer.name} · {signer.email}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-field">
                          <span>New participant name</span>
                          <input
                            required
                            value={reassignSignerName}
                            onChange={(event) => setReassignSignerName(event.target.value)}
                          />
                        </label>
                        <label className="form-field">
                          <span>New participant email</span>
                          <input
                            required
                            type="email"
                            value={reassignSignerEmail}
                            onChange={(event) => setReassignSignerEmail(event.target.value)}
                          />
                        </label>
                        <button
                          className="ghost-button"
                          disabled={isLoading || !reassignSignerId || !reassignSignerName.trim() || !reassignSignerEmail.trim()}
                          type="submit"
                        >
                          Reassign participant
                        </button>
                      </form>
                    ) : null}
                  </div>

                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Fields</p>
                      <span>{selectedDocument.fields.length}</span>
                    </div>
                    <div className="stack">
                      {currentUserIsActiveWorkflowSigner ? (
                        <div className="row-card">
                          <label className="form-field" style={{ flex: 1, margin: 0 }}>
                            <span>Reason for signing</span>
                            <select
                              value={activeSigningReason}
                              onChange={(event) => setActiveSigningReason(event.target.value)}
                            >
                              <option value="author">Author</option>
                              <option value="approve">Approve</option>
                              <option value="verify">Verify</option>
                              <option value="review">Review</option>
                              <option value="acknowledge">Acknowledge</option>
                              <option value="witness">Witness</option>
                              <option value="certify">Certify</option>
                            </select>
                          </label>
                          <label className="form-field" style={{ flex: 1, margin: 0 }}>
                            <span>Signing location <span className="muted">(optional)</span></span>
                            <input
                              placeholder="Edmonton, Alberta"
                              value={activeSigningLocation}
                              onChange={(event) => setActiveSigningLocation(event.target.value)}
                            />
                          </label>
                        </div>
                      ) : null}
                      {selectedDocument.fields.map((field) => (
                        <div key={field.id} className="row-card">
                          <div>
                            <strong>
                              {field.label} · {field.kind === "approval" ? "approval" : field.kind}
                            </strong>
                            <p className="muted">
                              Page {field.page} · {field.source} ·{" "}
                              {field.assigneeSignerId
                                ? signerLabelById.get(field.assigneeSignerId) ?? "assigned participant"
                                : "unassigned"}
                            </p>
                            {field.appliedSavedSignatureId ? (
                              <p className="muted">
                                Saved signature:{" "}
                                {savedSignatures.find(
                                  (signature) => signature.id === field.appliedSavedSignatureId,
                                )?.label ?? "Applied"}
                              </p>
                            ) : null}
                          </div>
                          <div className="field-actions">
                            <span>{field.completedAt ? "Complete" : "Open"}</span>
                            {!field.completedAt &&
                            (field.kind === "signature" || field.kind === "initial") &&
                            selectedSavedSignature ? (
                              <small className="muted">
                                Uses {selectedSavedSignature.label}
                                {selectedSavedSignature.titleText
                                  ? ` · ${selectedSavedSignature.titleText}`
                                  : ""}
                              </small>
                            ) : null}
                            {!field.completedAt &&
                            currentUserIsActiveWorkflowSigner &&
                            selectedDocument.currentUserSignerId === field.assigneeSignerId ? (
                              <button
                                className="ghost-button"
                                disabled={isLoading}
                                onClick={() =>
                                  guestSigningSession
                                    ? runGuestFieldComplete(
                                        field.id,
                                        activeSigningReason,
                                        activeSigningLocation || null,
                                      )
                                    : runDocumentAction("/document-field-complete", {
                                        documentId: selectedDocument.id,
                                        fieldId: field.id,
                                        savedSignatureId:
                                          field.kind === "signature" || field.kind === "initial"
                                            ? selectedSavedSignatureId || null
                                            : null,
                                        signingReason:
                                          field.kind === "signature" || field.kind === "initial"
                                            ? activeSigningReason
                                            : null,
                                        signingLocation:
                                          field.kind === "signature" || field.kind === "initial"
                                            ? activeSigningLocation || null
                                            : null,
                                      })
                                }
                              >
                                Complete field
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>

                    {canEdit ? (
                      <form className="stack form-block" onSubmit={handleAddField}>
                        <label className="form-field">
                          <span>Field label</span>
                          <input
                            required
                            value={fieldLabel}
                            onChange={(event) => setFieldLabel(event.target.value)}
                          />
                        </label>
                        <div className="form-grid compact-grid">
                          <label className="form-field">
                            <span>Kind</span>
                            <select
                              value={fieldKind}
                              onChange={(event) =>
                                setFieldKind(
                                  event.target.value as "signature" | "initial" | "approval" | "date" | "text",
                                )
                              }
                            >
                              <option value="signature">Signature</option>
                              <option value="initial">Initial</option>
                              <option value="approval">Approval</option>
                              <option value="date">Date</option>
                              <option value="text">Text</option>
                            </select>
                          </label>
                          <label className="form-field">
                            <span>Page</span>
                            <input
                              required
                              value={fieldPage}
                              onChange={(event) => setFieldPage(event.target.value)}
                            />
                          </label>
                        </div>
                        <label className="checkbox-row">
                          <input
                            checked={fieldRequired}
                            onChange={(event) => setFieldRequired(event.target.checked)}
                            type="checkbox"
                          />
                          <span>Required field</span>
                        </label>
                        <label className="form-field">
                          <span>Assign to participant</span>
                          <select
                            value={fieldAssigneeSignerId}
                            onChange={(event) => setFieldAssigneeSignerId(event.target.value)}
                          >
                            <option value="">Unassigned</option>
                            {selectedDocument.signers.map((signer) => (
                              <option key={signer.id} value={signer.id}>
                                {signer.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="form-grid compact-grid">
                          <label className="form-field">
                            <span>X</span>
                            <input
                              required
                              value={fieldX}
                              onChange={(event) => setFieldX(event.target.value)}
                            />
                          </label>
                          <label className="form-field">
                            <span>Y</span>
                            <input
                              required
                              value={fieldY}
                              onChange={(event) => setFieldY(event.target.value)}
                            />
                          </label>
                          <label className="form-field">
                            <span>Width</span>
                            <input
                              required
                              value={fieldWidth}
                              onChange={(event) => setFieldWidth(event.target.value)}
                            />
                          </label>
                          <label className="form-field">
                            <span>Height</span>
                            <input
                              required
                              value={fieldHeight}
                              onChange={(event) => setFieldHeight(event.target.value)}
                            />
                          </label>
                        </div>
                        <div className="field-canvas">
                          <div className="field-canvas-label">Drag to place or resize the next field box</div>
                          {selectedDocument.fields.map((field) => (
                            <div
                              key={field.id}
                              className="field-canvas-box field-canvas-box-existing"
                              style={{
                                left: `${field.x}px`,
                                top: `${field.y}px`,
                                width: `${field.width}px`,
                                height: `${field.height}px`,
                              }}
                            >
                              {field.label}
                            </div>
                          ))}
                          <div
                            className="field-canvas-box"
                            onPointerDown={(event) => {
                              dragStateRef.current = {
                                mode: "move",
                                target: "field",
                                startX: event.clientX,
                                startY: event.clientY,
                                originX: Number(fieldX),
                                originY: Number(fieldY),
                                originWidth: Number(fieldWidth),
                                originHeight: Number(fieldHeight),
                              };
                            }}
                            style={{
                              left: `${Number(fieldX)}px`,
                              top: `${Number(fieldY)}px`,
                              width: `${Number(fieldWidth)}px`,
                              height: `${Number(fieldHeight)}px`,
                            }}
                          >
                            <span>{fieldLabel || "New field"}</span>
                            <button
                              className="field-canvas-handle"
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                dragStateRef.current = {
                                  mode: "resize",
                                  target: "field",
                                  startX: event.clientX,
                                  startY: event.clientY,
                                  originX: Number(fieldX),
                                  originY: Number(fieldY),
                                  originWidth: Number(fieldWidth),
                                  originHeight: Number(fieldHeight),
                                };
                              }}
                              type="button"
                            />
                          </div>
                        </div>
                        <button className="ghost-button" disabled={isLoading} type="submit">
                          Add field
                        </button>
                      </form>
                    ) : null}

                    {currentUserIsActiveWorkflowSigner ? (
                      <form
                        className="stack form-block"
                        style={{ marginTop: "1.25rem" }}
                        onSubmit={async (event) => {
                          event.preventDefault();
                          if (!session || !selectedDocument) return;
                          setIsLoading(true);
                          setErrorMessage(null);
                          try {
                            const payload = await apiFetch<{ document: WorkflowDocument }>(
                              "/document-field-sign",
                              session,
                              {
                                method: "POST",
                                body: JSON.stringify({
                                  documentId: selectedDocument.id,
                                  x: Number(freeSignX),
                                  y: Number(freeSignY),
                                  width: Number(freeSignW),
                                  height: Number(freeSignH),
                                  page: Number(freeSignPage),
                                  savedSignatureId: selectedSavedSignatureId || null,
                                  signingReason: activeSigningReason,
                                  signingLocation: activeSigningLocation || null,
                                }),
                              },
                            );
                            setDocuments((prev) =>
                              prev.map((d) => (d.id === payload.document.id ? payload.document : d)),
                            );
                            setNoticeMessage("Signature placed.");
                          } catch (error) {
                            setErrorMessage((error as Error).message);
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                      >
                        <div className="section-heading compact" style={{ margin: 0 }}>
                          <p className="eyebrow">Place your own signature</p>
                          <span className="muted">No pre-placed field required</span>
                        </div>
                        <label className="form-field">
                          <span>Reason for signing</span>
                          <select
                            value={activeSigningReason}
                            onChange={(event) => setActiveSigningReason(event.target.value)}
                          >
                            <option value="author">Author</option>
                            <option value="approve">Approve</option>
                            <option value="verify">Verify</option>
                            <option value="review">Review</option>
                            <option value="acknowledge">Acknowledge</option>
                            <option value="witness">Witness</option>
                            <option value="certify">Certify</option>
                          </select>
                        </label>
                        <label className="form-field">
                          <span>Signing location <span className="muted">(optional)</span></span>
                          <input
                            placeholder="Edmonton, Alberta"
                            value={activeSigningLocation}
                            onChange={(event) => setActiveSigningLocation(event.target.value)}
                          />
                        </label>
                        <p className="muted">
                          Choose the purpose and location for this signing action now. These describe the specific event, not the reusable signature profile.
                        </p>
                        <p className="muted">
                          Drag the box below to position and resize your signature, then click <em>Place and sign</em>.
                          Your currently selected saved signature will be used.
                        </p>
                        <div className="form-grid compact-grid">
                          <label className="form-field">
                            <span>Page</span>
                            <input
                              required
                              min={1}
                              type="number"
                              value={freeSignPage}
                              onChange={(e) => setFreeSignPage(e.target.value)}
                            />
                          </label>
                          <label className="form-field">
                            <span>Width</span>
                            <input
                              required
                              min={80}
                              type="number"
                              value={freeSignW}
                              onChange={(e) => setFreeSignW(e.target.value)}
                            />
                          </label>
                          <label className="form-field">
                            <span>Height</span>
                            <input
                              required
                              min={32}
                              type="number"
                              value={freeSignH}
                              onChange={(e) => setFreeSignH(e.target.value)}
                            />
                          </label>
                        </div>
                        <div className="field-canvas">
                          <div className="field-canvas-label">Drag to position · drag corner to resize</div>
                          {selectedDocument.fields.map((field) => (
                            <div
                              key={field.id}
                              className="field-canvas-box field-canvas-box-existing"
                              style={{
                                left: `${field.x}px`,
                                top: `${field.y}px`,
                                width: `${field.width}px`,
                                height: `${field.height}px`,
                              }}
                            >
                              {field.label}
                            </div>
                          ))}
                          <div
                            className="field-canvas-box field-canvas-box-signer"
                            onPointerDown={(event) => {
                              dragStateRef.current = {
                                mode: "move",
                                target: "freesign",
                                startX: event.clientX,
                                startY: event.clientY,
                                originX: Number(freeSignX),
                                originY: Number(freeSignY),
                                originWidth: Number(freeSignW),
                                originHeight: Number(freeSignH),
                              };
                            }}
                            style={{
                              left: `${Number(freeSignX)}px`,
                              top: `${Number(freeSignY)}px`,
                              width: `${Number(freeSignW)}px`,
                              height: `${Number(freeSignH)}px`,
                            }}
                          >
                            <span>{selectedSavedSignature?.label ?? "Your signature"}</span>
                            <button
                              className="field-canvas-handle"
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                dragStateRef.current = {
                                  mode: "resize",
                                  target: "freesign",
                                  startX: event.clientX,
                                  startY: event.clientY,
                                  originX: Number(freeSignX),
                                  originY: Number(freeSignY),
                                  originWidth: Number(freeSignW),
                                  originHeight: Number(freeSignH),
                                };
                              }}
                              type="button"
                            />
                          </div>
                        </div>
                        <button className="ghost-button" disabled={isLoading} type="submit">
                          {isLoading ? "Signing…" : "Place and sign"}
                        </button>
                      </form>
                    ) : null}
                  </div>
                </section>

                <section className="subpanel split">
                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Access</p>
                      <span>{selectedDocument.access.length} roles</span>
                    </div>
                    <div className="stack">
                      {selectedDocument.accessParticipants.map((entry) => (
                        <div key={`${entry.userId}-${entry.role}`} className="row-card">
                          <div>
                            <strong>
                              {entry.userId === sessionUser?.id ? "You" : entry.displayName}
                            </strong>
                            <p className="muted">{entry.email ?? entry.userId}</p>
                          </div>
                          <span>{entry.role}</span>
                        </div>
                      ))}
                    </div>

                    {canManageAccess ? (
                      <form className="stack form-block" onSubmit={handleInviteCollaborator}>
                        <p className="muted">
                          Invite collaborators here for review or editing. Add routed participants in the
                          Participants section above.
                        </p>
                        <label className="form-field">
                          <span>Invite email</span>
                          <input
                            required
                            type="email"
                            value={inviteEmail}
                            onChange={(event) => setInviteEmail(event.target.value)}
                          />
                        </label>
                        <label className="form-field">
                          <span>Role</span>
                          <select
                            value={inviteRole}
                            onChange={(event) =>
                              setInviteRole(event.target.value as "editor" | "viewer")
                            }
                          >
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                          </select>
                        </label>
                        <button className="ghost-button" disabled={isLoading} type="submit">
                          Invite collaborator
                        </button>
                      </form>
                    ) : null}
                  </div>

                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Audit trail</p>
                      <span>{selectedDocument.auditTrail.length} events</span>
                    </div>
                    <div className="stack">
                      {selectedDocument.auditTrail.map((event) => (
                        <div key={event.id} className="timeline-item">
                          <strong>{event.summary}</strong>
                          <p className="muted">
                            {formatAuditEventType(event.type)} · {formatTimestamp(event.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="subpanel split">
                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Version history</p>
                      <span>{selectedDocument.versions.length}</span>
                    </div>
                    <div className="stack">
                      {selectedDocument.versions.map((version) => (
                        <div key={version.id} className="timeline-item">
                          <strong>{version.label}</strong>
                          <p className="muted">
                            {version.note} · {formatTimestamp(version.createdAt)}
                          </p>
                          {version.changeImpact ? (
                            <p className="muted">
                              Impact: {formatState(version.changeImpact)}
                              {version.changeImpactSummary ? ` · ${version.changeImpactSummary}` : ""}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Notifications</p>
                      <span>{selectedDocument.notifications.length}</span>
                    </div>
                    <div className="stack">
                      {selectedDocument.notifications.length === 0 ? (
                        <p className="muted">
                          {selectedDocument.deliveryMode === "platform_managed"
                            ? "Notifications will appear here once the document is sent or actions are completed."
                            : selectedDocument.deliveryMode === "internal_use_only"
                              ? "Internal-use-only documents do not queue automatic participant emails. Progress is still recorded in the audit trail."
                            : "Self-managed documents do not queue automatic action emails."}
                        </p>
                      ) : (
                        selectedDocument.notifications.slice(0, 8).map((notification) => (
                          <div key={notification.id} className="timeline-item">
                            <strong>
                              {notification.eventType.replaceAll("_", " ")} · {notification.status}
                            </strong>
                            <p className="muted">
                              {notification.recipientEmail} · {formatTimestamp(notification.queuedAt)}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Lock metadata</p>
                      <span>{selectedDocument.lockedAt ? "Explicitly locked" : "Open"}</span>
                    </div>
                    <div className="meta-grid">
                      <div className="meta-item">
                        <span>Locked at</span>
                        <strong>{formatTimestamp(selectedDocument.lockedAt)}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Locked by</span>
                        <strong>{selectedDocument.lockedByUserId ?? "Not locked"}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Reopened at</span>
                        <strong>{formatTimestamp(selectedDocument.reopenedAt)}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Your role</span>
                        <strong>{formatRoleLabel(selectedDocument)}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Lock policy</span>
                        <strong>{getLockPolicyLabel(selectedDocument.lockPolicy)}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Distribution target</span>
                        <strong>{selectedDocument.distributionTarget ?? "Managed in app"}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Originator updates</span>
                        <strong>
                          {selectedDocument.notifyOriginatorOnEachSignature ? "Enabled" : "Off"}
                        </strong>
                      </div>
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <p className="muted">Sign in and upload a document to start.</p>
            )}
          </div>
        </section>
        )}
        </ErrorBoundary>
        ) : null}
      </main>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
